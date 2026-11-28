/* Đô Thị Ảo — src/net.js (M1 multiplayer client)
   Plain JS, no build step. Loaded AFTER colyseus.js, BEFORE src/main.js.
   Wraps colyseus.js 0.15 and translates Colyseus schema state into plain
   JS objects for main.js. Never throws on missing Colyseus — callers check
   NetClient.available and fall back to offline mode.
   Hooks (assign before connect/join):
     onPlayerAdded(p) / onPlayerChanged(p) / onPlayerRemoved(id)
     onNpcAdded(n) / onNpcChanged(n) / onNpcRemoved(id)
     onChatMessage(msg)  {fromId, fromName, channel, text, targetId, at}
     onChatError(err)    {error}
     onInteractError(err){error, action?}
     onRevived(msg)      {byId, byName, targetId}
     onWorldTime(minutes)
     onJobResult(msg)    M3 {type:'job'|'shipper'|'hospital', ok, error, ...}
     onNpcTalk(msg)      M3 {npcId, name, isGuide, x, y, text, quest?, personaId?}
     onFaintAlert(msg)   M3 {playerId, name, x, y, at} (doctors only)
     onFainted(msg)      M4 {playerId, name, x, y, at} (whole room — the
                         online self-faint SFX hook; M3 had no such message)
     onVehicleResult(msg) M4 {type:'vehicle', ok, action, ...}
     onTaxiResult(msg)   M4 {type:'taxi', ok, action, ...}
     onMotelResult(msg)  M4 {type:'motel', ok, action, ...}
     onSnapshot(state)   {players:[...], npcs:[...], worldTime} (full sweep)
     onDisconnected()    (room left unexpectedly — reconnecting)
     onReconnected()     (rejoin succeeded)
     onReconnectFailed() (30 s of retries exhausted -> go offline)
   Reconnect: fresh join = spawn (server limitation, CONTRACT.md). */
(function () {
  'use strict';

  var RECONNECT_WINDOW_MS = 30000;
  var RECONNECT_RETRY_MS = 3000;

  function plainPlayer(p) {
    if (!p) return null;
    return {
      id: p.id, name: p.name, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      anim: p.anim, job: p.job, hp: p.hp, hunger: p.hunger,
      stamina: p.stamina, cash: p.cash, bank: p.bank,
      isFainted: !!p.isFainted, vehicleId: p.vehicleId || '',
      // M4 vehicles / taxi / motel (§8).
      vehicleType: p.vehicleType || '', fuel: (p.fuel === undefined ? 100 : p.fuel),
      durability: (p.durability === undefined ? 100 : p.durability),
      passengerId: p.passengerId || '', roomExpiresAt: p.roomExpiresAt || 0,
      chatBubble: p.chatBubble || '', chatBubbleUntil: p.chatBubbleUntil || 0,
      avatar: p.avatar || 'hero',
      // M3 Shipper (§6): active order mirrored from the server state.
      orderStatus: p.orderStatus || 'none', orderId: p.orderId || '',
      orderX: p.orderX || 0, orderY: p.orderY || 0,
      orderDeadline: p.orderDeadline || 0, orderReward: p.orderReward || 0,
      // Multi-shop Shipper (2026-11-25): pickup source of the order.
      orderPickupX: p.orderPickupX || 0, orderPickupY: p.orderPickupY || 0,
      orderPickupName: p.orderPickupName || ''
    };
  }

  function plainNpc(n) {
    if (!n) return null;
    return {
      id: n.id, type: n.type, name: n.name, x: n.x, y: n.y,
      targetX: n.targetX, targetY: n.targetY, avatar: n.avatar || 'hero'
    };
  }

  function snapshotOf(state) {
    var players = [], npcs = [];
    if (state) {
      if (state.players) state.players.forEach(function (p) { players.push(plainPlayer(p)); });
      if (state.npcs) state.npcs.forEach(function (n) { npcs.push(plainNpc(n)); });
    }
    return {
      players: players, npcs: npcs,
      worldTime: state ? state.worldTime : 480
    };
  }

  var NetClient = {
    available: (typeof Colyseus !== 'undefined' && Colyseus && typeof Colyseus.Client === 'function'),
    client: null,
    room: null,
    sessionId: null,
    serverUrl: null,
    connected: false,
    hooks: {},
    _leavingIntentionally: false,
    _reconnecting: false,
    _reconnectDeadline: 0,
    _reconnectTimer: null,
    _lastJoinOptions: null,
    // LAG FIX: Colyseus 0.15 reconnection token — resume the SAME session
    // after a drop (server allowReconnection 30 s). Set on every attach.
    _reconnectionToken: null,

    /* Create the Colyseus client. Resolves {ok:true} or {ok:false, reason}. */
    connect: function (serverUrl) {
      var self = this;
      self.serverUrl = serverUrl;
      if (!self.available) {
        return Promise.resolve({ ok: false, reason: 'no-colyseus-lib' });
      }
      try {
        self.client = new Colyseus.Client(serverUrl);
      } catch (err) {
        return Promise.resolve({ ok: false, reason: 'client-error:' + (err && err.message ? err.message : err) });
      }
      return Promise.resolve({ ok: true });
    },

    /* Join (or create) a room. Resolves {ok:true, sessionId} or {ok:false, reason}.
       20 s timeout: Railway cold-start (wake + migrations at boot) often
       exceeds 10 s; 20 s still never blocks offline fallback forever. */
    joinRoom: function (roomName, options) {
      var self = this;
      self._lastJoinOptions = { roomName: roomName, options: options || {} };
      if (!self.client) return Promise.resolve({ ok: false, reason: 'not-connected' });
      var done = false;
      return new Promise(function (resolve) {
        var timer = setTimeout(function () {
          if (done) return;
          done = true;
          resolve({ ok: false, reason: 'timeout-20s' });
        }, 20000);
        var p;
        try {
          p = self.client.joinOrCreate(roomName || 'city', options || {});
        } catch (err) {
          clearTimeout(timer);
          if (!done) { done = true; resolve({ ok: false, reason: 'join-error:' + (err && err.message ? err.message : err) }); }
          return;
        }
        p.then(function (room) {
          if (done) { try { room.leave(); } catch (e) { /* late join, drop it */ } return; }
          clearTimeout(timer);
          done = true;
          self._attachRoom(room);
          resolve({ ok: true, sessionId: room.sessionId });
        }).catch(function (err) {
          if (done) return;
          clearTimeout(timer);
          done = true;
          resolve({ ok: false, reason: 'join-failed:' + (err && err.message ? err.message : err) });
        });
      });
    },

    leave: function () {
      var self = this;
      self._leavingIntentionally = true;
      self._stopReconnectLoop();
      // LAG FIX: intentional leave invalidates the stored token — a later
      // manual rejoin must be a fresh session, never a stale resume.
      self._reconnectionToken = null;
      if (self.room) {
        try { self.room.leave(); } catch (e) { /* ignore */ }
      }
      self.room = null;
      self.sessionId = null;
      self.connected = false;
    },

    sendMove: function (seq, dx, dy, sprint) {
      if (!this.connected || !this.room) return false;
      try { this.room.send('move', { seq: seq, dx: dx, dy: dy, sprint: !!sprint }); return true; }
      catch (e) { return false; }
    },

    sendChat: function (channel, text, targetId) {
      if (!this.connected || !this.room) return false;
      var msg = { channel: channel, text: text };
      if (targetId) msg.targetId = targetId;
      try { this.room.send('chat', msg); return true; }
      catch (e) { return false; }
    },

    sendInteract: function (targetId, action, extra) {
      if (!this.connected || !this.room) return false;
      var msg = { targetId: targetId, action: action };
      if (extra) Object.keys(extra).forEach(function (k) { msg[k] = extra[k]; });
      try { this.room.send('interact', msg); return true; }
      catch (e) { return false; }
    },

    // M4: vehicle ('buy' | 'mount' | 'dismount' | 'refuel' | 'repair' |
    // 'status'), taxi ('toggle' | 'invite' | 'accept' | 'decline' |
    // 'pickup' | 'dropoff' | 'leave' | 'status'), motel ('rent' |
    // 'renew' | 'chest_put' | 'chest_take' | 'status'). extra carries
    // the action's fields (vehicleId, targetId, npcId, itemId, qty...).
    sendVehicle: function (action, extra) {
      if (!this.connected || !this.room) return false;
      var msg = { action: action };
      if (extra) Object.keys(extra).forEach(function (k) { msg[k] = extra[k]; });
      try { this.room.send('vehicle', msg); return true; }
      catch (e) { return false; }
    },
    sendTaxi: function (action, extra) {
      if (!this.connected || !this.room) return false;
      var msg = { action: action };
      if (extra) Object.keys(extra).forEach(function (k) { msg[k] = extra[k]; });
      try { this.room.send('taxi', msg); return true; }
      catch (e) { return false; }
    },
    sendMotel: function (action, extra) {
      if (!this.connected || !this.room) return false;
      var msg = { action: action };
      if (extra) Object.keys(extra).forEach(function (k) { msg[k] = extra[k]; });
      try { this.room.send('motel', msg); return true; }
      catch (e) { return false; }
    },

    // M3: pick a job ('unemployed' | 'shipper' | 'doctor' | 'taxi_driver').
    sendJob: function (job) {
      if (!this.connected || !this.room) return false;
      try { this.room.send('job', { job: job }); return true; }
      catch (e) { return false; }
    },

    // M3 Shipper (§6): action 'accept' | 'complete' | 'cancel' | 'status'.
    // extra carries {orderId} for 'complete'.
    sendShipper: function (action, extra) {
      if (!this.connected || !this.room) return false;
      var msg = { action: action };
      if (extra && extra.orderId) msg.orderId = extra.orderId;
      try { this.room.send('shipper', msg); return true; }
      catch (e) { return false; }
    },

    // M2 economy: sends an economy message (starter_grant / shop_buy /
    // atm_transfer / use_item) with a fresh idempotency request_id.
    sendEconomy: function (type, msg) {
      if (!this.connected || !this.room) return false;
      msg = msg || {};
      msg.type = type;
      if (!msg.request_id) {
        msg.request_id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
      }
      try { this.room.send(type, msg); return true; }
      catch (e) { return false; }
    },

    _call: function (name, arg) {
      var fn = this.hooks && this.hooks[name];
      if (typeof fn === 'function') {
        try { fn(arg); } catch (e) { console.error('[net] hook ' + name + ' failed:', e); }
      }
    },

    _attachRoom: function (room) {
      var self = this;
      self.room = room;
      self.sessionId = room.sessionId;
      // LAG FIX: 0.15 reconnection token — resume the SAME session after a
      // drop (server allowReconnection 30 s). Stored on every attach, so a
      // successful token reconnect refreshes it for the next drop.
      self._reconnectionToken = room.reconnectionToken || null;
      self.connected = true;
      self._leavingIntentionally = false;

      // --- state callbacks -> plain objects ---
      // @colyseus/schema v2 (colyseus.js 0.15): onAdd/onRemove/onChange are
      // METHODS, not assignable properties — `map.onAdd = fn` silently
      // never fires. onAdd(cb, true) also fires for items already present.
      var state = room.state;
      if (state) {
        if (state.players) {
          state.players.onAdd(function (player, key) {
            self._call('onPlayerAdded', plainPlayer(player));
            if (player && typeof player.onChange === 'function') {
              player.onChange(function () { self._call('onPlayerChanged', plainPlayer(player)); });
            }
          }, true);
          state.players.onRemove(function (player, key) {
            self._call('onPlayerRemoved', key);
          });
        }
        if (state.npcs) {
          state.npcs.onAdd(function (npc, key) {
            self._call('onNpcAdded', plainNpc(npc));
            if (npc && typeof npc.onChange === 'function') {
              npc.onChange(function () { self._call('onNpcChanged', plainNpc(npc)); });
            }
          }, true);
          state.npcs.onRemove(function (npc, key) {
            self._call('onNpcRemoved', key);
          });
        }
        if (typeof state.listen === 'function') {
          state.listen('worldTime', function (value) {
            self._call('onWorldTime', value);
          });
          state.listen('serverNow', function (value) {
            self._call('onServerNow', value);
          });
        }
      }
      // Full-state sweep on every patch (safety net if a granular callback
      // is missed; main.js handlers are idempotent).
      if (typeof room.onStateChange === 'function') {
        room.onStateChange(function (newState) {
          self._call('onSnapshot', snapshotOf(newState));
          if (newState && newState.worldTime !== undefined) self._call('onWorldTime', newState.worldTime);
        });
      }

      // --- server -> client messages ---
      room.onMessage('chat', function (msg) { self._call('onChatMessage', msg); });
      room.onMessage('chat_error', function (msg) { self._call('onChatError', msg); });
      room.onMessage('interact_error', function (msg) { self._call('onInteractError', msg); });
      room.onMessage('revived', function (msg) { self._call('onRevived', msg); });
      room.onMessage('econ_result', function (msg) { self._call('onEconResult', msg); });
      // M3: job/shipper results, NPC talk replies, doctor faint alerts.
      room.onMessage('job_result', function (msg) { self._call('onJobResult', msg); });
      room.onMessage('npc_talk', function (msg) { self._call('onNpcTalk', msg); });
      room.onMessage('faint_alert', function (msg) { self._call('onFaintAlert', msg); });
      // M4: explicit 'fainted' broadcast (fixes the M3 gap: online
      // self-faint played no sound — main.js hooks onFainted -> faint SFX),
      // plus vehicle / taxi / motel results.
      room.onMessage('fainted', function (msg) { self._call('onFainted', msg); });
      room.onMessage('vehicle_result', function (msg) { self._call('onVehicleResult', msg); });
      room.onMessage('taxi_result', function (msg) { self._call('onTaxiResult', msg); });
      room.onMessage('motel_result', function (msg) { self._call('onMotelResult', msg); });

      room.onLeave(function (code) {
        self.connected = false;
        self.room = null;
        self.sessionId = null;
        if (self._leavingIntentionally) return;
        self._call('onDisconnected');
        self._startReconnectLoop();
      });
      room.onError(function (code, message) {
        console.warn('[net] room error', code, message);
      });
    },

    _startReconnectLoop: function () {
      var self = this;
      if (self._reconnecting) return;
      self._reconnecting = true;
      self._reconnectDeadline = Date.now() + RECONNECT_WINDOW_MS;
      var attempt = function () {
        if (!self._reconnecting) return;
        if (Date.now() >= self._reconnectDeadline) {
          self._reconnecting = false;
          self._call('onReconnectFailed');
          return;
        }
        // LAG FIX: try to resume the SAME session first (token reconnect).
        // Falls back to a fresh join when there is no token, the server
        // has no allowReconnection (old build), or the 30 s window
        // expired — so behaviour on an old server is unchanged.
        var fallbackJoin = function () {
          if (!self._reconnecting) return;
          var last = self._lastJoinOptions || { roomName: 'city', options: {} };
          self.joinRoom(last.roomName, last.options).then(function (res) {
            if (!self._reconnecting) return;
            if (res.ok) {
              self._reconnecting = false;
              self._call('onReconnected');
            } else {
              self._reconnectTimer = setTimeout(attempt, RECONNECT_RETRY_MS);
            }
          });
        };
        var token = self._reconnectionToken;
        if (token && self.client && typeof self.client.reconnect === 'function') {
          var settled = false;
          var rtimer = setTimeout(function () {
            if (settled) return;
            settled = true;
            fallbackJoin();
          }, 10000);
          var rp = null;
          try { rp = self.client.reconnect(token); } catch (e) { rp = null; }
          if (!rp || typeof rp.then !== 'function') {
            clearTimeout(rtimer);
            fallbackJoin();
            return;
          }
          rp.then(function (room) {
            if (settled) { try { room.leave(); } catch (e) { /* late resolve, drop it */ } return; }
            settled = true;
            clearTimeout(rtimer);
            if (!self._reconnecting) { try { room.leave(); } catch (e) { /* reconnect loop stopped */ } return; }
            self._attachRoom(room);
            self._reconnecting = false;
            self._call('onReconnected');
          }).catch(function () {
            if (settled) return;
            settled = true;
            clearTimeout(rtimer);
            fallbackJoin();
          });
          return;
        }
        fallbackJoin();
      };
      self._reconnectTimer = setTimeout(attempt, RECONNECT_RETRY_MS);
    },

    _stopReconnectLoop: function () {
      this._reconnecting = false;
      if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    }
  };

  if (typeof window !== 'undefined') window.NetClient = NetClient;
  if (typeof module !== 'undefined' && module.exports) module.exports = NetClient;
})();
