/* Đô Thị Ảo — server/rooms/CityRoom.js
   M1 Colyseus room "city": authoritative movement (§7.4), survival (§3.2),
   chat + Bot AI (§10), NPC/bot wandering. Plain JS, Colyseus 0.15.
   Bots live in state.players (they look like normal players to the client);
   the guide + walkers live in state.npcs. */
const { Room } = require('colyseus');
const { PlayerState, NpcState, CityRoomState } = require('../schema');
const Colliders = require('../../shared/colliders');
const BotBrain = require('../../shared/botBrain');
const M3 = require('../../shared/m3');
const { randomUUID } = require('crypto');
const stats = require('../stats');
const sb = require('../supabase');

const WALK_SPEED = 180, SPRINT_SPEED = 300;
const HOSPITAL = { x: 4125, y: 1635 }; // SRS §3.1 POI (== M3.HOSPITAL_POS, Map v2)
const HOSPITAL_SPAWN = M3.HOSPITAL_SPAWN || { x: 4125, y: 1890 }; // Open ground south of Hospital (never spawn inside collider)
const MOTEL_SPAWN = M3.MOTEL_SPAWN || { x: 2910, y: 3100 }; // Open ground south of Motel (never spawn inside collider)
const GUIDE_POS = { x: 2400, y: 2520 }; // Map v2 (clear of the fountain)
const SPAWN = { x: 2400, y: 2625 }; // Map v2 plaza south edge
const CHAT_BUBBLE_MS = 4000;
const NEARBY_RADIUS = 600;
const FAINT_SECONDS = 60;
// M3: test hook. The local test suite (server/test/test.js) sets
// DTA_ALLOW_TEST=1 and may send '__test_set' to set its OWN player's
// hp/hunger/cash so faint/doctor flows can be tested without waiting 25
// minutes. NEVER enabled in production (env var unset -> ignored).
const ALLOW_TEST = process.env.DTA_ALLOW_TEST === '1';

const WALKER_NAMES = ['An', 'Bình', 'Chi', 'Dũng', 'Hà', 'Khánh', 'Linh', 'Minh', 'Ngọc', 'Phúc', 'Thu', 'Tuấn'];
const WALKER_AVATARS = ['shipper', 'bread', 'police', 'thug', 'student'];
// M3 skills revision (image-gen audit): avatar and persona lists MUST
// index-align, and 'taxi' (Chú Ba — v3 sprite is standing with a helmet,
// reserved for the Guide + bot Chú Ba) and 'hero' (looks exactly like the
// player) must never be walkers — the old lists cycled 5 avatars against
// 6 personas, so e.g. walker-2 (bread sprite) talked as Chú Ba.
const WALKER_PERSONAS = ['tung', 'lan', 'cong', 'ty', 'mai'];

// M2 economy (§4/§5.7): server price table — the client never sets prices.
// Mirrors game_items seed (supabase/migrations/001_m2.sql). When Supabase is
// connected the RPCs replace these in-memory stubs (same rules, same limits).
const SHOP_ITEMS = {
  banh_mi: { price: 15000, dayPrice: 13500, hunger: 40, stamina: 0 },
  nuoc_tang_luc: { price: 10000, dayPrice: 10000, hunger: 0, stamina: 50 },
};
const STARTER_GRANT = 80000; // v2.2 (supersedes v2.1: 50.000đ)
const ATM_MIN = 1000, ATM_MAX = 200000, ATM_DAY_MAX = 500000;
const SHOP_POS = { x: 2895, y: 1590 }; // Cửa Hàng Tiện Lợi POI (Map v2)
const BANK_POS = { x: 1650, y: 1590 }; // Ngân Hàng & ATM POI (Map v2)
const SHOWROOM_POS = { x: 1665, y: 2850 }; // Showroom Xe Máy POI (Map v2)
const MOTEL_POS = { x: 2910, y: 2865 }; // Khu Nhà Trọ POI (Map v2)
const ECON_RANGE = 300;
// M4 taxi: NPC customers wait at road intersections (road centres 1230 /
// 2430 / 3630 — bands 1140/2340/3540 + 180 wide).
const TAXI_INTERSECTIONS = [
  { x: 1230, y: 1230 }, { x: 2430, y: 1230 }, { x: 3630, y: 1230 },
  { x: 1230, y: 2430 }, { x: 3630, y: 2430 },
  { x: 1230, y: 3630 }, { x: 2430, y: 3630 }, { x: 3630, y: 3630 },
];
const ECON_RATE_LIMIT = 5; // max 5 economy messages / minute per player (SRS §12.3)
function todayStr() { return new Date().toISOString().slice(0, 10); }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function randRange(a, b) { return a + Math.random() * (b - a); }
// Map v2: one blocked() test for all server movement — buildings + garden
// fences (except the corner gaps) + the plaza fountain circle.
function blocked(x, y, r) {
  return Colliders.hitBuilding(x, y, r) || Colliders.hitFence(x, y, r) || Colliders.inFountain(x, y, r);
}
// Random open point biased toward the spawn plaza so bots stay near players
// (keeps nearby-chat bot replies reachable in tests and in real play).
function randomOpenPointNearSpawn(maxR) {
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * maxR;
    const x = SPAWN.x + Math.cos(a) * r, y = SPAWN.y + Math.sin(a) * r;
    if (Colliders.isOpenPoint(x, y)) return { x, y };
  }
  return Colliders.randomOpenPoint();
}

class CityRoom extends Room {
  maxClients = 8; // M1 acceptance: 8 players (SRS §2, §7.1: 16 later)
  patchRate = 50; // 20 Hz

  onCreate() {
    this.setState(new CityRoomState());
    stats.rooms += 1;

    // Server-only bookkeeping (never synced to clients).
    this.clientData = new Map(); // sessionId -> {lastSeq, moveTimes, violations, lastMoveAt, chatTimes, econTimes, isBot}
    this.survival = new Map(); // playerId -> {hungerAcc, hpLossAcc, regenAcc, faintedUntil}
    this.bots = new Map(); // botId -> {personaId, brain, targetX, targetY, pauseUntil, speed, nextProactiveAt}
    this.walkers = new Map(); // npcId -> {targetX, targetY, pauseUntil, speed}
    this.pendingBotReplies = new Set(); // timeout handles, cleared on dispose
    this.economy = new Map(); // sessionId -> {inventory, txLog, processed, granted, atmDay} (M2, in-memory; Supabase RPC replaces in production)
    // M3 jobs (in-memory mirror of the player_jobs table shape, §5.4):
    // sessionId -> {order, cancelCooldownUntil, completedOrderIds, doctor}
    //   order: {id, slotId, targetX, targetY, poiName, pickupId, pickupName,
    //           pickupX, pickupY, distance, reward,
    //           deadlineAt, idempotencyKey, status, jobType, userId} | null
    //   doctor: {lastRewardedAt, revives: [{victimId, at, rewarded}]}
    this.jobs = new Map();
    // M3 order pool (§6.2 first-come-first-served): 12 fixed delivery slots.
    // A slot is locked while its order is active; on release the slot gets a
    // NEW random target, so the next player always gets a different order.
    // maxClients is 8, so the pool can never run dry in P0.
    // Multi-shop (user 2026-11-25): every slot ALSO has a pickup source
    // (M3.pickOrderSource: 50% warehouse, 50% a shop) — the player accepts
    // within 300px of THAT slot's pickup, not always at the warehouse.
    this.orderPool = [];
    for (let i = 0; i < 12; i++) {
      const src = M3.pickOrderSource();
      const t = M3.pickDeliveryPoint(null, src.id);
      this.orderPool.push({ id: 'ord-' + i, targetX: t.x, targetY: t.y, poiName: t.poiName, lockedBy: null,
        pickupId: src.id, pickupName: src.name, pickupX: src.x, pickupY: src.y });
    }
    this.orderSeq = 0;
    // M4 vehicles (§8.1, in-memory mirror of the assets table shape §5.3):
    // sessionId -> { bicycle: {fuel, durability, x, y} | null,
    //               motorbike: {fuel, durability, x, y} | null }
    // A vehicle with x/y is PARKED there (null = never parked / at
    // showroom). The ridden vehicle is player.vehicleId / vehicleType.
    // NOTE: keyed by sessionId — a reconnect gets a NEW sessionId, so
    // vehicles/motel do not survive a rejoin yet (Supabase assets wiring
    // is M2/M5 work); the offline client persists them in localStorage.
    this.vehicles = new Map();
    // M4 motel (§8.2): sessionId -> { expiresAt, chest: Map(itemId->qty) }.
    this.motel = new Map();
    // M4 taxi (§3.4.2, §10.2): driver sessionIds with "Nhận khách" on,
    // pending player invites, active rides, and NPC customers.
    this.taxiMode = new Set(); // sessionId
    this.taxiInvites = new Map(); // targetId -> {driverId, at}
    this.taxiRides = new Map(); // driverId -> {passengerId, kind, npcId, destX, destY, poiName, distancePx, startedAt}
    this.taxiCustomers = new Map(); // npcId -> {destX, destY, poiName, spawnedAt}
    this.taxiCustomerSeq = 0;
    // M3: orders held when a player disconnects mid-order (§6.2: 30 s to
    // reconnect, then EXPIRED). key -> {order, leftAt}.
    this.heldOrders = new Map();
    // M5: debounced Supabase persistence timers per sessionId.
    this._persistTimers = new Map();
    this._saveTickAcc = 0;

    this._spawnBots();
    this._spawnNpcs();

    // 100 ms simulation: bot + walker wandering (smooth enough for 20 Hz patches).
    this.setSimulationInterval((dtMs) => this._simStep(dtMs), 100);
    // 1 s tick: world clock + survival + bot proactive chat + bubble expiry.
    this._tickTimer = setInterval(() => this._secondTick(), 1000);
  }

  onDispose() {
    clearInterval(this._tickTimer);
    for (const t of this.pendingBotReplies) clearTimeout(t);
    this.pendingBotReplies.clear();
    if (this._persistTimers) {
      for (const t of this._persistTimers.values()) clearTimeout(t);
      this._persistTimers.clear();
    }
    stats.rooms -= 1;
  }

  // ---------------------------------------------------------------- spawn
  _spawnBots() {
    for (const persona of BotBrain.PERSONAS) {
      const id = 'bot-' + persona.id;
      const p = randomOpenPointNearSpawn(800);
      const ps = new PlayerState();
      Object.assign(ps, {
        id, name: persona.name, x: p.x, y: p.y, vx: 0, vy: 0,
        anim: 'idle', job: 'unemployed', hp: 100, hunger: 100, stamina: 100,
        cash: 0, bank: 0, isFainted: false, vehicleId: '',
        chatBubble: '', chatBubbleUntil: 0, avatar: persona.avatar,
      });
      this.state.players.set(id, ps);
      this.bots.set(id, {
        personaId: persona.id,
        brain: BotBrain.createBotState(persona.id),
        targetX: p.x, targetY: p.y, pauseUntil: 0,
        speed: randRange(45, 75), // M0 NPC speed range
        nextProactiveAt: Date.now() + randRange(5000, 25000),
      });
      this.clientData.set(id, { isBot: true });
    }
  }

  _spawnNpcs() {
    const guide = new NpcState();
    Object.assign(guide, {
      id: 'npc-guide', type: 'guide', name: 'NPC Hướng Dẫn',
      x: GUIDE_POS.x, y: GUIDE_POS.y, targetX: GUIDE_POS.x, targetY: GUIDE_POS.y,
      avatar: 'guide',
    });
    this.state.npcs.set(guide.id, guide);

    for (let i = 0; i < 10; i++) {
      const p = Colliders.randomOpenPoint();
      const npc = new NpcState();
      Object.assign(npc, {
        id: 'npc-walker-' + i, type: 'walker',
        name: WALKER_NAMES[i % WALKER_NAMES.length],
        x: p.x, y: p.y, targetX: p.x, targetY: p.y,
        avatar: WALKER_AVATARS[i % WALKER_AVATARS.length],
      });
      this.state.npcs.set(npc.id, npc);
      // M3 (§10.2): walkers wander at 90 px/s (was 45-75), pause 3-8 s,
      // and each one has a BotBrain persona so "Nói chuyện" (§10.2) gets a
      // persona line in the matching voice (index-aligned with WALKER_AVATARS).
      this.walkers.set(npc.id, {
        targetX: p.x, targetY: p.y, pauseUntil: 0, speed: 90,
        personaId: WALKER_PERSONAS[i % WALKER_PERSONAS.length],
        lastTalkLine: null,
      });
    }
  }

  // ---------------------------------------------------------------- join/leave
  async onAuth(client, options = {}) {
    if (!sb.isConfigured()) {
      return { userId: null, isGuest: true };
    }
    const token = options && typeof options.accessToken === 'string' ? options.accessToken.trim() : '';
    if (!token) {
      return { userId: null, isGuest: true };
    }
    const { user, error } = await sb.verifyToken(token);
    if (error || !user) {
      throw new Error('AUTH_INVALID: ' + (error || 'unauthorized'));
    }
    return { userId: user.id, email: user.email || null, isGuest: false };
  }

  async onJoin(client, options = {}, auth = {}) {
    const userId = (auth && auth.userId) ? auth.userId : null;
    // Kick any stale active session for the same userId before loading state.
    if (userId) {
      for (const c of this.clients) {
        if (c.sessionId === client.sessionId) continue;
        const d = this.clientData.get(c.sessionId);
        if (d && d.userId === userId) {
          await this._persistNow(c.sessionId);
          try { c.leave(4001); } catch (e) { /* ignore */ }
        }
      }
    }

    const p = new PlayerState();
    let spawn = randomOpenPointNearSpawn(200);
    let name = (typeof options.name === 'string' && options.name.trim())
      ? options.name.trim().slice(0, 24) : 'CongDan-' + client.sessionId.slice(0, 4);
    let avatar = (typeof options.avatar === 'string' && options.avatar.trim())
      ? options.avatar.trim().slice(0, 24) : 'hero';

    let cash = 0, bank = 0, job = 'unemployed', hp = 100, hunger = 100, stamina = 100;
    let invMap = new Map();
    let vehObj = { bicycle: null, motorbike: null };
    let motelObj = null;
    let granted = false;
    let atmToday = 0;

    if (userId && sb.isConfigured()) {
      try {
        const loaded = await sb.loadPlayerState(userId, name, avatar);
        if (loaded && loaded.profile) {
          const prof = loaded.profile;
          if (!options.name && prof.display_name) name = String(prof.display_name).slice(0, 24);
          if (!options.avatar && prof.avatar_key) avatar = String(prof.avatar_key).slice(0, 24);
          cash = Math.max(0, Number(prof.cash) || 0);
          bank = Math.max(0, Number(prof.bank) || 0);
          job = M3.JOBS.includes(prof.job) ? prof.job : 'unemployed';
          hp = clamp(Number(prof.hp ?? 100), 0, 100);
          hunger = clamp(Number(prof.hunger ?? 100), 0, 100);
          stamina = clamp(Number(prof.stamina ?? 100), 0, 100);
          invMap = loaded.inventory || new Map();
          vehObj = loaded.vehicles || { bicycle: null, motorbike: null };
          motelObj = loaded.motel || null;
          if (motelObj && M3.motelChestState(motelObj.expiresAt, Date.now()) === 'deleted') {
            motelObj.chest.clear();
          }
          granted = !!loaded.granted;
          atmToday = Number(loaded.atmToday) || 0;

          const hasActiveMotel = !!(motelObj && M3.motelIsActive(motelObj.expiresAt, Date.now()));
          if (hp <= 0) {
            hp = 50; stamina = 50;
            spawn = hasActiveMotel ? { x: MOTEL_SPAWN.x, y: MOTEL_SPAWN.y } : { x: HOSPITAL_SPAWN.x, y: HOSPITAL_SPAWN.y };
          } else if (typeof prof.x === 'number' && typeof prof.y === 'number' && !blocked(prof.x, prof.y, 16)) {
            spawn = { x: clamp(prof.x, 20, 4780), y: clamp(prof.y, 20, 4780) };
          } else if (hasActiveMotel) {
            spawn = { x: MOTEL_SPAWN.x, y: MOTEL_SPAWN.y };
          }
        }
      } catch (err) {
        console.error('[city] supabase loadPlayerState failed:', err && err.message ? err.message : err);
      }
    }

    Object.assign(p, {
      id: client.sessionId, name, x: spawn.x, y: spawn.y, vx: 0, vy: 0,
      anim: 'idle', job, hp, hunger, stamina,
      cash, bank,
      isFainted: false, vehicleId: '', vehicleType: '', fuel: 100,
      durability: 100, passengerId: '', roomExpiresAt: motelObj ? motelObj.expiresAt : 0,
      chatBubble: '', chatBubbleUntil: 0, avatar,
      orderStatus: 'none', orderId: '', orderX: 0, orderY: 0, orderDeadline: 0, orderReward: 0,
      orderPickupX: 0, orderPickupY: 0, orderPickupName: '',
    });
    this.state.players.set(client.sessionId, p);
    this.clientData.set(client.sessionId, {
      isBot: false, userId, lastSeq: 0, moveTimes: [], violations: [],
      lastMoveAt: Date.now(), chatTimes: [], econTimes: [], sprinting: false,
    });
    const econEntry = {
      userId, sessionId: client.sessionId,
      inventory: invMap, txLog: [], processed: new Set(), granted,
      atmDay: { date: todayStr(), total: atmToday },
    };
    this.economy.set(client.sessionId, econEntry);
    this.survival.set(client.sessionId, { hungerAcc: 0, hpLossAcc: 0, regenAcc: 0, faintedUntil: 0, faintedAt: 0 });
    const jobEntry = {
      order: null, cancelCooldownUntil: 0, completedOrderIds: new Set(),
      doctor: { lastRewardedAt: 0, revives: [] },
    };
    // M5: restore held Shipper order if reconnecting within 30 s.
    if (userId && this.heldOrders.has(userId)) {
      const held = this.heldOrders.get(userId);
      this.heldOrders.delete(userId);
      if (held && held.order && Date.now() <= held.order.deadlineAt) {
        held.order.userId = client.sessionId;
        jobEntry.order = held.order;
        this._syncOrderState(p, held.order);
      } else if (held && held.order) {
        this._releaseOrderSlot(held.order);
      }
    }
    this.jobs.set(client.sessionId, jobEntry);
    this.vehicles.set(client.sessionId, vehObj);
    if (motelObj) this.motel.set(client.sessionId, motelObj);
    stats.humanPlayers += 1;
    console.log(`[city] join ${p.name} (${client.sessionId}${userId ? ' uid=' + userId.slice(0, 8) : ' guest'}) players=${stats.humanPlayers}`);

    this.onMessage('move', (c, msg) => this._onMove(c, msg));
    this.onMessage('chat', (c, msg) => this._onChat(c, msg));
    this.onMessage('interact', (c, msg) => this._onInteract(c, msg));
    // M2 economy messages (validated server-side; see _onShopBuy etc.)
    this.onMessage('econ_sync', (c) => this._onEconSync(c));
    this.onMessage('starter_grant', (c, msg) => this._onStarterGrant(c, msg));
    this.onMessage('shop_buy', (c, msg) => this._onShopBuy(c, msg));
    this.onMessage('atm_transfer', (c, msg) => this._onAtmTransfer(c, msg));
    this.onMessage('use_item', (c, msg) => this._onUseItem(c, msg));
    // M3: job choice + Shipper orders (§3.4, §6).
    this.onMessage('job', (c, msg) => this._onJob(c, msg));
    this.onMessage('shipper', (c, msg) => this._onShipper(c, msg));
    // M4: vehicles (§8.1), taxi (§3.4.2), motel (§8.2).
    this.onMessage('vehicle', (c, msg) => this._onVehicle(c, msg));
    this.onMessage('taxi', (c, msg) => this._onTaxi(c, msg));
    this.onMessage('motel', (c, msg) => this._onMotel(c, msg));
    if (ALLOW_TEST) this.onMessage('__test_set', (c, msg) => this._onTestSet(c, msg));
  }

  // M3 test hook (see ALLOW_TEST above): set the SENDER's own hp/hunger/
  // cash/bank, or force the faint countdown to end (faintMsLeft). The test
  // suite uses it to reach faint/hospital/doctor states without waiting
  // 25 real minutes. Ignored entirely unless DTA_ALLOW_TEST=1.
  _onTestSet(client, msg) {
    const player = this.state.players.get(client.sessionId);
    const sv = this.survival.get(client.sessionId);
    if (!player || !sv || !msg || typeof msg !== 'object') return;
    if (typeof msg.hp === 'number') player.hp = clamp(msg.hp, 0, 100);
    if (typeof msg.hunger === 'number') player.hunger = clamp(msg.hunger, 0, 100);
    if (typeof msg.cash === 'number') player.cash = Math.max(0, Math.floor(msg.cash));
    if (typeof msg.bank === 'number') player.bank = Math.max(0, Math.floor(msg.bank));
    if (typeof msg.x === 'number') player.x = clamp(msg.x, 20, 4780); // Map v2: 4800-20
    if (typeof msg.y === 'number') player.y = clamp(msg.y, 20, 4780);
    // M4 test hook: set the ridden vehicle's fuel / durability so
    // out-of-fuel and worn-out-bicycle behaviour can be tested directly.
    if (typeof msg.fuel === 'number') {
      player.fuel = clamp(msg.fuel, 0, 100);
      const v = this.vehicles.get(client.sessionId);
      if (v && v.motorbike) v.motorbike.fuel = player.fuel;
    }
    if (typeof msg.durability === 'number') {
      player.durability = clamp(msg.durability, 0, 100);
      const v = this.vehicles.get(client.sessionId);
      if (v && v.bicycle) v.bicycle.durability = player.durability;
    }
    if (typeof msg.faintMsLeft === 'number' && player.isFainted) {
      sv.faintedUntil = Date.now() + msg.faintMsLeft;
    }
    console.log(`[city] __test_set ${player.name}: hp=${player.hp} hunger=${player.hunger} cash=${player.cash}`);
  }

  async onLeave(client, consented) {
    // M4: end any taxi ride involving the leaver — a passenger who leaves
    // strands the driver (no fare: the trip never finished), a driver who
    // leaves strands the passenger. The vehicle stays parked where the
    // player left it (§8.1: no loss on faint/disconnect).
    const rideAsDriver = this.taxiRides.get(client.sessionId);
    if (rideAsDriver) {
      const pass = this.state.players.get(rideAsDriver.passengerId);
      if (pass) pass.passengerId = '';
      this._endTaxiRide(client.sessionId, 'DRIVER_LEFT', false);
    }
    for (const [driverId, ride] of this.taxiRides) {
      if (ride.passengerId === client.sessionId) {
        this._endTaxiRide(driverId, 'PASSENGER_LEFT', false);
        break;
      }
    }
    this.taxiInvites.delete(client.sessionId);
    for (const [targetId, inv] of this.taxiInvites) {
      if (inv.driverId === client.sessionId) this.taxiInvites.delete(targetId);
    }
    this.taxiMode.delete(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    const veh = this.vehicles.get(client.sessionId);
    if (player && veh && player.vehicleId && veh[player.vehicleId]) {
      veh[player.vehicleId].x = player.x; veh[player.vehicleId].y = player.y;
      veh[player.vehicleId].fuel = player.fuel;
      veh[player.vehicleId].durability = player.durability;
    }
    const data = this.clientData.get(client.sessionId);
    const heldKey = (data && data.userId) ? data.userId : client.sessionId;
    // A held order (if any) survives the disconnect so it can be resumed.
    const job = this.jobs.get(client.sessionId);
    if (job && job.order) {
      this.heldOrders.set(heldKey, { order: job.order, leftAt: Date.now() });
    }
    await this._persistNow(client.sessionId);
    if (this._persistTimers && this._persistTimers.has(client.sessionId)) {
      clearTimeout(this._persistTimers.get(client.sessionId));
      this._persistTimers.delete(client.sessionId);
    }
    this.state.players.delete(client.sessionId);
    this.clientData.delete(client.sessionId);
    this.economy.delete(client.sessionId);
    this.survival.delete(client.sessionId);
    this.jobs.delete(client.sessionId);
    this.vehicles.delete(client.sessionId);
    this.motel.delete(client.sessionId);
    stats.humanPlayers = Math.max(0, stats.humanPlayers - 1);
    console.log(`[city] leave ${client.sessionId} players=${stats.humanPlayers}`);
  }

  _schedulePersist(sessionId) {
    const data = this.clientData.get(sessionId);
    if (!data || !data.userId || !sb.isConfigured()) return;
    if (this._persistTimers.has(sessionId)) return;
    const t = setTimeout(() => {
      this._persistTimers.delete(sessionId);
      this._persistNow(sessionId).catch(() => {});
    }, 300);
    this._persistTimers.set(sessionId, t);
  }

  async _persistNow(sessionId) {
    const data = this.clientData.get(sessionId);
    const player = this.state ? this.state.players.get(sessionId) : null;
    if (!data || !data.userId || !player || !sb.isConfigured()) return;
    const econ = this.economy.get(sessionId);
    const veh = this.vehicles.get(sessionId);
    const room = this.motel.get(sessionId);
    try {
      await sb.savePlayerSnapshot(data.userId, {
        profile: {
          display_name: player.name,
          avatar_key: player.avatar,
          cash: player.cash,
          bank: player.bank,
          job: player.job,
          hp: player.hp,
          hunger: player.hunger,
          stamina: player.stamina,
          x: player.x,
          y: player.y,
        },
        inventory: econ ? econ.inventory : null,
        vehicles: veh || null,
        motel: room || null,
      });
    } catch (err) {
      console.warn('[city] persistNow failed:', err && err.message ? err.message : err);
    }
  }

  // Send a message to one session (or nothing if they already left).
  _sendTo(sessionId, type, msg) {
    for (const c of this.clients) {
      if (c.sessionId === sessionId) { try { c.send(type, msg); } catch (e) { /* ignore */ } return; }
    }
  }

  // ---------------------------------------------------------------- economy (M2, §4/§5.7)
  // In-memory stubs with the SAME rules as the Supabase RPCs: server-side
  // price table, balance check, amount limits, idempotency (request_id),
  // 5/min rate-limit (SRS §12.3), in-memory tx log. A Supabase-connected
  // deployment replaces these with rpc_* calls — the client protocol
  // (request/response shape) is identical.
  _econCheck(client, msg, type) {
    const data = this.clientData.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!data || !player || data.isBot) return null;
    const now = Date.now();
    const econ = this.economy.get(client.sessionId);
    if (!econ) return null;
    const requestId = msg && typeof msg.request_id === 'string' ? msg.request_id : null;
    // Idempotency FIRST: a retried request is free (no state change) and
    // must answer ALREADY_PROCESSED even if the client is rate-limited —
    // otherwise a legit retry is misreported as RATE_LIMITED.
    if (requestId && econ.processed.has(requestId)) {
      client.send('econ_result', { type: type || 'econ', ok: false, error: 'ALREADY_PROCESSED' });
      return null;
    }
    // Rate-limit: 5 economy messages / minute (SRS §12.3).
    data.econTimes = (data.econTimes || []).filter((t) => now - t < 60000);
    if (data.econTimes.length >= ECON_RATE_LIMIT) {
      client.send('econ_result', { type: 'rate_limited', ok: false, error: 'RATE_LIMITED' });
      return null;
    }
    data.econTimes.push(now);
    if (requestId) econ.processed.add(requestId);
    return { player, econ, requestId };
  }
  _econLog(econ, type, amount, meta) {
    econ.txLog.unshift({ type, amount, at: Date.now(), meta: meta || {} });
    if (econ.txLog.length > 50) econ.txLog.length = 50;
    if (econ.userId && sb.isConfigured()) {
      const p = this.state && econ.sessionId ? this.state.players.get(econ.sessionId) : null;
      const bal = p ? p.cash : 0;
      const key = (meta && (meta.request_id || meta.idempotency_key)) || null;
      sb.logTransaction(econ.userId, type, amount, bal, key, meta);
      if (econ.sessionId) this._schedulePersist(econ.sessionId);
    }
  }
  _econInventoryObj(econ) {
    const out = {};
    if (econ && econ.inventory) {
      for (const [k, v] of econ.inventory) out[k] = v;
    }
    return out;
  }
  _isDay() {
    const h = Math.floor((this.state.worldTime || 480) / 60) % 24;
    return h >= 6 && h < 18;
  }
  _onEconSync(client) {
    const player = this.state.players.get(client.sessionId);
    const econ = this.economy.get(client.sessionId);
    const data = this.clientData.get(client.sessionId);
    if (!player || !econ) return;
    if (econ.atmDay.date !== todayStr()) econ.atmDay = { date: todayStr(), total: 0 };
    client.send('econ_result', {
      type: 'sync', ok: true, cash: player.cash, bank: player.bank,
      inventory: this._econInventoryObj(econ), dayUsed: econ.atmDay.total,
      authenticated: !!(data && data.userId),
    });
  }
  _onStarterGrant(client, msg) {
    const ctx = this._econCheck(client, msg, 'starter_grant');
    if (!ctx) return;
    const { player, econ } = ctx;
    if (econ.granted) {
      client.send('econ_result', { type: 'starter_grant', ok: false, error: 'ALREADY_GRANTED' });
      return;
    }
    econ.granted = true;
    player.cash += STARTER_GRANT;
    this._econLog(econ, 'starter_grant', STARTER_GRANT, { once: true });
    client.send('econ_result', {
      type: 'starter_grant', ok: true, cash: player.cash, bank: player.bank,
      inventory: this._econInventoryObj(econ),
    });
  }
  _onShopBuy(client, msg) {
    const ctx = this._econCheck(client, msg, 'shop_buy');
    if (!ctx) return;
    const { player, econ, requestId } = ctx;
    const item = SHOP_ITEMS[msg && msg.item_id];
    if (!item) {
      client.send('econ_result', { type: 'shop_buy', ok: false, error: 'ITEM_NOT_FOUND' });
      return;
    }
    const qty = Math.max(1, Math.min(99, (msg.qty | 0) || 1));
    if (dist(player.x, player.y, SHOP_POS.x, SHOP_POS.y) > ECON_RANGE) {
      client.send('econ_result', { type: 'shop_buy', ok: false, error: 'TOO_FAR' });
      return;
    }
    const unit = (this._isDay() && item.dayPrice) ? item.dayPrice : item.price;
    const total = unit * qty;
    if (player.cash < total) {
      client.send('econ_result', { type: 'shop_buy', ok: false, error: 'INSUFFICIENT_FUNDS', need: total, cash: player.cash });
      return;
    }
    player.cash -= total;
    econ.inventory.set(msg.item_id, (econ.inventory.get(msg.item_id) || 0) + qty);
    this._econLog(econ, 'shop_buy', -total, { item_id: msg.item_id, qty, unit_price: unit, request_id: requestId });
    client.send('econ_result', {
      type: 'shop_buy', ok: true, cash: player.cash, bank: player.bank,
      item_id: msg.item_id, qty: econ.inventory.get(msg.item_id), total,
      inventory: this._econInventoryObj(econ),
    });
  }
  _onAtmTransfer(client, msg) {
    const ctx = this._econCheck(client, msg, 'atm_transfer');
    if (!ctx) return;
    const { player, econ, requestId } = ctx;
    const amount = Math.floor(msg && msg.amount);
    if (!isFinite(amount) || amount < ATM_MIN || amount > ATM_MAX) {
      client.send('econ_result', { type: 'atm_transfer', ok: false, error: 'AMOUNT_RANGE', min: ATM_MIN, max: ATM_MAX });
      return;
    }
    if (dist(player.x, player.y, BANK_POS.x, BANK_POS.y) > ECON_RANGE) {
      client.send('econ_result', { type: 'atm_transfer', ok: false, error: 'TOO_FAR' });
      return;
    }
    if (econ.atmDay.date !== todayStr()) econ.atmDay = { date: todayStr(), total: 0 };
    if (econ.atmDay.total + amount > ATM_DAY_MAX) {
      client.send('econ_result', { type: 'atm_transfer', ok: false, error: 'DAILY_LIMIT', dayMax: ATM_DAY_MAX, used: econ.atmDay.total });
      return;
    }
    const action = msg.action;
    if (action === 'deposit') {
      if (player.cash < amount) {
        client.send('econ_result', { type: 'atm_transfer', ok: false, error: 'INSUFFICIENT_FUNDS' });
        return;
      }
      player.cash -= amount; player.bank += amount;
    } else if (action === 'withdraw') {
      if (player.bank < amount) {
        client.send('econ_result', { type: 'atm_transfer', ok: false, error: 'INSUFFICIENT_FUNDS' });
        return;
      }
      player.bank -= amount; player.cash += amount;
    } else {
      client.send('econ_result', { type: 'atm_transfer', ok: false, error: 'BAD_ACTION' });
      return;
    }
    econ.atmDay.total += amount;
    this._econLog(econ, 'atm', action === 'deposit' ? -amount : amount, { action, request_id: requestId });
    client.send('econ_result', {
      type: 'atm_transfer', ok: true, action, amount,
      cash: player.cash, bank: player.bank, dayUsed: econ.atmDay.total,
    });
  }
  _onUseItem(client, msg) {
    const ctx = this._econCheck(client, msg, 'use_item');
    if (!ctx) return;
    const { player, econ } = ctx;
    const item = SHOP_ITEMS[msg && msg.item_id];
    if (!item) {
      client.send('econ_result', { type: 'use_item', ok: false, error: 'ITEM_NOT_FOUND' });
      return;
    }
    const have = econ.inventory.get(msg.item_id) || 0;
    if (have < 1) {
      client.send('econ_result', { type: 'use_item', ok: false, error: 'NO_ITEM' });
      return;
    }
    econ.inventory.set(msg.item_id, have - 1);
    if (item.hunger) player.hunger = Math.min(100, player.hunger + item.hunger);
    if (item.stamina) player.stamina = Math.min(100, player.stamina + item.stamina);
    this._econLog(econ, 'use_item', 0, { item_id: msg.item_id });
    client.send('econ_result', {
      type: 'use_item', ok: true, item_id: msg.item_id, hunger: player.hunger, stamina: player.stamina,
      left: econ.inventory.get(msg.item_id), cash: player.cash, bank: player.bank,
      inventory: this._econInventoryObj(econ),
    });
  }

  // ---------------------------------------------------------------- movement (§7.4, 6 steps)
  _onMove(client, msg) {
    const data = this.clientData.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!data || !player) return;
    const now = Date.now();

    // 1. Validate input format.
    if (!msg || typeof msg !== 'object') return;
    const dx = msg.dx, dy = msg.dy, sprint = msg.sprint, seq = msg.seq;
    if (typeof dx !== 'number' || typeof dy !== 'number' || !isFinite(dx) || !isFinite(dy)
      || dx < -1 || dx > 1 || dy < -1 || dy > 1 || typeof sprint !== 'boolean'
      || typeof seq !== 'number' || !Number.isInteger(seq)) {
      console.log(`[city] bad move from ${client.sessionId}: ${JSON.stringify(msg)}`);
      return;
    }
    const len = Math.hypot(dx, dy);
    if (len > 1 + 1e-6) { this._violation(client, 'move-vector'); return; }
    if (seq <= data.lastSeq) return; // stale / duplicate
    data.lastSeq = seq;
    if (player.isFainted) return; // fainted players cannot move

    // Rate-limit: 30 move/s.
    data.moveTimes = data.moveTimes.filter((t) => now - t < 1000);
    if (data.moveTimes.length >= 30) {
      console.log(`[city] move rate-limit ${client.sessionId}`);
      return;
    }
    data.moveTimes.push(now);

    // 2. Speed check: displacement the server itself integrates can never
    // exceed maxSpeed * dt; if the client was idle (no move for >250 ms),
    // treat the first step as one 50 ms frame instead of jumping 0.5 s.
    const rawDt = (now - data.lastMoveAt) / 1000;
    const dt = rawDt > 0.25 ? 0.05 : clamp(rawDt, 0, 0.25);
    data.lastMoveAt = now;

    // 3. Stamina: sprint blocked below 10 (fall back to walk). Sprint is
    // on foot only — a ridden vehicle never sprints (§7.2 speeds).
    let sprinting = sprint && len > 0;
    if (sprinting && player.stamina < 10) sprinting = false;
    if (player.vehicleId) sprinting = false;
    data.sprinting = sprinting; // M3: the 1 s tick regens stamina while idle
    // M4 (§7.2, §8.1): speed comes from the ridden vehicle — bicycle 234,
    // motorbike 324, pushed (0 fuel / 0 durability) 180 — then the Hunger
    // 20–1 x0.7 factor (§3.2.2) applies to every speed.
    let speed = sprinting ? SPRINT_SPEED
      : M3.vehicleSpeed(player.vehicleId, player.fuel, player.durability);
    speed = M3.speedWithHunger(speed, player.hunger);
    if (sprinting) player.stamina = clamp(player.stamina - 5 * dt, 0, 100);
    else player.stamina = clamp(player.stamina + 3 * dt, 0, 100);

    const displacement = speed * dt * len;
    if (displacement > speed * dt * 1.1 + 1) { this._violation(client, 'speed-hack'); return; }

    // 4. Collision vs buildings + fences + fountain (slide along walls) + 5. update position.
    const r = 16; // 32x32 hitbox, SRS §7.3
    let nx = player.x + dx * speed * dt;
    let ny = player.y + dy * speed * dt;
    if (blocked(nx, ny, r)) {
      if (!blocked(nx, player.y, r)) ny = player.y; // slide on X
      else if (!blocked(player.x, ny, r)) nx = player.x; // slide on Y
      else { nx = player.x; ny = player.y; }
    }
    nx = clamp(nx, 20, 4780); ny = clamp(ny, 20, 4780);
    const movedPx = Math.hypot(nx - player.x, ny - player.y);
    player.x = nx; player.y = ny;
    player.vx = dx * speed; player.vy = dy * speed;
    player.anim = len === 0 ? 'idle' : (sprinting ? 'sprint' : 'walk');
    // M4 (§8.1): drain fuel / durability by distance actually travelled.
    // Motorbike: 100% fuel = 8000 px. Bicycle: 100% durability = 50.000 px.
    // Hitting 0 drops the rider to push speed (180) on the next move.
    if (movedPx > 0 && player.vehicleId) {
      if (player.vehicleId === 'motorbike' && player.fuel > 0) {
        player.fuel = Math.round(M3.fuelAfterDistance(player.fuel, movedPx) * 10) / 10;
        if (player.fuel <= 0) {
          player.fuel = 0;
          this._sendTo(client.sessionId, 'vehicle_result', {
            type: 'vehicle', ok: true, action: 'out_of_fuel',
            message: 'Hết xăng — tốc độ về 180 px/s (đẩy xe). Đổ xăng 5.000đ/bình ở Cửa Hàng.',
          });
        }
      } else if (player.vehicleId === 'bicycle' && player.durability > 0) {
        player.durability = Math.round(M3.durabilityAfterDistance(player.durability, movedPx) * 10) / 10;
        if (player.durability <= 0) {
          player.durability = 0;
          this._sendTo(client.sessionId, 'vehicle_result', {
            type: 'vehicle', ok: true, action: 'worn_out',
            message: 'Xe đạp hỏng (độ bền 0%) — tốc độ về 180 px/s. Sửa 10.000đ ở Cửa Hàng.',
          });
        }
      }
      // M4 taxi: the ride fare is charged on distance actually travelled.
      const ride = this.taxiRides.get(client.sessionId);
      if (ride) ride.distancePx += movedPx;
    }
  }

  _violation(client, kind) {
    const data = this.clientData.get(client.sessionId);
    if (!data) return;
    const now = Date.now();
    data.violations = data.violations.filter((t) => now - t < 60000);
    data.violations.push(now);
    console.log(`[city] violation ${kind} from ${client.sessionId} (${data.violations.length}/5 per min)`);
    if (data.violations.length >= 5) {
      console.log(`[city] kicking ${client.sessionId} for repeated violations`);
      try { client.leave(); } catch (e) { console.log('[city] kick failed:', e.message); }
    }
  }

  // ---------------------------------------------------------------- chat (§10)
  _onChat(client, msg) {
    const data = this.clientData.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!data || !player) return;
    const now = Date.now();

    if (!msg || typeof msg !== 'object' || typeof msg.text !== 'string') return;
    const text = msg.text.trim();
    const channel = msg.channel;
    if (!['world', 'nearby', 'private'].includes(channel)) return;
    if (text.length === 0 || text.length > 200) {
      console.log(`[city] chat rejected (length ${text.length}) from ${client.sessionId}`);
      return;
    }
    // Spam: max 5 msgs / 10 s (6th dropped + logged, SRS §10.1).
    data.chatTimes = data.chatTimes.filter((t) => now - t < 10000);
    if (data.chatTimes.length >= 5) {
      console.log(`[city] chat spam dropped from ${player.name}: "${text.slice(0, 60)}"`);
      return;
    }
    data.chatTimes.push(now);
    // Absolute filter (no toggle): links + phone numbers (SRS §10.3).
    if (/https?:\/\/|www\.|(\d[\s\-]?){9,}/i.test(text)) {
      console.log(`[city] chat blocked (link/phone) from ${player.name}: "${text.slice(0, 60)}"`);
      return;
    }

    // Chat bubble on the sender for every channel (4 s).
    player.chatBubble = text.slice(0, 120);
    player.chatBubbleUntil = now + CHAT_BUBBLE_MS;

    const out = {
      fromId: client.sessionId, fromName: player.name,
      channel, text, targetId: msg.targetId || null, at: now,
    };
    if (channel === 'world') {
      this.broadcast('chat', out);
      this._maybeBotReply(null, text, player.name, player.x, player.y);
    } else if (channel === 'nearby') {
      for (const c of this.clients) {
        const p = this.state.players.get(c.sessionId);
        if (p && dist(p.x, p.y, player.x, player.y) <= NEARBY_RADIUS) c.send('chat', out);
      }
      this._maybeBotReply(NEARBY_RADIUS, text, player.name, player.x, player.y);
    } else { // private
      const target = msg.targetId ? this.state.players.get(msg.targetId) : null;
      if (!target) { client.send('chat_error', { error: 'TARGET_NOT_FOUND' }); return; }
      client.send('chat', out);
      if (this.bots.has(msg.targetId)) {
        // Private chat with a bot: the bot answers directly.
        this._scheduleBotReply(msg.targetId, text, player.name);
      } else {
        for (const c of this.clients) {
          if (c.sessionId === msg.targetId) c.send('chat', out);
        }
      }
    }
  }

  _maybeBotReply(maxDist, text, playerName, px, py) {
    // Prefer a bot explicitly called by name; else one random bot in range.
    const called = this._findCalledBot(text);
    const candidates = [];
    for (const [botId, bot] of this.bots) {
      const p = this.state.players.get(botId);
      if (!p) continue;
      if (maxDist !== null && dist(p.x, p.y, px, py) > maxDist) continue;
      candidates.push(botId);
    }
    if (!candidates.length) return;
    let chosen = called && candidates.includes(called) ? called
      : candidates[Math.floor(Math.random() * candidates.length)];
    // World chat: at most one bot answers per message (avoid a chorus).
    this._scheduleBotReply(chosen, text, playerName);
  }

  _findCalledBot(text) {
    const norm = BotBrain.stripDiacritics(text);
    for (const persona of BotBrain.PERSONAS) {
      for (const call of persona.callNames) {
        if (norm.includes(call)) return 'bot-' + persona.id;
      }
    }
    return null;
  }

  _scheduleBotReply(botId, text, playerName) {
    const bot = this.bots.get(botId);
    const botPlayer = this.state.players.get(botId);
    if (!bot || !botPlayer) return;
    const delay = randRange(1000, 3000); // human-like 1-3 s delay, SRS §10.3
    const timer = setTimeout(() => {
      this.pendingBotReplies.delete(timer);
      if (!this.state || !this.state.players.has(botId)) return;
      const reply = BotBrain.respond(bot.personaId, text, playerName, bot.brain);
      if (!reply) return; // bot stays silent sometimes
      const now = Date.now();
      botPlayer.chatBubble = reply.slice(0, 120);
      botPlayer.chatBubbleUntil = now + CHAT_BUBBLE_MS;
      this.broadcast('chat', {
        fromId: botId, fromName: botPlayer.name,
        channel: 'world', text: reply, targetId: null, at: now,
      });
    }, delay);
    this.pendingBotReplies.add(timer);
  }

  _speakProactively(botId) {
    const bot = this.bots.get(botId);
    const botPlayer = this.state.players.get(botId);
    if (!bot || !botPlayer) return;
    const persona = BotBrain.PERSONAS.find((p) => p.id === bot.personaId);
    const line = persona.lines.filter((l) => l !== bot.brain.lastLine);
    const chosen = line[Math.floor(Math.random() * line.length)];
    bot.brain.lastLine = chosen;
    bot.brain.lastSpokeAt = Date.now();
    botPlayer.chatBubble = chosen.slice(0, 120);
    botPlayer.chatBubbleUntil = Date.now() + CHAT_BUBBLE_MS;
    this.broadcast('chat', {
      fromId: botId, fromName: botPlayer.name,
      channel: 'nearby', text: chosen, targetId: null, at: Date.now(),
    });
  }

  // ---------------------------------------------------------------- interact (M1 revive + M3 doctor/hospital/talk)
  _onInteract(client, msg) {
    const player = this.state.players.get(client.sessionId);
    if (!msg || typeof msg !== 'object' || !player) return;
    if (msg.action === 'revive') {
      const target = msg.targetId ? this.state.players.get(msg.targetId) : null;
      if (!target || !target.isFainted) {
        client.send('interact_error', { error: 'INVALID_TARGET' });
        return;
      }
      if (dist(player.x, player.y, target.x, target.y) > M3.REVIVE_RANGE) {
        client.send('interact_error', { error: 'TOO_FAR' });
        return;
      }
      // M4 (§18.5, PROPOSAL impl.): the client may attach the rhythm-tap
      // mini-game accuracy (0–100). >= 90% -> +20 HP on top of the locked
      // 30 HP floor. The bonus is bounded server-side (never above +20),
      // and the reward / cooldown / pair cap are unchanged.
      const bonusHp = M3.doctorMinigameBonus(
        (msg && typeof msg.minigamePct === 'number') ? msg.minigamePct : 0);
      target.hp = M3.REVIVE_BASE_HP + bonusHp; target.stamina = 50; target.isFainted = false; target.anim = 'idle';
      const sv = this.survival.get(msg.targetId);
      if (sv) { sv.faintedUntil = 0; sv.faintedAt = 0; }
      // M3 (§3.4.3): only a doctor gets the 25.000đ SYSTEM reward, with
      // anti-farm caps. Anyone can revive, but a non-doctor earns 0đ.
      const reward = this._doctorReviveReward(client.sessionId, msg.targetId);
      console.log(`[city] ${player.name} revived ${target.name} (reward ${reward.reward}đ, ${reward.reason}, bonusHp +${bonusHp})`);
      this.broadcast('revived', {
        byId: client.sessionId, byName: player.name, targetId: msg.targetId,
        reward: reward.reward, reason: reward.reason, job: player.job,
        bonusHp: bonusHp, hp: target.hp,
      });
    } else if (msg.action === 'hospital') {
      // M3 (§3.2.4): "Về Bệnh viện" — only for the fainted sender, only
      // after 10 s of fainting. Same hospital revive as the 60 s auto-revive.
      if (!player.isFainted) {
        client.send('interact_error', { error: 'INVALID_TARGET' });
        return;
      }
      const sv = this.survival.get(client.sessionId);
      if (!sv || Date.now() - (sv.faintedAt || 0) < M3.HOSPITAL_BUTTON_DELAY_S * 1000) {
        client.send('interact_error', { error: 'TOO_EARLY' });
        return;
      }
      this._hospitalRevive(player, sv);
      client.send('job_result', { type: 'hospital', ok: true, cash: player.cash, bank: player.bank });
    } else if (msg.action === 'talk') {
      // M3 (§10.2): talk to an NPC within 120 px. Guide -> tutorial quest;
      // walker -> one random line from its persona (BotBrain).
      const npc = msg.targetId ? this.state.npcs.get(msg.targetId) : null;
      if (!npc) {
        client.send('interact_error', { error: 'INVALID_TARGET' });
        return;
      }
      if (dist(player.x, player.y, npc.x, npc.y) > M3.TALK_RANGE) {
        client.send('interact_error', { error: 'TOO_FAR' });
        return;
      }
      if (npc.type === 'guide') {
        client.send('npc_talk', {
          npcId: npc.id, name: npc.name, isGuide: true, x: npc.x, y: npc.y,
          text: 'Chào Công Dân mới! Nhiệm vụ tân thủ của bạn:',
          quest: [
            '1. Nói chuyện với NPC Hướng Dẫn — nhận 80.000đ vốn khởi nghiệp',
            '2. Mua 1 Bánh mì ở Cửa Hàng Tiện Lợi và ăn (+40 Độ no)',
            '3. Làm Shipper: nhận 1 đơn ở Kho Hàng và giao thành công',
            '4. Gửi 20.000đ vào Bank tại ATM',
            '5. Hoàn thành cả 4 bước — thưởng 30.000đ + danh hiệu "Công dân chính thức"',
          ],
        });
        return;
      }
      const w = this.walkers.get(npc.id);
      const personaId = (w && w.personaId) || 'mai';
      const persona = BotBrain.PERSONAS.find((pp) => pp.id === personaId) || BotBrain.PERSONAS[0];
      const pool = persona.lines.filter((l) => !w || l !== w.lastTalkLine);
      const line = pool.length ? pool[Math.floor(Math.random() * pool.length)] : persona.lines[0];
      if (w) w.lastTalkLine = line;
      client.send('npc_talk', {
        npcId: npc.id, name: npc.name, isGuide: false, x: npc.x, y: npc.y,
        personaId: persona.id, text: line,
      });
    } else {
      client.send('interact_error', { error: 'NOT_IMPLEMENTED_M1', action: msg.action || null });
    }
  }

  // M3 (§3.4.3): doctor revive reward + anti-farm. Returns {reward, reason}.
  // The revive itself always succeeds; only the REWARD is capped.
  _doctorReviveReward(doctorId, victimId) {
    const now = Date.now();
    const doctor = this.state.players.get(doctorId);
    const jobEntry = this.jobs.get(doctorId);
    const econ = this.economy.get(doctorId);
    if (!doctor || !jobEntry || !econ) return { reward: 0, reason: 'NO_STATE' };
    const d = jobEntry.doctor;
    const oneHourAgo = now - 3600 * 1000;
    const revivesLastHour = d.revives.filter(
      (r) => r.victimId === victimId && r.rewarded && r.at > oneHourAgo).length;
    const check = M3.doctorRewardCheck(doctor.job, now, d.lastRewardedAt, revivesLastHour);
    // Count this pair's revives today for the collusion flag (§3.4.3).
    const today = todayStr();
    const pairToday = d.revives.filter(
      (r) => r.victimId === victimId && new Date(r.at).toISOString().slice(0, 10) === today).length + 1;
    const flagged = M3.collusionFlagged(pairToday);
    d.revives.push({ victimId, at: now, rewarded: check.reward > 0 });
    if (d.revives.length > 200) d.revives.splice(0, d.revives.length - 200);
    if (check.reward > 0) {
      d.lastRewardedAt = now;
      doctor.cash += check.reward;
      this._econLog(econ, 'job_reward', check.reward, {
        job: 'revive', doctor_id: doctorId, victim_id: victimId,
        flag: flagged ? 'suspected_collusion' : undefined,
      });
    } else if (flagged) {
      // Even a 0đ revive is logged when the pair looks collusive.
      this._econLog(econ, 'job_reward', 0, {
        job: 'revive', doctor_id: doctorId, victim_id: victimId,
        flag: 'suspected_collusion',
      });
    }
    return { reward: check.reward, reason: check.reason, flagged };
  }

  // M3 (§3.2.4/§3.2.5): hospital revive — 50 HP, 50 stamina, teleport to
  // the hospital, fee = 10.000 + 50% of Cash remaining after the faint loss.
  // Cash first, then Bank; never negative, never debt. Fee is a sink.
  _hospitalRevive(player, sv) {
    const fee = M3.hospitalFee(player.cash);
    const after = M3.deductFee(player.cash, player.bank, fee);
    player.cash = after.cash; player.bank = after.bank;
    const econ = this.economy.get(player.id);
    if (econ) this._econLog(econ, 'hospital_fee', -after.paid, { fee, cash_after: after.cash });
    player.x = HOSPITAL_SPAWN.x; player.y = HOSPITAL_SPAWN.y;
    player.hp = 50; player.stamina = 50; player.isFainted = false; player.anim = 'idle';
    if (sv) { sv.faintedUntil = 0; sv.faintedAt = 0; }
    console.log(`[city] ${player.name} hospital revive (fee ${after.paid}đ, cash now ${player.cash}, bank ${player.bank})`);
  }

  // ---------------------------------------------------------------- M4 vehicles (§8.1)
  // Deduct an amount from Cash first, then Bank (same rule as the hospital
  // fee, §3.2.5). Returns {ok, paid} — ok is false when cash+bank < amount
  // (nothing is deducted then: check first, deduct second).
  _deductCashBank(player, amount) {
    if (player.cash + player.bank < amount) return { ok: false, paid: 0 };
    const after = M3.deductFee(player.cash, player.bank, amount);
    player.cash = after.cash; player.bank = after.bank;
    return { ok: true, paid: after.paid };
  }
  // Mirror the owned vehicles into the Colyseus state fields the client
  // renders (vehicleType / fuel / durability / vehicleId).
  _syncVehicle(player) {
    const veh = this.vehicles.get(player.id);
    if (!veh) return;
    if (player.vehicleId && veh[player.vehicleId]) {
      const v = veh[player.vehicleId];
      player.vehicleType = player.vehicleId;
      player.fuel = v.fuel; player.durability = v.durability;
    } else {
      player.vehicleId = ''; player.vehicleType = '';
      player.fuel = 100; player.durability = 100;
    }
  }

  _onVehicle(client, msg) {
    const player = this.state.players.get(client.sessionId);
    const veh = this.vehicles.get(client.sessionId);
    const econ = this.economy.get(client.sessionId);
    if (!player || !veh || !econ || !msg || typeof msg !== 'object') return;
    const action = msg.action;
    const send = (m) => client.send('vehicle_result', Object.assign({ type: 'vehicle' }, m));
    const type = msg.vehicleId === 'bicycle' || msg.vehicleId === 'motorbike' ? msg.vehicleId : null;

    if (action === 'buy') {
      if (!type) { send({ ok: false, error: 'BAD_VEHICLE' }); return; }
      if (veh[type]) { send({ ok: false, error: 'ALREADY_OWNED', vehicleId: type }); return; }
      if (dist(player.x, player.y, SHOWROOM_POS.x, SHOWROOM_POS.y) > ECON_RANGE) {
        send({ ok: false, error: 'TOO_FAR' }); return;
      }
      const price = M3.vehiclePrice(type);
      const paid = this._deductCashBank(player, price);
      if (!paid.ok) { send({ ok: false, error: 'INSUFFICIENT_FUNDS', need: price }); return; }
      // Parked on the open lot SOUTH of the Showroom — the showroom
      // building itself (x1425-1905, y2670-3030) is blocked, so parking at
      // SHOWROOM_POS would strand the vehicle where nobody can mount it.
      veh[type] = { fuel: 100, durability: 100, x: SHOWROOM_POS.x, y: SHOWROOM_POS.y + 270 };
      this._econLog(econ, 'asset_buy', -price, { asset_type: 'vehicle', asset_code: type });
      send({ ok: true, action: 'buy', vehicleId: type, cash: player.cash, bank: player.bank, price });
      console.log(`[city] ${player.name} bought ${type} for ${price}đ`);
      return;
    }

    if (action === 'mount') {
      if (!type || !veh[type]) { send({ ok: false, error: 'NO_VEHICLE', vehicleId: type }); return; }
      if (player.isFainted) { send({ ok: false, error: 'FAINTED' }); return; }
      if (player.vehicleId) { send({ ok: false, error: 'ALREADY_RIDING', vehicleId: player.vehicleId }); return; }
      const v = veh[type];
      if (dist(player.x, player.y, v.x, v.y) > M3.MOUNT_RANGE) {
        send({ ok: false, error: 'TOO_FAR', x: v.x, y: v.y }); return;
      }
      player.vehicleId = type;
      this._syncVehicle(player);
      this._schedulePersist(client.sessionId);
      send({ ok: true, action: 'mount', vehicleId: type, fuel: player.fuel, durability: player.durability });
      return;
    }

    if (action === 'dismount') {
      if (!player.vehicleId) { send({ ok: false, error: 'NOT_RIDING' }); return; }
      const cur = player.vehicleId;
      const v = veh[cur];
      if (v) { v.x = player.x; v.y = player.y; v.fuel = player.fuel; v.durability = player.durability; }
      // A passenger rides along: dropping the driver off ends the ride
      // with the fare for the distance travelled so far.
      if (this.taxiRides.has(client.sessionId)) this._completeTaxiRide(client.sessionId, 'DROPOFF');
      player.vehicleId = '';
      this._syncVehicle(player);
      this._schedulePersist(client.sessionId);
      send({ ok: true, action: 'dismount', vehicleId: cur, x: player.x, y: player.y });
      return;
    }

    if (action === 'refuel') {
      if (!veh.motorbike) { send({ ok: false, error: 'NO_VEHICLE', vehicleId: 'motorbike' }); return; }
      if (dist(player.x, player.y, SHOP_POS.x, SHOP_POS.y) > ECON_RANGE) {
        send({ ok: false, error: 'TOO_FAR' }); return;
      }
      const curFuel = player.vehicleId === 'motorbike' ? player.fuel : veh.motorbike.fuel;
      if (curFuel >= 100) {
        send({ ok: false, error: 'ALREADY_FULL' }); return;
      }
      const paid = this._deductCashBank(player, M3.FUEL_PRICE);
      if (!paid.ok) { send({ ok: false, error: 'INSUFFICIENT_FUNDS', need: M3.FUEL_PRICE }); return; }
      veh.motorbike.fuel = 100;
      if (player.vehicleId === 'motorbike') player.fuel = 100;
      this._econLog(econ, 'shop_buy', -M3.FUEL_PRICE, { item_id: 'fuel', qty: 1 });
      send({ ok: true, action: 'refuel', cash: player.cash, bank: player.bank, fuel: 100 });
      return;
    }

    if (action === 'repair') {
      // Bicycle durability repair — ĐỀ XUẤT price (§8.1): 10.000đ.
      if (!veh.bicycle) { send({ ok: false, error: 'NO_VEHICLE', vehicleId: 'bicycle' }); return; }
      if (dist(player.x, player.y, SHOP_POS.x, SHOP_POS.y) > ECON_RANGE) {
        send({ ok: false, error: 'TOO_FAR' }); return;
      }
      const curDur = player.vehicleId === 'bicycle' ? player.durability : veh.bicycle.durability;
      if (curDur >= 100) {
        send({ ok: false, error: 'ALREADY_FULL' }); return;
      }
      const paid = this._deductCashBank(player, M3.BIKE_REPAIR_PRICE);
      if (!paid.ok) { send({ ok: false, error: 'INSUFFICIENT_FUNDS', need: M3.BIKE_REPAIR_PRICE }); return; }
      veh.bicycle.durability = 100;
      if (player.vehicleId === 'bicycle') player.durability = 100;
      this._econLog(econ, 'shop_buy', -M3.BIKE_REPAIR_PRICE, { item_id: 'bike_repair', qty: 1 });
      send({ ok: true, action: 'repair', cash: player.cash, bank: player.bank, durability: 100 });
      return;
    }

    if (action === 'status') {
      send({
        ok: true, action: 'status',
        vehicles: {
          bicycle: veh.bicycle ? { owned: true, fuel: veh.bicycle.fuel, durability: veh.bicycle.durability, x: veh.bicycle.x, y: veh.bicycle.y } : { owned: false },
          motorbike: veh.motorbike ? { owned: true, fuel: veh.motorbike.fuel, durability: veh.motorbike.durability, x: veh.motorbike.x, y: veh.motorbike.y } : { owned: false },
        },
        riding: player.vehicleId || '',
        cash: player.cash, bank: player.bank,
      });
      return;
    }

    send({ ok: false, error: 'BAD_ACTION', action: action || null });
  }

  // ---------------------------------------------------------------- M4 taxi (§3.4.2, §10.2)
  _spawnTaxiCustomer(now) {
    const id = 'npc-taxi-' + (++this.taxiCustomerSeq);
    // Stand on a SIDEWALK CORNER of a road intersection — the road centre
    // itself is not an open point (Colliders.isOpenPoint rejects roads),
    // so the customer waits at (intersection +/- 140 px), just off the
    // asphalt, where the driver can reach them.
    const corners = [[140, 140], [140, -140], [-140, 140], [-140, -140]];
    for (let i = 0; i < 10; i++) {
      const base = TAXI_INTERSECTIONS[Math.floor(Math.random() * TAXI_INTERSECTIONS.length)];
      const c = corners[i % corners.length];
      const x = base.x + c[0] + randRange(-30, 30), y = base.y + c[1] + randRange(-30, 30);
      if (!Colliders.isOpenPoint(x, y)) continue;
      const dest = M3.pickDeliveryPoint();
      const persona = M3.pickTaxiCitizenPersona ? M3.pickTaxiCitizenPersona() : { name: 'Khách vãng lai', avatar: 'student', lines: ['Bác tài chở tôi đi với!'] };
      const line = (persona.lines && persona.lines.length) ? persona.lines[Math.floor(Math.random() * persona.lines.length)] : 'Bác tài chở tôi đi với!';
      const npc = new NpcState();
      Object.assign(npc, {
        id, type: 'taxi_customer', name: persona.name || 'Khách vãng lai',
        x, y, targetX: x, targetY: y, avatar: persona.avatar || 'student',
      });
      this.state.npcs.set(id, npc);
      this.taxiCustomers.set(id, {
        destX: dest.x, destY: dest.y, poiName: dest.poiName,
        spawnedAt: now, personaName: persona.name, line: line,
      });
      return id;
    }
    return null;
  }

  // 1 s tick: spawn/despawn NPC customers + auto-complete NPC rides.
  _taxiTick(now) {
    let humans = 0;
    for (const [id] of this.state.players) if (!this.bots.has(id)) humans += 1;
    const want = Math.max(0, Math.min(4 - humans, M3.TAXI_CUSTOMER_MAX));
    // Despawn unpicked customers after 5 min (§10.2).
    for (const [npcId, c] of this.taxiCustomers) {
      if (now - c.spawnedAt > M3.TAXI_CUSTOMER_DESPAWN_S * 1000) {
        this.taxiCustomers.delete(npcId);
        this.state.npcs.delete(npcId);
      }
    }
    if (this.taxiMode.size > 0) {
      let guard = 0;
      while (this.taxiCustomers.size < want && guard++ < 4) {
        if (!this._spawnTaxiCustomer(now)) break;
      }
    }
    // NPC ride auto-complete: driver within 80 px of the destination.
    for (const [driverId, ride] of this.taxiRides) {
      if (ride.kind !== 'npc') continue;
      const driver = this.state.players.get(driverId);
      if (!driver) { this.taxiRides.delete(driverId); continue; }
      if (dist(driver.x, driver.y, ride.destX, ride.destY) <= M3.DROPOFF_RANGE) {
        this._completeTaxiRide(driverId, 'DROPOFF');
      }
    }
  }

  // End a ride WITHOUT paying (passenger/driver left mid-trip).
  _endTaxiRide(driverId, reason, paid) {
    const ride = this.taxiRides.get(driverId);
    if (!ride) return;
    this.taxiRides.delete(driverId);
    const driver = this.state.players.get(driverId);
    if (driver) driver.passengerId = '';
    if (ride.kind === 'player') {
      const pass = this.state.players.get(ride.passengerId);
      if (pass) pass.passengerId = '';
    }
    this._sendTo(driverId, 'taxi_result', { type: 'taxi', ok: false, error: reason, action: 'ride_ended' });
    if (ride.kind === 'player') {
      this._sendTo(ride.passengerId, 'taxi_result', { type: 'taxi', ok: false, error: reason, action: 'ride_ended' });
    }
  }

  // Finish a ride WITH fare: fare = 1.000đ/100 px travelled (clamped
  // 5.000–20.000đ), 5% tax paid by the passenger on top (LOCKED), driver
  // gets fare + night bonus (SYSTEM, max 6.000đ). An NPC passenger's fare
  // is paid by SYSTEM (the NPC has no wallet).
  _completeTaxiRide(driverId, how) {
    const ride = this.taxiRides.get(driverId);
    if (!ride) return null;
    this.taxiRides.delete(driverId);
    const driver = this.state.players.get(driverId);
    const econ = this.economy.get(driverId);
    if (!driver || !econ) return null;
    driver.passengerId = '';
    const fare = M3.taxiFare(ride.distancePx, M3.isNightWorld(this.state.worldTime));
    if (ride.kind === 'player') {
      const pass = this.state.players.get(ride.passengerId);
      const passEcon = this.economy.get(ride.passengerId);
      if (pass && passEcon) {
        pass.passengerId = '';
        // Passenger pays fare + 5% tax; not enough money -> the driver
        // gets only what was actually paid (fare part) + the SYSTEM night
        // bonus — never negative, never debt, never a SYSTEM subsidy of
        // the missing fare (same rule as the hospital fee).
        const charged = this._deductCashBank(pass, fare.passengerPays);
        const farePaid = Math.min(fare.fare, charged.paid);
        const taxPaid = Math.max(0, charged.paid - fare.fare);
        const driverGets = farePaid + fare.nightBonus;
        driver.cash += driverGets;
        this._econLog(passEcon, 'taxi_fare', -charged.paid, { driver_id: driverId, distance_px: Math.round(ride.distancePx) });
        if (taxPaid > 0) this._econLog(passEcon, 'tax', -taxPaid, { taxi: true });
        this._econLog(econ, 'taxi_fare', driverGets, { passenger_id: ride.passengerId, distance_px: Math.round(ride.distancePx) });
        this._sendTo(ride.passengerId, 'taxi_result', {
          type: 'taxi', ok: true, action: 'dropoff', fare: fare.fare, tax: fare.tax,
          paid: charged.paid, driverName: driver.name,
        });
        this._sendTo(driverId, 'taxi_result', {
          type: 'taxi', ok: true, action: 'dropoff', how: how || 'DROPOFF',
          fare: fare.fare, tax: fare.tax, nightBonus: fare.nightBonus,
          received: driverGets, distancePx: Math.round(ride.distancePx),
          cash: driver.cash, bank: driver.bank,
        });
        console.log(`[city] taxi ${driver.name} completed player ride ${Math.round(ride.distancePx)}px fare ${fare.fare}đ (paid ${charged.paid}đ, +${fare.nightBonus}đ night)`);
        return fare;
      }
    } else {
      // NPC passenger: SYSTEM pays the fare; driver still gets the fare +
      // night bonus (the city subsidises NPC rides so drivers earn even
      // when the room is empty).
      driver.cash += fare.driverReceives;
      this._econLog(econ, 'taxi_fare', fare.driverReceives, {
        passenger: 'npc', npc_id: ride.npcId, distance_px: Math.round(ride.distancePx),
      });
    }
    this._sendTo(driverId, 'taxi_result', {
      type: 'taxi', ok: true, action: 'dropoff', how: how || 'DROPOFF',
      fare: fare.fare, tax: fare.tax, nightBonus: fare.nightBonus,
      received: fare.driverReceives, distancePx: Math.round(ride.distancePx),
      cash: driver.cash, bank: driver.bank,
    });
    console.log(`[city] taxi ${driver.name} completed ride ${Math.round(ride.distancePx)}px fare ${fare.fare}đ (+${fare.nightBonus}đ night)`);
    return fare;
  }

  _onTaxi(client, msg) {
    const player = this.state.players.get(client.sessionId);
    const econ = this.economy.get(client.sessionId);
    if (!player || !econ || !msg || typeof msg !== 'object') return;
    const action = msg.action;
    const now = Date.now();
    const send = (m) => client.send('taxi_result', Object.assign({ type: 'taxi' }, m));

    if (action === 'toggle') {
      // "Nhận khách" mode: only for the taxi_driver job with a motorbike.
      // Bicycle cannot carry a passenger (§8.1).
      if (player.job !== 'taxi_driver') { send({ ok: false, error: 'NOT_TAXI_DRIVER' }); return; }
      const veh = this.vehicles.get(client.sessionId);
      if (!veh || !veh.motorbike) { send({ ok: false, error: 'NO_MOTORBIKE' }); return; }
      const on = !this.taxiMode.has(client.sessionId);
      if (on) this.taxiMode.add(client.sessionId);
      else this.taxiMode.delete(client.sessionId);
      send({ ok: true, action: 'toggle', taxiMode: on });
      return;
    }

    if (action === 'invite') {
      // Driver invites a real player to ride along.
      if (player.job !== 'taxi_driver') { send({ ok: false, error: 'NOT_TAXI_DRIVER' }); return; }
      if (player.vehicleId !== 'motorbike') { send({ ok: false, error: 'NOT_RIDING_MOTORBIKE' }); return; }
      if (this.taxiRides.has(client.sessionId)) { send({ ok: false, error: 'ALREADY_RIDING' }); return; }
      const target = msg.targetId ? this.state.players.get(msg.targetId) : null;
      if (!target || this.bots.has(msg.targetId)) { send({ ok: false, error: 'INVALID_TARGET' }); return; }
      if (target.isFainted) { send({ ok: false, error: 'TARGET_FAINTED' }); return; }
      if (target.vehicleId) { send({ ok: false, error: 'TARGET_RIDING' }); return; }
      if (dist(player.x, player.y, target.x, target.y) > M3.PICKUP_RANGE) {
        send({ ok: false, error: 'TOO_FAR' }); return;
      }
      this.taxiInvites.set(msg.targetId, { driverId: client.sessionId, at: now });
      this._sendTo(msg.targetId, 'taxi_result', {
        type: 'taxi', ok: true, action: 'invited',
        driverId: client.sessionId, driverName: player.name,
      });
      send({ ok: true, action: 'invite', targetId: msg.targetId });
      return;
    }

    if (action === 'accept') {
      const inv = this.taxiInvites.get(client.sessionId);
      if (!inv || inv.driverId !== msg.driverId) { send({ ok: false, error: 'NO_INVITE' }); return; }
      if (now - inv.at > 30000) {
        this.taxiInvites.delete(client.sessionId);
        send({ ok: false, error: 'INVITE_EXPIRED' }); return;
      }
      const driver = this.state.players.get(inv.driverId);
      if (!driver || driver.vehicleId !== 'motorbike' || this.taxiRides.has(inv.driverId)) {
        this.taxiInvites.delete(client.sessionId);
        send({ ok: false, error: 'DRIVER_GONE' }); return;
      }
      if (dist(player.x, player.y, driver.x, driver.y) > M3.PICKUP_RANGE) {
        send({ ok: false, error: 'TOO_FAR' }); return;
      }
      this.taxiInvites.delete(client.sessionId);
      driver.passengerId = client.sessionId;
      player.passengerId = inv.driverId;
      this.taxiRides.set(inv.driverId, {
        passengerId: client.sessionId, kind: 'player', npcId: null,
        destX: 0, destY: 0, poiName: null, distancePx: 0, startedAt: now,
      });
      this._sendTo(inv.driverId, 'taxi_result', { type: 'taxi', ok: true, action: 'pickup', passengerId: client.sessionId, passengerName: player.name });
      send({ ok: true, action: 'accept', driverId: inv.driverId, driverName: driver.name });
      return;
    }

    if (action === 'decline') {
      const inv = this.taxiInvites.get(client.sessionId);
      if (inv) {
        this.taxiInvites.delete(client.sessionId);
        this._sendTo(inv.driverId, 'taxi_result', { type: 'taxi', ok: false, error: 'DECLINED', action: 'invite' });
      }
      send({ ok: true, action: 'decline' });
      return;
    }

    if (action === 'pickup') {
      // Driver picks up an NPC wandering customer.
      if (player.job !== 'taxi_driver') { send({ ok: false, error: 'NOT_TAXI_DRIVER' }); return; }
      if (player.vehicleId !== 'motorbike') { send({ ok: false, error: 'NOT_RIDING_MOTORBIKE' }); return; }
      if (this.taxiRides.has(client.sessionId)) { send({ ok: false, error: 'ALREADY_RIDING' }); return; }
      const cust = msg.npcId ? this.taxiCustomers.get(msg.npcId) : null;
      const npc = msg.npcId ? this.state.npcs.get(msg.npcId) : null;
      if (!cust || !npc) { send({ ok: false, error: 'INVALID_TARGET' }); return; }
      if (dist(player.x, player.y, npc.x, npc.y) > M3.PICKUP_RANGE) {
        send({ ok: false, error: 'TOO_FAR' }); return;
      }
      this.taxiCustomers.delete(msg.npcId);
      this.state.npcs.delete(msg.npcId);
      player.passengerId = msg.npcId;
      this.taxiRides.set(client.sessionId, {
        passengerId: msg.npcId, kind: 'npc', npcId: msg.npcId,
        destX: cust.destX, destY: cust.destY, poiName: cust.poiName,
        distancePx: 0, startedAt: now,
        passengerName: cust.personaName || 'Khách vãng lai',
      });
      // Phát câu thoại của khách chào tài xế qua chat bubble / chat log
      const speech = cust.line || `Chở tôi tới ${cust.poiName || 'điểm đến'} nhé!`;
      this.broadcast('chat_message', {
        fromId: msg.npcId, fromName: cust.personaName || 'Khách vãng lai',
        channel: 'nearby', text: speech, targetId: client.sessionId, at: now,
      });
      send({
        ok: true, action: 'pickup', npcId: msg.npcId,
        destX: cust.destX, destY: cust.destY, poiName: cust.poiName,
        passengerName: cust.personaName || 'Khách vãng lai',
        speech: speech,
      });
      console.log(`[city] taxi ${player.name} picked up ${cust.personaName || 'NPC'} -> ${cust.poiName} (${cust.destX},${cust.destY})`);
      return;
    }

    if (action === 'dropoff') {
      if (!this.taxiRides.has(client.sessionId)) { send({ ok: false, error: 'NO_RIDE' }); return; }
      const fare = this._completeTaxiRide(client.sessionId, 'DROPOFF');
      if (!fare) send({ ok: false, error: 'NO_RIDE' });
      return;
    }

    if (action === 'leave') {
      // Passenger gets off: the ride ends with the fare for the distance
      // travelled so far (same as a driver dropoff).
      for (const [driverId, ride] of this.taxiRides) {
        if (ride.passengerId === client.sessionId) {
          this._completeTaxiRide(driverId, 'PASSENGER_LEFT');
          send({ ok: true, action: 'leave' });
          return;
        }
      }
      send({ ok: false, error: 'NO_RIDE' });
      return;
    }

    if (action === 'status') {
      const ride = this.taxiRides.get(client.sessionId);
      const customers = [];
      for (const [npcId] of this.taxiCustomers) {
        const npc = this.state.npcs.get(npcId);
        if (npc) customers.push({ npcId, x: npc.x, y: npc.y });
      }
      send({
        ok: true, action: 'status',
        taxiMode: this.taxiMode.has(client.sessionId),
        ride: ride ? {
          kind: ride.kind, passengerId: ride.passengerId,
          destX: ride.destX, destY: ride.destY, poiName: ride.poiName,
          distancePx: Math.round(ride.distancePx),
        } : null,
        customers,
        invitedBy: (this.taxiInvites.get(client.sessionId) || {}).driverId || null,
      });
      return;
    }

    send({ ok: false, error: 'BAD_ACTION', action: action || null });
  }

  // ---------------------------------------------------------------- M4 motel (§8.2)
  _onMotel(client, msg) {
    const player = this.state.players.get(client.sessionId);
    const econ = this.economy.get(client.sessionId);
    if (!player || !econ || !msg || typeof msg !== 'object') return;
    const action = msg.action;
    const now = Date.now();
    const send = (m) => client.send('motel_result', Object.assign({ type: 'motel' }, m));
    let room = this.motel.get(client.sessionId);

    if (action === 'rent' || action === 'renew') {
      if (dist(player.x, player.y, MOTEL_POS.x, MOTEL_POS.y) > ECON_RANGE) {
        send({ ok: false, error: 'TOO_FAR' }); return;
      }
      if (action === 'renew' && !room) { send({ ok: false, error: 'NO_ROOM' }); return; }
      if (action === 'rent' && room && M3.motelIsActive(room.expiresAt, now)) {
        send({ ok: false, error: 'ALREADY_RENTED', expiresAt: room.expiresAt }); return;
      }
      // Renewal extends from the OLD expiresAt, max 7 days ahead (§8.2).
      const newExpiry = action === 'renew'
        ? M3.motelRenewExpiry(room.expiresAt, now)
        : now + M3.MOTEL_RENT_HOURS * 3600 * 1000;
      if (newExpiry - now > M3.MOTEL_RENEW_MAX_DAYS * 24 * 3600 * 1000) {
        send({ ok: false, error: 'RENEW_LIMIT' }); return;
      }
      const paid = this._deductCashBank(player, M3.MOTEL_RENT);
      if (!paid.ok) { send({ ok: false, error: 'INSUFFICIENT_FUNDS', need: M3.MOTEL_RENT }); return; }
      if (!room) { room = { expiresAt: 0, chest: new Map() }; this.motel.set(client.sessionId, room); }
      room.expiresAt = newExpiry;
      player.roomExpiresAt = newExpiry;
      this._econLog(econ, 'asset_rent', -M3.MOTEL_RENT, { asset_type: 'room', asset_code: 'motel_01', expires_at: newExpiry });
      send({ ok: true, action, expiresAt: newExpiry, cash: player.cash, bank: player.bank });
      console.log(`[city] ${player.name} ${action} motel room until ${new Date(newExpiry).toISOString()}`);
      return;
    }

    if (action === 'chest_put' || action === 'chest_take') {
      if (!room || M3.motelChestState(room.expiresAt, now) !== 'active') {
        send({ ok: false, error: 'CHEST_LOCKED', state: room ? M3.motelChestState(room.expiresAt, now) : 'none' });
        return;
      }
      const itemId = msg.itemId;
      const qty = Math.max(1, Math.min(99, (msg.qty | 0) || 1));
      const item = SHOP_ITEMS[itemId];
      if (!item) { send({ ok: false, error: 'ITEM_NOT_FOUND' }); return; }
      if (action === 'chest_put') {
        const have = econ.inventory.get(itemId) || 0;
        if (have < qty) { send({ ok: false, error: 'NO_ITEM' }); return; }
        if (!room.chest.has(itemId) && room.chest.size >= M3.MOTEL_CHEST_SLOTS) {
          send({ ok: false, error: 'CHEST_FULL' }); return;
        }
        econ.inventory.set(itemId, have - qty);
        room.chest.set(itemId, (room.chest.get(itemId) || 0) + qty);
      } else {
        const stored = room.chest.get(itemId) || 0;
        if (stored < qty) { send({ ok: false, error: 'NO_ITEM' }); return; }
        room.chest.set(itemId, stored - qty);
        if (room.chest.get(itemId) <= 0) room.chest.delete(itemId);
        econ.inventory.set(itemId, (econ.inventory.get(itemId) || 0) + qty);
      }
      const chest = {};
      for (const [k, v] of room.chest) chest[k] = v;
      this._schedulePersist(client.sessionId);
      send({ ok: true, action, itemId, qty, chest, inventory: this._econInventoryObj(econ) });
      return;
    }

    if (action === 'status') {
      const chest = {};
      if (room) for (const [k, v] of room.chest) chest[k] = v;
      send({
        ok: true, action: 'status',
        expiresAt: room ? room.expiresAt : 0,
        chestState: room ? M3.motelChestState(room.expiresAt, now) : 'none',
        chest,
        inventory: this._econInventoryObj(econ),
        cash: player.cash, bank: player.bank,
      });
      return;
    }

    send({ ok: false, error: 'BAD_ACTION', action: action || null });
  }

  // ---------------------------------------------------------------- jobs (M3: §3.4 job choice, §6 Shipper)
  _syncOrderState(player, order) {
    if (!player) return;
    if (!order) {
      player.orderStatus = 'none'; player.orderId = '';
      player.orderX = 0; player.orderY = 0; player.orderDeadline = 0; player.orderReward = 0;
      player.orderPickupX = 0; player.orderPickupY = 0; player.orderPickupName = '';
    } else {
      player.orderStatus = 'accepted'; player.orderId = order.id;
      player.orderX = order.targetX; player.orderY = order.targetY;
      player.orderDeadline = order.deadlineAt; player.orderReward = order.reward;
      player.orderPickupX = order.pickupX; player.orderPickupY = order.pickupY;
      player.orderPickupName = order.pickupName;
    }
  }

  // Release an order slot back to the pool with a FRESH random target, so
  // the next player always gets a different order (§6.2 ORDER_TAKEN rule).
  // The pickup source is re-rolled too (50% warehouse / 50% shop), so the
  // pool's mix stays random instead of freezing on the first 12 sources.
  _releaseOrderSlot(order) {
    if (!order) return;
    const slot = this.orderPool.find((s) => s.id === order.slotId);
    if (!slot) return;
    slot.lockedBy = null;
    const src = M3.pickOrderSource();
    slot.pickupId = src.id; slot.pickupName = src.name; slot.pickupX = src.x; slot.pickupY = src.y;
    const t = M3.pickDeliveryPoint(null, src.id);
    slot.targetX = t.x; slot.targetY = t.y; slot.poiName = t.poiName;
  }

  // Fail the player's active order (faint mid-order, §6.2): no reward, no
  // extra penalty beyond the faint itself. Notifies the client.
  _failActiveOrder(sessionId, reason) {
    const jobEntry = this.jobs.get(sessionId);
    if (!jobEntry || !jobEntry.order) return;
    const order = jobEntry.order;
    order.status = 'failed';
    this._releaseOrderSlot(order);
    jobEntry.order = null;
    const player = this.state.players.get(sessionId);
    this._syncOrderState(player, null);
    this._sendTo(sessionId, 'job_result', { type: 'shipper', ok: false, error: 'FAILED', orderId: order.id, reason: reason || 'fainted' });
  }

  _onJob(client, msg) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !msg || typeof msg !== 'object') return;
    const job = msg.job;
    if (!M3.JOBS.includes(job)) {
      client.send('job_result', { type: 'job', ok: false, error: 'BAD_JOB', job: job || null });
      return;
    }
    const jobEntry = this.jobs.get(client.sessionId);
    // Cannot abandon Shipper mid-order or Taxi mid-ride.
    if (jobEntry && jobEntry.order && job !== 'shipper') {
      client.send('job_result', { type: 'job', ok: false, error: 'ACTIVE_ORDER' });
      return;
    }
    if (job !== 'taxi_driver' && this.taxiRides.has(client.sessionId)) {
      client.send('job_result', { type: 'job', ok: false, error: 'ACTIVE_RIDE' });
      return;
    }
    // M4: leaving the taxi_driver job turns "Nhận khách" off.
    if (job !== 'taxi_driver') this.taxiMode.delete(client.sessionId);
    player.job = job;
    this._schedulePersist(client.sessionId);
    client.send('job_result', { type: 'job', ok: true, job });
    console.log(`[city] ${player.name} job -> ${job}`);
  }

  _onShipper(client, msg) {
    const player = this.state.players.get(client.sessionId);
    const jobEntry = this.jobs.get(client.sessionId);
    const econ = this.economy.get(client.sessionId);
    if (!player || !jobEntry || !econ || !msg || typeof msg !== 'object') return;
    const action = msg.action;
    const now = Date.now();

    if (action === 'accept') {
      if (player.job !== 'shipper') {
        client.send('job_result', { type: 'shipper', ok: false, error: 'NOT_SHIPPER' });
        return;
      }
      if (player.isFainted) {
        client.send('job_result', { type: 'shipper', ok: false, error: 'FAINTED' });
        return;
      }
      if (jobEntry.order) {
        client.send('job_result', { type: 'shipper', ok: false, error: 'ALREADY_HAVE_ORDER', orderId: jobEntry.order.id });
        return;
      }
      if (now < jobEntry.cancelCooldownUntil) {
        client.send('job_result', {
          type: 'shipper', ok: false, error: 'COOLDOWN',
          retryAfterSec: Math.ceil((jobEntry.cancelCooldownUntil - now) / 1000),
        });
        return;
      }
      // Multi-shop (user 2026-11-25): accept at ANY pickup source — the
      // nearest source to the player — and take a free slot FOR that source.
      // Standing nowhere near a source -> TOO_FAR (as before); near a source
      // whose slots are all taken -> ORDER_TAKEN ("thử cửa hàng khác").
      const nearSrc = M3.nearestShipperSource(player.x, player.y);
      if (!nearSrc || nearSrc.distance > M3.SHIPPER_RANGE) {
        client.send('job_result', { type: 'shipper', ok: false, error: 'TOO_FAR' });
        return;
      }
      const slot = this.orderPool.find((s) => !s.lockedBy && s.pickupId === nearSrc.id);
      if (!slot) {
        client.send('job_result', { type: 'shipper', ok: false, error: 'ORDER_TAKEN' });
        return;
      }
      slot.lockedBy = client.sessionId;
      const distance = Math.round(dist(player.x, player.y, slot.targetX, slot.targetY));
      // M4 (§6.3, §6.4): the deadline uses the speed of the vehicle the
      // player is RIDING at accept time (walk 180 / bicycle 234 /
      // motorbike 324) and is LOCKED — changing vehicle mid-order does not
      // change it. The reward uses the LOCKED pay multiplier for that
      // vehicle (walk x1.00 / bicycle x1.30 / motorbike x2.00).
      const acceptSpeed = M3.vehicleSpeed(player.vehicleId, player.fuel, player.durability);
      const seconds = M3.deliverySeconds(distance, acceptSpeed);
      // Áp dụng Dynamic Surge: Nếu khu vực có nhu cầu cao hoặc đơn xa thì tăng thưởng
      const isNight = M3.isNightWorld(this.state.worldTime);
      const reward = (typeof M3.deliveryRewardDynamic === 'function')
        ? M3.deliveryRewardDynamic(distance, isNight, player.vehicleId, 1.0)
        : M3.deliveryRewardFor(distance, isNight, player.vehicleId);
      const order = {
        id: slot.id + '-' + (++this.orderSeq),
        slotId: slot.id, targetX: slot.targetX, targetY: slot.targetY, poiName: slot.poiName,
        pickupId: slot.pickupId, pickupName: slot.pickupName, pickupX: slot.pickupX, pickupY: slot.pickupY,
        distance, reward,
        vehicleId: player.vehicleId || '',
        deadlineAt: now + seconds * 1000, idempotencyKey: randomUUID(),
        status: 'accepted', jobType: 'delivery', userId: client.sessionId,
      };
      jobEntry.order = order;
      this._syncOrderState(player, order);
      client.send('job_result', {
        type: 'shipper', ok: true, action: 'accept',
        order: {
          id: order.id, targetX: order.targetX, targetY: order.targetY, poiName: order.poiName,
          pickupId: order.pickupId, pickupName: order.pickupName, pickupX: order.pickupX, pickupY: order.pickupY,
          distance: order.distance, reward: order.reward, deadlineAt: order.deadlineAt,
          secondsLeft: seconds, vehicleId: order.vehicleId,
        },
      });
      console.log(`[city] ${player.name} accepted ${order.id} @${order.pickupName} -> (${order.targetX},${order.targetY}) ${distance}px ${seconds}s reward ${order.reward}đ`);
      return;
    }

    if (action === 'complete') {
      // Idempotency FIRST (§4.3): a retried complete of an already-paid
      // order answers ALREADY_PROCESSED and pays nothing twice.
      if (msg.orderId && jobEntry.completedOrderIds.has(msg.orderId)) {
        client.send('job_result', { type: 'shipper', ok: false, error: 'ALREADY_PROCESSED', orderId: msg.orderId });
        return;
      }
      const order = jobEntry.order;
      if (!order || (msg.orderId && msg.orderId !== order.id)) {
        client.send('job_result', { type: 'shipper', ok: false, error: 'NO_ORDER' });
        return;
      }
      if (player.isFainted) {
        client.send('job_result', { type: 'shipper', ok: false, error: 'FAINTED' });
        return;
      }
      if (now > order.deadlineAt) {
        order.status = 'expired';
        this._releaseOrderSlot(order);
        jobEntry.order = null;
        this._syncOrderState(player, null);
        client.send('job_result', { type: 'shipper', ok: false, error: 'EXPIRED', orderId: order.id });
        return;
      }
      if (dist(player.x, player.y, order.targetX, order.targetY) > M3.DELIVER_RANGE) {
        client.send('job_result', { type: 'shipper', ok: false, error: 'TOO_FAR', needPx: M3.DELIVER_RANGE });
        return;
      }
      order.status = 'delivered';
      jobEntry.completedOrderIds.add(order.id);
      this._releaseOrderSlot(order);
      jobEntry.order = null;
      this._syncOrderState(player, null);
      player.cash += order.reward;
      this._econLog(econ, 'job_reward', order.reward, {
        job: 'delivery', delivery_id: order.id, distance_px: order.distance,
        vehicle_id: order.vehicleId || 'foot',
        idempotency_key: order.idempotencyKey,
      });
      client.send('job_result', {
        type: 'shipper', ok: true, action: 'complete',
        orderId: order.id, reward: order.reward, cash: player.cash, bank: player.bank,
      });
      console.log(`[city] ${player.name} delivered ${order.id} +${order.reward}đ (cash ${player.cash})`);
      return;
    }

    if (action === 'cancel') {
      const order = jobEntry.order;
      if (!order) {
        client.send('job_result', { type: 'shipper', ok: false, error: 'NO_ORDER' });
        return;
      }
      order.status = 'cancelled';
      this._releaseOrderSlot(order);
      jobEntry.order = null;
      this._syncOrderState(player, null);
      jobEntry.cancelCooldownUntil = now + M3.ORDER_CANCEL_COOLDOWN_S * 1000;
      client.send('job_result', { type: 'shipper', ok: true, action: 'cancel', orderId: order.id });
      console.log(`[city] ${player.name} cancelled ${order.id} (10 s cooldown)`);
      return;
    }

    if (action === 'status') {
      const order = jobEntry.order;
      client.send('job_result', {
        type: 'shipper', ok: true, action: 'status',
        order: order ? {
          id: order.id, targetX: order.targetX, targetY: order.targetY, poiName: order.poiName,
          distance: order.distance, reward: order.reward, deadlineAt: order.deadlineAt,
          secondsLeft: Math.max(0, Math.ceil((order.deadlineAt - now) / 1000)),
        } : null,
        cancelCooldownSec: Math.max(0, Math.ceil((jobEntry.cancelCooldownUntil - now) / 1000)),
      });
      return;
    }

    client.send('job_result', { type: 'shipper', ok: false, error: 'BAD_ACTION', action: action || null });
  }

  // ---------------------------------------------------------------- simulation
  _simStep(dtMs) {
    const dt = dtMs / 1000;
    // Bots: walk to target, pause 3-8 s, pick a new open target.
    for (const [botId, bot] of this.bots) {
      const p = this.state.players.get(botId);
      if (!p) continue;
      this._wander(p, bot, dt);
    }
    for (const [npcId, w] of this.walkers) {
      const n = this.state.npcs.get(npcId);
      if (!n) continue;
      this._wanderNpc(n, w, dt);
    }
  }

  _wander(p, bot, dt) {
    const now = Date.now();
    if (now < bot.pauseUntil) { p.vx = 0; p.vy = 0; if (p.anim !== 'idle') p.anim = 'idle'; return; }
    const d = dist(p.x, p.y, bot.targetX, bot.targetY);
    if (d < 8) {
      bot.pauseUntil = now + randRange(3000, 8000);
      p.vx = 0; p.vy = 0; p.anim = 'idle';
      const t = randomOpenPointNearSpawn(1200);
      bot.targetX = t.x; bot.targetY = t.y;
      return;
    }
    const step = bot.speed * dt;
    const nx = p.x + ((bot.targetX - p.x) / d) * step;
    const ny = p.y + ((bot.targetY - p.y) / d) * step;
    if (!blocked(nx, ny, 16)) { p.x = nx; p.y = ny; }
    else { const t = randomOpenPointNearSpawn(1200); bot.targetX = t.x; bot.targetY = t.y; }
    p.vx = ((bot.targetX - p.x) / d) * bot.speed;
    p.vy = ((bot.targetY - p.y) / d) * bot.speed;
    p.anim = 'walk';
  }

  _wanderNpc(n, w, dt) {
    const now = Date.now();
    if (now < w.pauseUntil) return;
    const d = dist(n.x, n.y, w.targetX, w.targetY);
    if (d < 8) {
      w.pauseUntil = now + randRange(3000, 8000);
      const t = Colliders.randomOpenPoint();
      w.targetX = t.x; w.targetY = t.y; n.targetX = t.x; n.targetY = t.y;
      return;
    }
    const step = w.speed * dt;
    const nx = n.x + ((w.targetX - n.x) / d) * step;
    const ny = n.y + ((w.targetY - n.y) / d) * step;
    if (!blocked(nx, ny, 16)) { n.x = nx; n.y = ny; }
    else { const t = Colliders.randomOpenPoint(); w.targetX = t.x; w.targetY = t.y; n.targetX = t.x; n.targetY = t.y; }
  }

  // 1 s tick: world clock, survival, faint auto-revive, bot proactive chat.
  _secondTick() {
    if (!this.state) return;
    const now = Date.now();
    this.state.worldTime = (this.state.worldTime + 1) % 1440; // 1 game-min / real sec

    for (const [id, p] of this.state.players) {
      // Expire chat bubbles.
      if (p.chatBubble && now > p.chatBubbleUntil) p.chatBubble = '';
      if (this.bots.has(id)) continue; // bots don't hunger/faint
      const sv = this.survival.get(id);
      if (!sv) continue;
      if (p.isFainted) {
        if (sv.faintedUntil && now >= sv.faintedUntil) {
          // Auto-revive at hospital after 60 s (§3.2.4/§3.2.5): fee, not
          // a second 50% loss — the faint loss was already taken at faint
          // time (see below).
          this._hospitalRevive(p, sv);
        }
        continue;
      }
      // M3: stamina regens +3/s while idle too. _onMove only regens on
      // move messages, and an idle client sends none — without this, a
      // standing player's stamina would never recover server-side.
      const data = this.clientData.get(id);
      if (data && !data.sprinting && now - (data.lastMoveAt || 0) > 1000) {
        p.stamina = clamp(p.stamina + 3, 0, 100);
      }
      // Hunger -1 / 15 s.
      if (++sv.hungerAcc >= 15) { sv.hungerAcc = 0; p.hunger = Math.max(0, p.hunger - 1); }
      if (p.hunger === 0) {
        // -2 HP / 10 s.
        if (++sv.hpLossAcc >= 10) {
          sv.hpLossAcc = 0; p.hp = Math.max(0, p.hp - 2);
          sv.regenAcc = 0;
        }
      } else {
        sv.hpLossAcc = 0;
        if (p.hunger > 50) {
          // Regen +1 HP / 10 s, only when Hunger > 50 and not fainted.
          if (++sv.regenAcc >= 10) { sv.regenAcc = 0; p.hp = Math.min(100, p.hp + 1); }
        } else sv.regenAcc = 0;
      }
      if (p.hp <= 0) {
        p.hp = 0; p.isFainted = true; p.anim = 'fainted'; p.vx = 0; p.vy = 0;
        sv.faintedUntil = now + FAINT_SECONDS * 1000;
        sv.faintedAt = now;
        // M3 (§3.2.3): lose 50% Cash IMMEDIATELY on fainting (sink, Bank
        // untouched), logged as faint_loss. The hospital fee later is
        // charged on the REMAINING cash (§3.2.5).
        const lost = M3.faintLoss(p.cash);
        p.cash -= lost;
        const econ = this.economy.get(id);
        if (econ) this._econLog(econ, 'faint_loss', -lost, { cash_after: p.cash });
        console.log(`[city] ${p.name} fainted (60 s countdown, lost ${lost}đ, cash now ${p.cash})`);
        // M4: broadcast an explicit 'fainted' message to the whole room.
        // This is the fix for the known M3 gap (online self-faint played no
        // sound): the client's onFainted hook plays DTA_SFX.faint for self,
        // and doctors get the faint_alert below as before.
        this.broadcast('fainted', { playerId: id, name: p.name, x: p.x, y: p.y, at: now });
        // M3 (§6.2): fainting mid-order fails the order, no reward.
        this._failActiveOrder(id, 'fainted');
        // M3 (§3.4.3): alert doctors (job='doctor') with coordinates —
        // shown on their minimap + system chat.
        for (const c of this.clients) {
          const dp = this.state.players.get(c.sessionId);
          if (dp && dp.job === 'doctor' && c.sessionId !== id) {
            try { c.send('faint_alert', { playerId: id, name: p.name, x: p.x, y: p.y, at: now }); } catch (e) { /* ignore */ }
          }
        }
      }
    }

    // M3 (§6.2): expire overdue orders (no reward, no penalty) and release
    // their slots; held orders from disconnected players expire after 30 s.
    for (const [sid, jobEntry] of this.jobs) {
      const order = jobEntry.order;
      if (order && now > order.deadlineAt) {
        order.status = 'expired';
        this._releaseOrderSlot(order);
        jobEntry.order = null;
        const player = this.state.players.get(sid);
        this._syncOrderState(player, null);
        this._sendTo(sid, 'job_result', { type: 'shipper', ok: false, error: 'EXPIRED', orderId: order.id });
        console.log(`[city] order ${order.id} EXPIRED`);
      }
    }
    for (const [sid, held] of this.heldOrders) {
      if (now - held.leftAt > 30000) {
        held.order.status = 'expired';
        this._releaseOrderSlot(held.order);
        this.heldOrders.delete(sid);
        console.log(`[city] held order ${held.order.id} EXPIRED (no reconnect in 30 s)`);
      }
    }

    // M4 taxi (§10.2): NPC customers spawn at intersections while the room
    // has < 4 real players and at least one driver has "Nhận khách" on;
    // unpicked customers despawn after 5 min. NPC rides auto-complete
    // when the driver reaches the destination (checked below).
    this._taxiTick(now);
    // M4 motel (§8.2): a chest whose room expired >= 24h ago is deleted
    // for good (held chests are kept until then; renewing re-opens them).
    for (const [sid, room] of this.motel) {
      if (room.expiresAt && now >= room.expiresAt + M3.MOTEL_CHEST_HOLD_HOURS * 3600 * 1000 && room.chest.size > 0) {
        room.chest.clear();
        console.log(`[city] motel chest deleted for ${sid} (expired 24h+ ago)`);
      }
    }

    // Bot proactive chat: max 1 line per 20-40 s per bot, only with a human nearby.
    for (const [botId, bot] of this.bots) {
      if (now < bot.nextProactiveAt) continue;
      bot.nextProactiveAt = now + randRange(20000, 40000);
      const bp = this.state.players.get(botId);
      if (!bp) continue;
      let humanNear = false;
      for (const [id, p] of this.state.players) {
        if (this.bots.has(id)) continue;
        if (dist(p.x, p.y, bp.x, bp.y) <= NEARBY_RADIUS) { humanNear = true; break; }
      }
      if (humanNear) this._speakProactively(botId);
    }

    // M5: periodic autosave (every 15 s) for active authenticated players.
    if (sb.isConfigured() && ++this._saveTickAcc >= 15) {
      this._saveTickAcc = 0;
      for (const [sid, d] of this.clientData) {
        if (!d.isBot && d.userId) {
          const pl = this.state.players.get(sid);
          const vh = this.vehicles.get(sid);
          if (pl && vh && pl.vehicleId && vh[pl.vehicleId]) {
            vh[pl.vehicleId].x = pl.x; vh[pl.vehicleId].y = pl.y;
            vh[pl.vehicleId].fuel = pl.fuel; vh[pl.vehicleId].durability = pl.durability;
          }
          this._persistNow(sid).catch(() => {});
        }
      }
    }
  }
}

module.exports = { CityRoom };
