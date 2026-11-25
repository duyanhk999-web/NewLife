/* Đô Thị Ảo — src/jobs.js (M3 job choice + Shipper, M4 Taxi/Bác sĩ/Xe,
   SRS §3.4, §6, §8, §18.5)
   Plain JS, no build step. Loaded AFTER src/economy.js, BEFORE src/main.js.
   Owns the #jobPanel DOM (job buttons + Shipper order controls + M4 Taxi
   and vehicle controls) and the OFFLINE Shipper/Taxi engines — the same
   rules/numbers as the server (shared/m3.js): 1 order at a time, accept at
   any pickup source (50% warehouse / 50% shops: Cửa Hàng Tiện Lợi, Nhà Trọ,
   Chợ, Quán Cà Phê), deadline = distance/vehicle-speed + 30 s (LOCKED at
   accept), server-calculated reward (here: the local engine, since there
   is no server offline; pay x1.00 foot / x1.30 bicycle / x2.00 motorbike —
   LOCKED 2026-11-25 01:02), deliver within 80 px, cancel = 10 s cooldown,
   faint = FAILED, duplicate complete = ALREADY_PROCESSED. Online mode only
   renders the panel and forwards clicks to NetClient — the server decides
   everything there.
   main.js drives it: Jobs.init(ctx) in boot, Jobs.tick(dt) in the ticker,
   Jobs.onServerOrder(order) from the net hooks. */
(function () {
  'use strict';

  var M3 = (typeof window !== 'undefined' && window.M3) ? window.M3 : null;
  if (typeof module !== 'undefined' && module.exports && !M3) {
    try { M3 = require('../shared/m3'); } catch (e) { M3 = null; }
  }

  var ctx = null; // {state, isOnline, sendShipper, sendJob, getWorldTime, sys, economy}
  var panelEl = null, orderInfoEl = null, jobLineEl = null;
  var acceptBtn = null, completeBtn = null, cancelBtn = null;
  var jobBtns = {};
  var localOrder = null; // offline active order (same shape as the server's)
  var localCancelCooldownUntil = 0;
  var localCompletedIds = {}; // orderId -> true (idempotency, §4.3)
  var localOrderSeq = 0;
  var uiAccum = 0;

  // ---- M4: vehicle + taxi state (offline engine; online is server-side) ----
  var vehicleInfoEl = null, mountBtn = null, dismountBtn = null;
  var taxiInfoEl = null, taxiToggleBtn = null, taxiPickupBtn = null, taxiDropoffBtn = null;
  var taxiMode = false; // "Nhận khách" on/off (offline + online mirror)
  var localTaxiRide = null; // {kind:'npc', npcId, destX, destY, poiName, distancePx}
  var localTaxiCustomers = []; // {id, x, y, destX, destY, poiName, spawnedAt}
  var localTaxiSeq = 0;
  var localTaxiSpawnAt = 0;
  var lastTaxiPos = null; // {x, y} — accumulate ride distance from movement
  // NPC customers wait at road intersections (same spots as the server).
  var TAXI_SPOTS = [
    { x: 1230, y: 1230 }, { x: 2430, y: 1230 }, { x: 3630, y: 1230 },
    { x: 1230, y: 2430 }, { x: 3630, y: 2430 },
    { x: 1230, y: 3630 }, { x: 2430, y: 3630 }, { x: 3630, y: 3630 }
  ];

  // ---- M4: doctor revive mini-game (§18.5, PROPOSAL) ----
  // Rhythm tap: 10 beats, marker ping-pongs across the bar, tap while it
  // is inside the green zone (42–58%). Accuracy >= 90% -> +20 HP bonus.
  var reviveGame = null; // {targetId, beat, hits, judged, raf, startAt}
  var revivePanelEl = null, reviveMarkerEl = null, reviveScoreEl = null, reviveTapBtn = null;

  function el(id) { return document.getElementById(id); }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function fmt(n) { return Math.floor(n).toLocaleString('vi-VN') + 'đ'; }
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function isOnline() { return ctx && ctx.isOnline && ctx.isOnline(); }
  function state() { return ctx ? ctx.state : null; }

  // Current active order, from the server state when online, local when offline.
  function getOrder() {
    var st = state();
    if (!st) return null;
    if (isOnline()) {
      if (st.order && st.order.status === 'accepted') return st.order;
      return null;
    }
    return localOrder;
  }

  function isNight() {
    if (!M3) return false;
    var wt = ctx && ctx.getWorldTime ? ctx.getWorldTime() : 480;
    return M3.isNightWorld(wt);
  }

  // SFX (M3 skills revision, audio-gen tier a): never crash the game.
  function sfx(name) {
    try { if (typeof window !== 'undefined' && window.DTA_SFX && window.DTA_SFX[name]) window.DTA_SFX[name](); } catch (e) { /* audio must never crash the game */ }
  }

  // VFX (rename+VFX): same call sites as sfx() — sight + sound together.
  function vfx(name, a, b, c) {
    try { if (typeof window !== 'undefined' && window.DTA_VFX && window.DTA_VFX[name]) window.DTA_VFX[name](a, b, c); } catch (e) { /* visuals must never crash the game */ }
  }

  // ---- offline Shipper engine (same rules as server/_onShipper) ----
  function localAccept() {
    var st = state();
    if (!st || !M3) return { ok: false, error: 'NO_M3' };
    if (st.job !== 'shipper') return { ok: false, error: 'NOT_SHIPPER' };
    if (st.isFainted) return { ok: false, error: 'FAINTED' };
    if (localOrder) return { ok: false, error: 'ALREADY_HAVE_ORDER' };
    var now = Date.now();
    if (now < localCancelCooldownUntil) {
      return { ok: false, error: 'COOLDOWN', retryAfterSec: Math.ceil((localCancelCooldownUntil - now) / 1000) };
    }
    // Multi-shop (user 2026-11-25): accept at ANY pickup source (50%
    // warehouse / 50% shops). The player must stand within SHIPPER_RANGE
    // of the nearest source; the order's pickup IS that source.
    var src = M3.nearestShipperSource ? M3.nearestShipperSource(st.x, st.y) : null;
    if (!src || src.distance > M3.SHIPPER_RANGE) {
      return { ok: false, error: 'TOO_FAR' };
    }
    var target = M3.pickDeliveryPoint(null, src.id);
    var distance = Math.round(dist(st.x, st.y, target.x, target.y));
    // M4 (§6.3, §6.4): deadline uses the speed of the vehicle RIDING at
    // accept time (walk 180 / bicycle 234 / motorbike 324), LOCKED;
    // reward uses the LOCKED pay multiplier (x1.00 / x1.30 / x2.00).
    var ridingId = ridingVehicleId();
    var speed = M3.vehicleSpeed ? M3.vehicleSpeed(ridingId) : M3.WALK_SPEED;
    var seconds = M3.deliverySeconds(distance, speed);
    localOrder = {
      id: 'local-' + (++localOrderSeq),
      targetX: target.x, targetY: target.y, poiName: target.poiName,
      pickupId: src.id, pickupName: src.name, pickupX: src.x, pickupY: src.y,
      distance: distance,
      reward: M3.deliveryRewardFor ? M3.deliveryRewardFor(distance, isNight(), ridingId) : M3.deliveryReward(distance, isNight()),
      vehicleId: ridingId || '',
      deadlineAt: now + seconds * 1000, idempotencyKey: uuid(),
      status: 'accepted',
    };
    if (ctx.sys) ctx.sys('Đã nhận đơn: lấy hàng ở ' + src.name + ', giao tới ' + (target.poiName || 'điểm giao') +
      ' (' + distance + 'm) — hạn ' + seconds + 's, thưởng ' + fmt(localOrder.reward) + '.');
    sfx('accept');
    vfx('acceptPath', target.x, target.y);
    render();
    return { ok: true, order: localOrder };
  }

  function localComplete() {
    var st = state();
    if (!st || !M3) return { ok: false, error: 'NO_M3' };
    if (!localOrder) return { ok: false, error: 'NO_ORDER' };
    var order = localOrder;
    if (localCompletedIds[order.id]) return { ok: false, error: 'ALREADY_PROCESSED' };
    if (st.isFainted) return { ok: false, error: 'FAINTED' };
    var now = Date.now();
    if (now > order.deadlineAt) {
      localOrder = null;
      if (ctx.sys) ctx.sys('Đơn ' + order.id + ' đã hết hạn (EXPIRED) — không thưởng, nhận đơn mới được rồi.');
      sfx('expire');
      vfx('clearPath');
      render();
      return { ok: false, error: 'EXPIRED' };
    }
    if (dist(st.x, st.y, order.targetX, order.targetY) > M3.DELIVER_RANGE) {
      return { ok: false, error: 'TOO_FAR', needPx: M3.DELIVER_RANGE };
    }
    localCompletedIds[order.id] = true;
    localOrder = null;
    if (ctx.economy && ctx.economy.grant) {
      ctx.economy.grant(order.reward, 'job_reward', {
        job: 'delivery', delivery_id: order.id, distance_px: order.distance,
        idempotency_key: order.idempotencyKey,
      });
    } else {
      st.cash += order.reward;
    }
    if (ctx.sys) ctx.sys('Giao hàng thành công! +' + fmt(order.reward) + ' (đơn ' + order.id + ').');
    sfx('deliver');
    vfx('deliver', st.x, st.y, '+' + fmt(order.reward));
    vfx('clearPath');
    render();
    return { ok: true, reward: order.reward };
  }

  function localCancel() {
    if (!localOrder) return { ok: false, error: 'NO_ORDER' };
    var id = localOrder.id;
    localOrder = null;
    localCancelCooldownUntil = Date.now() + M3.ORDER_CANCEL_COOLDOWN_S * 1000;
    if (ctx.sys) ctx.sys('Đã hủy đơn ' + id + ' — chờ 10s mới nhận đơn mới.');
    sfx('click');
    vfx('clearPath');
    render();
    return { ok: true };
  }

  // Called by main.js when the local player faints (§6.2: order FAILED).
  function onLocalFaint() {
    if (!localOrder) return;
    var id = localOrder.id;
    localOrder = null;
    if (ctx.sys) ctx.sys('Đơn ' + id + ' FAILED vì bạn ngất giữa đường — không thưởng.');
    vfx('clearPath');
    render();
  }

  // ---- M4: vehicles (offline via Economy, online via NetClient) ----
  function ridingVehicleId() {
    if (isOnline()) {
      var st = state();
      return (st && st.vehicleId) ? st.vehicleId : '';
    }
    if (ctx.economy && ctx.economy.getRiding) return ctx.economy.getRiding();
    return '';
  }
  function vehicleState() {
    if (isOnline()) {
      if (ctx.getOnlineVehicle) return ctx.getOnlineVehicle();
      var st = state() || {};
      return {
        riding: st.vehicleId || '',
        bicycle: { owned: st.vehicleId === 'bicycle', fuel: 100, durability: st.durability || 100 },
        motorbike: { owned: st.vehicleId === 'motorbike', fuel: st.fuel || 100, durability: 100 },
      };
    }
    if (ctx.economy && ctx.economy.getVehicleState) return ctx.economy.getVehicleState();
    return { riding: '', bicycle: { owned: false }, motorbike: { owned: false } };
  }
  // Mount the nearest owned vehicle (offline: within 80 px of its parked
  // spot; online: the server checks and answers TOO_FAR with its coords).
  function mountNearest() {
    var st = state();
    if (!st) return;
    if (isOnline()) {
      var vs = vehicleState();
      var want = vs.motorbike.owned ? 'motorbike' : (vs.bicycle.owned ? 'bicycle' : null);
      if (!want) { if (ctx.sys) ctx.sys('Bạn chưa có xe nào — mua ở Showroom trước.'); return; }
      if (ctx.sendVehicle) ctx.sendVehicle('mount', { vehicleId: want });
      return;
    }
    if (!ctx.economy) return;
    var vstate = ctx.economy.getVehicleState();
    var best = null, bestD = 1e9;
    ['bicycle', 'motorbike'].forEach(function (id) {
      if (!vstate[id].owned) return;
      var d = dist(st.x, st.y, vstate[id].x, vstate[id].y);
      if (d < bestD) { bestD = d; best = id; }
    });
    if (!best) { if (ctx.sys) ctx.sys('Bạn chưa có xe nào — mua ở Showroom trước.'); return; }
    var res = ctx.economy.mountVehicle(best);
    if (res.ok) {
      if (ctx.sys) ctx.sys('Đã lên ' + (best === 'motorbike' ? 'xe máy' : 'xe đạp') + ' — tốc độ ' + (best === 'motorbike' ? 324 : 234) + ' px/s. Bấm E / Xuống xe để xuống.');
      sfx('accept');
    } else if (ctx.sys) ctx.sys(jobErrText(res));
    render();
  }
  function dismountCurrent() {
    if (isOnline()) {
      if (ctx.sendVehicle) ctx.sendVehicle('dismount', {});
      return;
    }
    if (!ctx.economy) return;
    var res = ctx.economy.dismountVehicle();
    if (res.ok) {
      if (localTaxiRide) completeLocalTaxiRide('DROPOFF');
      if (ctx.sys) ctx.sys('Đã xuống xe — xe đỗ tại chỗ này.');
      sfx('click');
    } else if (ctx.sys) ctx.sys(jobErrText(res));
    render();
  }

  // ---- M4: taxi (offline engine mirrors the server) ----
  function taxiCustomers() {
    if (isOnline()) {
      if (ctx.getTaxiCustomers) return ctx.getTaxiCustomers();
      return [];
    }
    return localTaxiCustomers;
  }
  function spawnLocalTaxiCustomer() {
    if (!M3) return;
    for (var i = 0; i < 10; i++) {
      var base = TAXI_SPOTS[Math.floor(Math.random() * TAXI_SPOTS.length)];
      // Sidewalk corner of the intersection (road centres are not open
      // ground — same rule as the server's _spawnTaxiCustomer).
      var x = base.x + 140 + (Math.random() * 60 - 30), y = base.y + 140 + (Math.random() * 60 - 30);
      var dest = M3.pickDeliveryPoint();
      localTaxiCustomers.push({
        id: 'local-taxi-' + (++localTaxiSeq),
        x: Math.round(x), y: Math.round(y),
        destX: dest.x, destY: dest.y, poiName: dest.poiName,
        spawnedAt: Date.now(),
      });
      return;
    }
  }
  function toggleTaxiMode() {
    var st = state();
    if (!st) return;
    if (isOnline()) {
      if (ctx.sendTaxi) ctx.sendTaxi('toggle', {});
      return;
    }
    if (st.job !== 'taxi_driver') { if (ctx.sys) ctx.sys('Chọn nghề Tài xế trước đã.'); return; }
    if (!ctx.economy || !ctx.economy.getVehicleState().motorbike.owned) {
      if (ctx.sys) ctx.sys('Taxi phải dùng xe máy — mua xe máy ở Showroom trước.'); return;
    }
    taxiMode = !taxiMode;
    if (ctx.sys) ctx.sys(taxiMode ? 'Đã bật "Nhận khách" — khách vãng lai sẽ xuất hiện ở các ngã tư khi phòng có dưới 4 người.' : 'Đã tắt "Nhận khách".');
    sfx('click');
    render();
  }
  function pickupTaxiCustomer() {
    var st = state();
    if (!st) return;
    if (isOnline()) {
      // Passenger accepting a driver's invite rides via 'accept', not
      // 'pickup' (pickup is for NPC customers).
      if (onlineTaxi.invitedBy) {
        if (ctx.sendTaxi) ctx.sendTaxi('accept', { driverId: onlineTaxi.invitedBy });
        return;
      }
      var list = taxiCustomers();
      var best = null, bestD = 1e9;
      list.forEach(function (c) {
        var d = dist(st.x, st.y, c.x, c.y);
        if (d < bestD) { bestD = d; best = c; }
      });
      if (!best) { if (ctx.sys) ctx.sys('Không có khách vãng lai nào gần đây.'); return; }
      if (ctx.sendTaxi) ctx.sendTaxi('pickup', { npcId: best.npcId || best.id });
      return;
    }
    if (st.job !== 'taxi_driver') { if (ctx.sys) ctx.sys('Chọn nghề Tài xế trước đã.'); return; }
    if (ridingVehicleId() !== 'motorbike') { if (ctx.sys) ctx.sys('Taxi phải đi xe máy — lên xe máy trước.'); return; }
    if (localTaxiRide) { if (ctx.sys) ctx.sys('Bạn đang chở 1 khách rồi — trả khách xong mới đón khách mới.'); return; }
    var near = null, nearD = 1e9;
    localTaxiCustomers.forEach(function (c) {
      var d = dist(st.x, st.y, c.x, c.y);
      if (d < nearD) { nearD = d; near = c; }
    });
    if (!near || nearD > M3.PICKUP_RANGE) {
      if (ctx.sys) ctx.sys('Không có khách nào trong 120 px — tới gần ngã tư có khách vãng lai.');
      return;
    }
    localTaxiCustomers.splice(localTaxiCustomers.indexOf(near), 1);
    localTaxiRide = {
      kind: 'npc', npcId: near.id, destX: near.destX, destY: near.destY,
      poiName: near.poiName, distancePx: 0,
    };
    lastTaxiPos = { x: st.x, y: st.y };
    if (ctx.sys) ctx.sys('Đã đón khách — chở tới ' + (near.poiName || 'điểm đến') + ' (' + Math.round(dist(st.x, st.y, near.destX, near.destY)) + 'm). Cước 1.000đ/100 px, tối thiểu 5.000đ.');
    sfx('accept');
    render();
  }
  function completeLocalTaxiRide(how) {
    var st = state();
    if (!localTaxiRide || !st) return;
    var ride = localTaxiRide;
    localTaxiRide = null;
    lastTaxiPos = null;
    var fare = M3.taxiFare(ride.distancePx, isNight());
    // NPC passenger: SYSTEM pays the fare; driver gets fare + night bonus.
    if (ctx.economy && ctx.economy.grant) {
      ctx.economy.grant(fare.driverReceives, 'taxi_fare', {
        passenger: 'npc', npc_id: ride.npcId, distance_px: Math.round(ride.distancePx),
      });
    } else {
      st.cash += fare.driverReceives;
    }
    if (ctx.sys) ctx.sys('Trả khách xong! Cước ' + fmt(fare.fare) +
      (fare.nightBonus ? ' + phụ cấp đêm ' + fmt(fare.nightBonus) : '') +
      ' = +' + fmt(fare.driverReceives) + ' (khách NPC, hệ thống trả).');
    sfx('deliver');
    vfx('deliver', st.x, st.y, '+' + fmt(fare.driverReceives));
    render();
  }
  function dropoffTaxi() {
    if (isOnline()) {
      if (ctx.sendTaxi) ctx.sendTaxi('dropoff', {});
      return;
    }
    if (!localTaxiRide) { if (ctx.sys) ctx.sys('Bạn không chở khách nào.'); return; }
    completeLocalTaxiRide('DROPOFF');
  }
  // Offline taxi tick: spawn customers while "Nhận khách" is on, despawn
  // after 5 min, accumulate ride distance, auto-complete at destination.
  function taxiTick(dt) {
    var st = state();
    if (!st || isOnline()) return;
    var now = Date.now();
    // Despawn unpicked customers after 5 min (§10.2).
    for (var i = localTaxiCustomers.length - 1; i >= 0; i--) {
      if (now - localTaxiCustomers[i].spawnedAt > 300000) localTaxiCustomers.splice(i, 1);
    }
    if (taxiMode && st.job === 'taxi_driver' && localTaxiCustomers.length < 2) {
      if (now >= localTaxiSpawnAt) {
        spawnLocalTaxiCustomer();
        localTaxiSpawnAt = now + 5000;
      }
    }
    if (localTaxiRide) {
      if (!ridingVehicleId() || ridingVehicleId() !== 'motorbike') {
        completeLocalTaxiRide('DROPOFF');
        return;
      }
      if (lastTaxiPos) {
        localTaxiRide.distancePx += dist(st.x, st.y, lastTaxiPos.x, lastTaxiPos.y);
      }
      lastTaxiPos = { x: st.x, y: st.y };
      if (dist(st.x, st.y, localTaxiRide.destX, localTaxiRide.destY) <= M3.DROPOFF_RANGE) {
        completeLocalTaxiRide('DROPOFF');
      }
    }
  }

  // ---- M4: doctor revive mini-game (§18.5, PROPOSAL) ----
  // Opens the rhythm overlay; on finish it calls ctx.sendRevive(targetId,
  // accuracyPct) — main.js forwards it as interact 'revive' + minigamePct.
  // Cancel closes without reviving.
  function startReviveGame(targetId) {
    if (!revivePanelEl) return;
    stopReviveGame(false);
    reviveGame = { targetId: targetId, beat: 0, hits: 0, judged: false, startAt: Date.now() };
    revivePanelEl.classList.add('open');
    if (reviveScoreEl) reviveScoreEl.textContent = 'Nhịp 0/10 • Đúng 0';
    if (reviveTapBtn) reviveTapBtn.disabled = false;
    var step = function () {
      if (!reviveGame) return;
      var elapsed = Date.now() - reviveGame.startAt;
      var beatMs = 1100;
      var beat = Math.floor(elapsed / beatMs);
      if (beat >= 10) { finishReviveGame(); return; }
      if (beat !== reviveGame.beat) { reviveGame.beat = beat; reviveGame.judged = false; }
      var phase = (elapsed % beatMs) / beatMs; // 0..1 across the beat
      var pos = phase < 0.5 ? phase * 2 : 2 - phase * 2; // ping-pong 0..1..0
      reviveGame.pos = pos * 100;
      if (reviveMarkerEl) reviveMarkerEl.style.left = 'calc(' + (pos * 100).toFixed(1) + '% - 2px)';
      if (reviveScoreEl) reviveScoreEl.textContent = 'Nhịp ' + reviveGame.beat + '/10 • Đúng ' + reviveGame.hits;
      reviveGame.raf = requestAnimationFrame(step);
    };
    reviveGame.raf = requestAnimationFrame(step);
  }
  function tapReviveBeat() {
    if (!reviveGame || reviveGame.judged) return;
    reviveGame.judged = true;
    // Green zone is 42–58% of the bar (see #reviveZone in index.html).
    var pct = (reviveGame.pos === undefined) ? 50 : reviveGame.pos;
    if (pct >= 42 && pct <= 58) {
      reviveGame.hits += 1;
      sfx('accept');
    } else {
      sfx('error');
    }
    if (reviveScoreEl) reviveScoreEl.textContent = 'Nhịp ' + reviveGame.beat + '/10 • Đúng ' + reviveGame.hits;
  }
  function finishReviveGame() {
    if (!reviveGame) return;
    var g = reviveGame;
    stopReviveGame(true);
    var pct = Math.round(g.hits / 10 * 100);
    if (ctx.sys) ctx.sys('Cấp cứu theo nhịp: đúng ' + g.hits + '/10 (' + pct + '%)' +
      (pct >= 90 ? ' — xuất sắc! Nạn nhân hồi thêm +20 HP.' : ' — chưa đạt 90%, nạn nhân hồi 30 HP gốc.'));
    if (ctx.sendRevive) ctx.sendRevive(g.targetId, pct);
  }
  function stopReviveGame(hide) {
    if (reviveGame && reviveGame.raf) cancelAnimationFrame(reviveGame.raf);
    reviveGame = null;
    if (hide && revivePanelEl) revivePanelEl.classList.remove('open');
  }

  // ---- panel ----
  function jobErrText(res) {
    switch (res && res.error) {
      case 'NOT_SHIPPER': return 'Bạn chưa chọn nghề Shipper — bấm nút Shipper ở trên trước.';
      case 'FAINTED': return 'Bạn đang ngất, không làm đơn được.';
      case 'ALREADY_HAVE_ORDER': return 'Bạn đang có 1 đơn rồi — giao xong / hủy rồi mới nhận đơn mới.';
      case 'COOLDOWN': return 'Vừa hủy đơn, chờ ' + (res.retryAfterSec || 10) + 's nữa mới nhận đơn mới.';
      case 'TOO_FAR': return 'Chưa tới nơi — tới Kho Hàng Trung Tâm hoặc một cửa hàng (Cửa Hàng Tiện Lợi, Nhà Trọ, Chợ, Quán Cà Phê) để nhận đơn, tới đúng điểm giao để giao hàng.';
      case 'NO_ORDER': return 'Bạn chưa có đơn nào.';
      case 'ALREADY_PROCESSED': return 'Đơn này đã giao xong rồi (chống trùng).';
      case 'EXPIRED': return 'Đơn đã hết hạn — không thưởng, nhận đơn mới được rồi.';
      case 'ACTIVE_ORDER': return 'Đang có đơn Shipper — giao xong / hủy rồi mới đổi nghề.';
      case 'ACTIVE_RIDE': return 'Đang chở khách Taxi — trả khách xong rồi mới đổi nghề.';
      case 'ORDER_TAKEN': return 'Đơn này vừa có người nhận — đã cấp đơn khác cho bạn.';
      case 'NOT_TAXI_DRIVER': return 'Chọn nghề Tài xế trước đã.';
      case 'NO_MOTORBIKE': return 'Taxi phải dùng xe máy — mua xe máy ở Showroom trước.';
      case 'NOT_RIDING_MOTORBIKE': return 'Bạn phải đang đi xe máy mới chở được khách.';
      case 'ALREADY_RIDING': return 'Bạn đang chở 1 khách rồi — trả khách xong mới đón khách mới.';
      case 'INVALID_TARGET': return 'Không đón được khách này.';
      case 'TARGET_FAINTED': return 'Khách đang ngất xỉu.';
      case 'TARGET_RIDING': return 'Người này đang đi xe rồi.';
      case 'NO_INVITE': return 'Không có lời mời đi xe nào.';
      case 'INVITE_EXPIRED': return 'Lời mời đi xe đã hết hạn (30s).';
      case 'DRIVER_GONE': return 'Tài xế đã đi mất rồi.';
      case 'DECLINED': return 'Khách đã từ chối lên xe.';
      case 'NO_RIDE': return 'Bạn không chở khách nào.';
      case 'NO_VEHICLE': return 'Bạn chưa có xe này — mua ở Showroom trước.';
      case 'ALREADY_OWNED': return 'Bạn đã có xe này rồi.';
      case 'NO_ROOM': return 'Bạn chưa thuê phòng nào.';
      case 'CHEST_LOCKED': return 'Rương đang bị khóa (phòng hết hạn) — gia hạn phòng để mở lại.';
      case 'CHEST_FULL': return 'Rương đã đầy 10 ô.';
      default: return 'Lỗi: ' + ((res && res.error) || 'không rõ');
    }
  }

  // Online taxi state mirror (set by main.js from taxi_result messages).
  var onlineTaxi = { taxiMode: false, ride: null, customers: [] };
  function setOnlineTaxi(t) { onlineTaxi = t || onlineTaxi; render(); }
  function getOnlineTaxiCustomers() { return onlineTaxi.customers || []; }
  function getTaxiRide() { return isOnline() ? onlineTaxi.ride : localTaxiRide; }

  function setJob(job) {
    var st = state();
    if (!st) return;
    if (isOnline()) {
      if (ctx.sendJob) ctx.sendJob(job);
      return;
    }
    if (localOrder && job !== 'shipper') {
      if (ctx.sys) ctx.sys(jobErrText({ error: 'ACTIVE_ORDER' }));
      return;
    }
    st.job = job;
    if (ctx.sys) ctx.sys('Đã chọn nghề: ' + (M3 ? M3.JOB_LABELS[job] : job) +
      (job === 'taxi_driver' ? ' — mua xe máy ở Showroom, bật "Nhận khách" rồi đón khách ở ngã tư (cước 1.000đ/100 px).' : '.'));
    sfx('jobPick');
    render();
  }

  function render() {
    if (!panelEl) return;
    var st = state();
    if (!st) return;
    var label = (M3 ? M3.JOB_LABELS[st.job] : st.job) || 'Chưa có';
    if (jobLineEl) jobLineEl.textContent = 'Nghề hiện tại: ' + label +
      (st.job === 'shipper' ? ' — nhận đơn ở Kho Hàng / các cửa hàng.' : '');
    Object.keys(jobBtns).forEach(function (j) {
      if (jobBtns[j]) jobBtns[j].classList.toggle('active', st.job === j);
    });
    var order = getOrder();
    var now = Date.now();
    if (orderInfoEl) {
      if (!order) {
        var cd = isOnline() ? 0 : Math.max(0, Math.ceil((localCancelCooldownUntil - now) / 1000));
        orderInfoEl.textContent = st.job === 'shipper'
          ? (cd > 0 ? 'Chờ ' + cd + 's nữa mới nhận đơn mới (vừa hủy đơn).'
            : 'Chưa có đơn — tới Kho Hàng hoặc cửa hàng (Tiện Lợi, Nhà Trọ, Chợ, Cà Phê) rồi bấm Nhận đơn.')
          : 'Chọn nghề Shipper để nhận đơn giao hàng.';
      } else {
        var secLeft = Math.max(0, Math.ceil((order.deadlineAt - now) / 1000));
        var d = Math.round(dist(st.x, st.y, order.targetX, order.targetY));
        orderInfoEl.textContent = 'Đơn ' + order.id + ' • Lấy: ' + (order.pickupName || 'Kho Hàng Trung Tâm') +
          ' → ' + (order.poiName || 'điểm giao') +
          ' • cách ' + d + 'm • còn ' + secLeft + 's • thưởng ' + fmt(order.reward);
      }
    }
    var nearSrc = M3 && M3.nearestShipperSource ? M3.nearestShipperSource(st.x, st.y) : null;
    var nearPickup = !!(nearSrc && nearSrc.distance <= M3.SHIPPER_RANGE);
    var nearTarget = order && dist(st.x, st.y, order.targetX, order.targetY) <= M3.DELIVER_RANGE;
    if (acceptBtn) acceptBtn.disabled = !(st.job === 'shipper' && !order && !st.isFainted && nearPickup);
    if (completeBtn) completeBtn.disabled = !(order && !st.isFainted && nearTarget);
    if (cancelBtn) cancelBtn.disabled = !order;
    if (acceptBtn) acceptBtn.title = nearPickup ? '' : 'Tới Kho Hàng Trung Tâm hoặc cửa hàng để nhận đơn';
    if (completeBtn) completeBtn.title = nearTarget ? '' : 'Tới trong 80px quanh điểm giao để giao hàng';

    // M4: vehicle section — owned vehicles + riding state.
    if (vehicleInfoEl) {
      var vs = vehicleState();
      var parts = [];
      if (vs.bicycle.owned) parts.push('Xe đạp' + (vs.riding === 'bicycle' ? ' (đang đi, độ bền ' + Math.floor(vs.bicycle.durability) + '%)' : ' (độ bền ' + Math.floor(vs.bicycle.durability) + '%)'));
      if (vs.motorbike.owned) parts.push('Xe máy' + (vs.riding === 'motorbike' ? ' (đang đi, xăng ' + Math.floor(vs.motorbike.fuel) + '%)' : ' (xăng ' + Math.floor(vs.motorbike.fuel) + '%)'));
      vehicleInfoEl.textContent = parts.length
        ? 'Xe: ' + parts.join(' • ') + (vs.riding ? '' : ' — tới gần xe rồi bấm Lên xe (E).')
        : 'Xe: chưa có — mua ở Showroom (250.000đ xe đạp / 1.000.000đ xe máy).';
    }
    if (mountBtn) mountBtn.disabled = !!ridingVehicleId() || st.isFainted;
    if (dismountBtn) dismountBtn.disabled = !ridingVehicleId();

    // M4: taxi section.
    if (taxiInfoEl) {
      var ride = getTaxiRide();
      if (ride) {
        taxiInfoEl.textContent = 'Taxi: đang chở khách' +
          (ride.poiName ? ' tới ' + ride.poiName : '') +
          ' • đã đi ' + Math.round(ride.distancePx || 0) + 'm — bấm Trả khách khi tới nơi.';
      } else if (isOnline() ? onlineTaxi.taxiMode : taxiMode) {
        var n = taxiCustomers().length;
        taxiInfoEl.textContent = 'Taxi: đang Nhận khách — có ' + n + ' khách vãng lai gần đây. Lên xe máy rồi bấm Đón khách.';
      } else {
        taxiInfoEl.textContent = 'Taxi: chọn nghề Tài xế + có xe máy rồi bật "Nhận khách".';
      }
    }
    if (taxiToggleBtn) {
      taxiToggleBtn.textContent = 'Nhận khách: ' + ((isOnline() ? onlineTaxi.taxiMode : taxiMode) ? 'BẬT' : 'TẮT');
      taxiToggleBtn.disabled = st.job !== 'taxi_driver';
    }
    if (taxiPickupBtn) {
      // M4: when a driver invited ME, this button accepts the ride.
      if (isOnline() && onlineTaxi.invitedBy) {
        taxiPickupBtn.textContent = 'Lên xe';
        taxiPickupBtn.disabled = st.isFainted;
      } else {
        taxiPickupBtn.textContent = 'Đón khách';
        taxiPickupBtn.disabled = !(st.job === 'taxi_driver' && ridingVehicleId() === 'motorbike' && !getTaxiRide() && !st.isFainted);
      }
    }
    if (taxiDropoffBtn) taxiDropoffBtn.disabled = !getTaxiRide();
  }

  function openPanel() {
    if (!panelEl) return;
    var wasOpen = panelEl.classList.contains('open');
    closeAllPanels();
    if (!wasOpen) { render(); panelEl.classList.add('open'); }
  }
  function closeAllPanels() {
    if (panelEl) panelEl.classList.remove('open');
    if (typeof window.closePanels === 'function') window.closePanels();
    else {
      var sp = document.getElementById('shopPanel'), ap = document.getElementById('atmPanel');
      if (sp) sp.classList.remove('open');
      if (ap) ap.classList.remove('open');
    }
  }

  function tick(dt) {
    // Offline: expire overdue orders (§6.2) + refresh the panel ~4x/s.
    if (!isOnline() && localOrder && Date.now() > localOrder.deadlineAt) {
      var id = localOrder.id;
      localOrder = null;
      if (ctx.sys) ctx.sys('Đơn ' + id + ' đã hết hạn (EXPIRED) — không thưởng, nhận đơn mới được rồi.');
      vfx('clearPath');
    }
    // M4: offline taxi engine (spawn/despawn customers, ride distance,
    // auto-dropoff at the destination).
    taxiTick(dt);
    uiAccum += dt;
    if (uiAccum > 0.25) { uiAccum = 0; render(); }
  }

  function init(c) {
    ctx = c;
    panelEl = el('jobPanel');
    orderInfoEl = el('jobOrderInfo');
    jobLineEl = el('jobCurrent');
    acceptBtn = el('jobAccept');
    completeBtn = el('jobComplete');
    cancelBtn = el('jobCancel');
    // M4 panel controls.
    vehicleInfoEl = el('jobVehicleInfo');
    mountBtn = el('vehicleMount');
    dismountBtn = el('vehicleDismount');
    taxiInfoEl = el('taxiInfo');
    taxiToggleBtn = el('taxiToggle');
    taxiPickupBtn = el('taxiPickup');
    taxiDropoffBtn = el('taxiDropoff');
    revivePanelEl = el('revivePanel');
    reviveMarkerEl = el('reviveMarker');
    reviveScoreEl = el('reviveScore');
    reviveTapBtn = el('reviveTap');
    if (reviveTapBtn) reviveTapBtn.addEventListener('click', tapReviveBeat);
    var reviveCancelBtn = el('reviveCancel');
    if (reviveCancelBtn) reviveCancelBtn.addEventListener('click', function () {
      stopReviveGame(true);
      if (ctx.sys) ctx.sys('Đã hủy mini-game cấp cứu — bấm Cấp cứu lại để chơi lại (không có thưởng thêm).');
    });
    if (mountBtn) mountBtn.addEventListener('click', function () { sfx('click'); mountNearest(); });
    if (dismountBtn) dismountBtn.addEventListener('click', function () { sfx('click'); dismountCurrent(); });
    if (taxiToggleBtn) taxiToggleBtn.addEventListener('click', function () { toggleTaxiMode(); });
    if (taxiPickupBtn) taxiPickupBtn.addEventListener('click', function () { sfx('click'); pickupTaxiCustomer(); });
    if (taxiDropoffBtn) taxiDropoffBtn.addEventListener('click', function () { sfx('click'); dropoffTaxi(); });
    var closeBtn = el('jobClose');
    if (closeBtn) closeBtn.addEventListener('click', closeAllPanels);
    var jobBtn = el('jobBtn');
    if (jobBtn) jobBtn.addEventListener('click', function () { openPanel(); });
    ['shipper', 'doctor', 'taxi_driver'].forEach(function (job) {
      var b = el('jobPick_' + job);
      if (b) {
        jobBtns[job] = b;
        b.addEventListener('click', function () { setJob(job); });
      }
    });
    if (acceptBtn) acceptBtn.addEventListener('click', function () {
      sfx('click');
      var res;
      if (isOnline()) { if (ctx.sendShipper) ctx.sendShipper('accept'); return; }
      res = localAccept();
      if (!res.ok && ctx.sys) ctx.sys(jobErrText(res));
    });
    if (completeBtn) completeBtn.addEventListener('click', function () {
      sfx('click');
      var res;
      if (isOnline()) {
        var order = getOrder();
        if (ctx.sendShipper) ctx.sendShipper('complete', order ? { orderId: order.id } : null);
        return;
      }
      res = localComplete();
      if (!res.ok && ctx.sys) ctx.sys(jobErrText(res));
    });
    if (cancelBtn) cancelBtn.addEventListener('click', function () {
      sfx('click');
      if (isOnline()) { if (ctx.sendShipper) ctx.sendShipper('cancel'); return; }
      var res = localCancel();
      if (!res.ok && ctx.sys) ctx.sys(jobErrText(res));
    });
    render();
  }

  if (typeof window !== 'undefined') {
    window.Jobs = {
      init: init, tick: tick, render: render, getOrder: getOrder,
      onLocalFaint: onLocalFaint, openPanel: openPanel,
      jobErrText: jobErrText,
      // M4
      getTaxiCustomers: taxiCustomers, getTaxiRide: getTaxiRide,
      setOnlineTaxi: setOnlineTaxi, getOnlineTaxiCustomers: getOnlineTaxiCustomers,
      startReviveGame: startReviveGame, stopReviveGame: stopReviveGame,
      mountNearest: mountNearest, dismountCurrent: dismountCurrent,
      ridingVehicleId: ridingVehicleId, toggleTaxiMode: toggleTaxiMode,
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { init: init, tick: tick, getOrder: getOrder };
  }
})();
