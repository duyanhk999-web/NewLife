/* Cuộc Sống Ảo — M0 Prototype (PixiJS v8, local single-player, no server)
   PlayerState shape is kept ready for future Colyseus (see playerState below).
   All gameplay HUD is drawn on Canvas/WebGL (Pixi). No DOM overlay in M0. */
(function () {
  'use strict';

  // Map v2 (2026-11-25, assets/v3/MAP_V3_DESIGN.md): 4800x4800, roads
  // 180px at 1140/2340/3540 + 40px sidewalks. Collision data lives in
  // shared/colliders.js — the local copies below are ONLY the fallback
  // when Colliders failed to load; they must match it exactly.
  var MAP_W = 4800, MAP_H = 4800;
  var WALK_SPEED = 180, SPRINT_SPEED = 300;
  // TEST MODE (?test=1, 2026-11-25): free money + speed multiplier + full
  // heal, OFF by default. testSpeedMult multiplies walk/sprint OFFLINE
  // only — online the server is authoritative (see initTestMode).
  var testMode = false, testSpeedMult = 1;
  var DAY_MINUTES = 1440; // 24 real minutes = 24 game hours -> 1 game min / 1 real sec

  // ---------- seeded random (stable map every load) ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rand = mulberry32(20261124);
  var signalLayer = null;
  function randRange(a, b) { return a + rand() * (b - a); }
  function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

  // ---------- map data (Map v2 — see shared/colliders.js, the source of truth) ----------
  function inRoad(x, y) { return RoadNet.inRoad(x, y); }

  var BUILDINGS = (typeof Colliders !== 'undefined' && Colliders.BUILDINGS) ? Colliders.BUILDINGS : [
    { id: 'bank',      name: 'Ngân Hàng & ATM',        x: 1400, y: 1400, w: 450, h: 330, color: 0x2e6db4, roof: 0x1d4e89 },
    { id: 'shop',      name: 'Cửa Hàng Tiện Lợi 24/7', x: 3000, y: 1400, w: 450, h: 330, color: 0xe67e22, roof: 0xb95c0e },
    { id: 'hospital',  name: 'Bệnh Viện',              x: 3840, y: 1425, w: 570, h: 420, color: 0xecf0f1, roof: 0xc0392b },
    { id: 'showroom',  name: 'Showroom Xe Máy',        x: 1400, y: 3100, w: 480, h: 360, color: 0x8e44ad, roof: 0x6c3483 },
    { id: 'motel',     name: 'Khu Nhà Trọ',            x: 2990, y: 3080, w: 480, h: 390, color: 0x16a085, roof: 0x0e6b5c },
    { id: 'warehouse', name: 'Kho Hàng Trung Tâm',     x: 3840, y: 2670, w: 630, h: 480, color: 0x7f8c8d, roof: 0x5d6d7e },
    { id: 'house1',    name: 'Nhà Dân',                x: 180,  y: 180,  w: 390, h: 300, color: 0xf1c40f, roof: 0xd4ac0d },
    { id: 'house2',    name: 'Chung Cư',               x: 1425, y: 180,  w: 480, h: 330, color: 0xecf0f1, roof: 0x95a5a6 },
    { id: 'house3',    name: 'Nhà Dân',                x: 2670, y: 180,  w: 390, h: 300, color: 0xf39c12, roof: 0xca6f1e },
    { id: 'house4',    name: 'Chung Cư',               x: 3840, y: 180,  w: 480, h: 330, color: 0xaed6f1, roof: 0x5dade2 },
    { id: 'house5',    name: 'Nhà Dân',                x: 180,  y: 1425, w: 390, h: 330, color: 0x82e0aa, roof: 0x229954 },
    { id: 'house6',    name: 'Nhà Dân',                x: 180,  y: 2670, w: 390, h: 360, color: 0xf5cba7, roof: 0xca6f1e },
    { id: 'house7',    name: 'Nhà Dân',                x: 180,  y: 3840, w: 420, h: 390, color: 0xd2b4de, roof: 0x7d3c98 },
    { id: 'house8',    name: 'Chung Cư',               x: 1425, y: 3840, w: 510, h: 390, color: 0xfadbd8, roof: 0xcd6159 },
    { id: 'house9',    name: 'Nhà Dân',                x: 2670, y: 3840, w: 420, h: 390, color: 0xa9cce3, roof: 0x2e86c1 },
    { id: 'market',    name: 'Chợ',                    x: 3840, y: 3840, w: 630, h: 450, color: 0xf9e79f, roof: 0xb7950b },
    { id: 'police',    name: 'Đồn Công An',            x: 3790, y: 600,  w: 480, h: 360, color: 0x2c3e50, roof: 0x1a252f },
    { id: 'school',    name: 'Trường Học',             x: 180,  y: 4240, w: 600, h: 420, color: 0xf5b7b1, roof: 0xec7063 },
    { id: 'cafe',      name: 'Quán Cà Phê',            x: 2580, y: 4230, w: 360, h: 300, color: 0xa67c52, roof: 0x6e4b2a },
    { id: 'pavilion',  name: 'Nhà Vọng Cảnh',          x: 4390, y: 600,  w: 300, h: 300, color: 0x7dcea0, roof: 0x2e86c1 },
    { id: 'house10',   name: 'Nhà Dân',                x: 3840, y: 4320, w: 390, h: 300, color: 0xf1c40f, roof: 0xd4ac0d },
    { id: 'house11',   name: 'Nhà Dân',                x: 4290, y: 4320, w: 390, h: 300, color: 0x82e0aa, roof: 0x229954 },
    { id: 'house12',   name: 'Chung Cư',               x: 1500, y: 4230, w: 480, h: 360, color: 0xaed6f1, roof: 0x5dade2 }
  ];
  // NOTE: BUILDINGS above is the shared/colliders.js copy when available
  // (verified identical — 22 rects). Collision rects must NEVER change here;
  // the server is authoritative and uses the same data.

  // POI marker points (Map v2 building centres; spawn = plaza south edge).
  var POIS = [
    { id: 'spawn',     name: 'Điểm Hồi Sinh / NPC Hướng Dẫn', x: 2430, y: 2650, color: 0x2ecc71 },
    { id: 'bank',      name: 'Ngân Hàng & ATM',        x: 1625, y: 1565, color: 0x3498db },
    { id: 'shop',      name: 'Cửa Hàng Tiện Lợi 24/7', x: 3225, y: 1565, color: 0xe67e22 },
    { id: 'hospital',  name: 'Bệnh Viện',              x: 4125, y: 1635, color: 0xe74c3c },
    { id: 'showroom',  name: 'Showroom Xe Máy',        x: 1640, y: 3280, color: 0x9b59b6 },
    { id: 'motel',     name: 'Khu Nhà Trọ',            x: 3230, y: 3275, color: 0x1abc9c },
    { id: 'warehouse', name: 'Kho Hàng Trung Tâm',     x: 4155, y: 2910, color: 0x95a5a6 },
    { id: 'police',    name: 'Đồn Công An',            x: 4030, y: 780,  color: 0x2c3e50 },
    { id: 'school',    name: 'Trường Học',             x: 480,  y: 4450, color: 0xec7063 },
    { id: 'cafe',      name: 'Quán Cà Phê',            x: 2760, y: 4380, color: 0xa67c52 },
    { id: 'market',    name: 'Chợ',                    x: 4155, y: 4065, color: 0xf1c40f },
    { id: 'pavilion',  name: 'Nhà Vọng Cảnh',          x: 4530, y: 750,  color: 0x7dcea0 }
  ];

  function hitBuilding(x, y, r) {
    if (typeof Colliders !== 'undefined' && Colliders.hitBuilding) return Colliders.hitBuilding(x, y, r);
    for (var i = 0; i < BUILDINGS.length; i++) {
      var b = BUILDINGS[i];
      if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return true;
    }
    return false;
  }
  // Map v2: fences block except at the corner gaps; the fountain is a circle.
  function hitFence(x, y, r) {
    if (typeof Colliders !== 'undefined' && Colliders.hitFence) return Colliders.hitFence(x, y, r);
    return false;
  }
  function inFountain(x, y, r) {
    if (typeof Colliders !== 'undefined' && Colliders.inFountain) return Colliders.inFountain(x, y, r);
    var dx = x - 2400, dy = y - 2400;
    return dx * dx + dy * dy < (90 + (r || 0)) * (90 + (r || 0));
  }
  // One blocked() test for all movement code (player, NPCs, offline bots):
  // buildings + fences + fountain. Roads do NOT block walking.
  function blocked(x, y, r) {
    return hitBuilding(x, y, r) || hitFence(x, y, r) || inFountain(x, y, r);
  }
  function isOpenPoint(x, y) { return Colliders.isOpenPoint(x, y); }
  function randomOpenPoint() { return Colliders.randomOpenPoint(); }

  // ---------- player state (Colyseus-ready shape) ----------
  var playerState = {
    id: 'local-1', name: 'CongDan', x: 2430, y: 2650, vx: 0, vy: 0,
    anim: 'idle', job: 'unemployed', hp: 100, hunger: 100, stamina: 100,
    // M2 (SRS §4.5/§5.1): profile is created with Cash = 0. The 80.000đ
    // starter grant comes from Economy.starterGrant() — ONE transaction,
    // logged as starter_grant, never a hardcoded default.
    cash: 0, bank: 0, isFainted: false, vehicleId: null,
    // M4 (§8): fuel % (motorbike) / durability % (bicycle) of the ridden
    // vehicle, the passenger aboard (taxi), and the motel room expiry.
    fuel: 100, durability: 100, passengerId: null, roomExpiresAt: 0,
    // M3 (§6): active order mirrored from the server (online) or the local
    // engine in jobs.js (offline). {status, id, x, y, deadline, reward} | null.
    order: null
  };
  var worldTime = 480; // 08:00, minutes 0..1440
  var worldDay = 1; // game-day counter, starts at 1 (clock fix 2026-11-25:
  // the clock showed "08:56 • Ngày" with no day number — worldTime wraps
  // every 1440 min but nothing counted the days)

  // ---------- M2: zoom / camera ----------
  // M0 used clamp(W/1100, 0.35, 1) — at 390px wide that is 0.35x and the
  // character rendered ~15px tall. M1 used mobile 2.0x / desktop 1.3x — user
  // said zoom was NOT good (too close on portrait, disorienting) and text
  // overflowed its frames. M2: mobile portrait 1.6x, desktop 1.2x,
  // adjustable 1.0x–2.2x (step 0.2). Full-body sprite is 42 world px tall,
  // so on 390x844 portrait it renders ~67px tall on screen: readable, not
  // giant, map still visible around the player.
  var HUD_BIG = (typeof window !== 'undefined' && window.innerWidth < 600);
  var zoom = HUD_BIG ? 1.6 : 1.2;
  var ZOOM_MIN = 1.0, ZOOM_MAX = 2.2, ZOOM_STEP = 0.2;
  var zoomInBtn = null, zoomOutBtn = null, zoomLabel = null;
  var pinchPointers = {}, pinchActive = false, pinchStartDist = 0, pinchStartZoom = 0;

  // ---------- M1: assets (PIXI.Assets, per-file fallback to M0 Graphics) ----------
  var TEX = {}; // key -> PIXI.Texture | null
  var ASSET_FILES = {
    // Map v2 texture: ONLY the start backdrop.
    // NEVER stretched over the whole 4800 map (1024px would blur badly) —
    // roads / grass are drawn from the layout data in buildWorld().
    plaza: 'assets/v3/map-city-v3.png',
    // Map v2 buildings: flat-roof crops for the 3/4-front ones (FLUX cannot
    // draw a pure flat roof — bank/shop/showroom/house-b/house-c are crops),
    // TIGHT crops (2026-11-25) for the full-scene ones: FLUX drew each
    // building surrounded by neighbour buildings + streets + brown asphalt,
    // and stretching the whole 1024 scene into the collider rect painted
    // fake streets inside every block (the "brown streak" live bug).
    // *-tight.png = building + lot only; drawn contain-fit, never stretched.
    bank: 'assets/v3/building-bank-roof.png', hospital: 'assets/v3/building-hospital-tight.png',
    warehouse: 'assets/v3/building-warehouse-tight.png', shop: 'assets/v3/building-shop-roof.png',
    showroom: 'assets/v3/building-showroom-roof.png', motel: 'assets/v3/building-motel-tight.png',
    policeStation: 'assets/v3/building-police-tight.png', market: 'assets/v3/building-market-tight.png',
    school: 'assets/v3/building-school-tight.png', cafe: 'assets/v3/building-cafe-tight.png',
    pavilion: 'assets/v3/building-pavilion-tight.png',
    houseA: 'assets/v3/house-a-tight.png', houseB: 'assets/v3/house-b-roof.png', houseC: 'assets/v3/house-c-roof.png',
    // Map v2 props (transparent *-full.png, re-keyed in assets/v3/).
    treeA: 'assets/v3/prop-tree-a-full.png', treeB: 'assets/v3/prop-tree-b-full.png',
    bushFlower: 'assets/v3/prop-bush-flower-full.png', lamp: 'assets/v3/prop-lamp-full.png',
    bench: 'assets/v3/prop-bench-full.png', bin: 'assets/v3/prop-bin-full.png',
    box: 'assets/v3/prop-box-full.png', dog: 'assets/v3/prop-dog-full.png',
    cat: 'assets/v3/prop-cat-full.png', car: 'assets/v3/prop-car-full.png',
    motorbike: 'assets/v3/prop-motorbike-full.png',
    // VEHICLES FIX (2026-11-25): the bicycle had NO image at all (only the
    // motorbike prop existed). FLUX v2, high-angle, keyed out by
    // make_v3_sprites.py — used for the parked owned bike + the ridden bike
    // under the player. The motorbike prop is reused for the same.
    bicycle: 'assets/v3/prop-bicycle-full.png',
    fenceSeg: 'assets/v3/prop-fence-segment-full.png', fenceCorner: 'assets/v3/prop-fence-corner-full.png',
    // 2.5D Pixel Art Urban Sidewalk Sample Props
    sidewalkTile: 'assets/sidewalk-tile-vietnam.png',
    curbStraightH: 'assets/curb-straight-h.png',
    curbCornerTL: 'assets/curb-corner-tl.png',
    sampleSidewalk: 'assets/prop-sidewalk-sample.png',
    samplePowerBox: 'assets/prop-powerbox-sample.png',
    sampleStools: 'assets/prop-stools-sample.png',
    sampleTreeBox: 'assets/prop-treebox-sample.png',
    // M2: *-full.png = transparent full-body sprites for IN-WORLD characters.
    // *-crop.png (portrait crops) are ONLY for the small HUD avatar — never
    // as a moving character (user complaint M1: "sao lại là avatar hình tròn?").
    // v3 characters are high-angle overhead figures (MAP_V3_DESIGN.md §6).
    hero: 'assets/hero-citizen-crop.png', shipper: 'assets/npc-shipper-crop.png',
    bread: 'assets/npc-bread-crop.png', taxi: 'assets/npc-taxi-crop.png',
    police: 'assets/npc-police-crop.png', thug: 'assets/npc-thug-crop.png',
    student: 'assets/npc-student-crop.png',
    heroFull: 'assets/v3/hero-citizen-full.png', shipperFull: 'assets/v3/npc-shipper-full.png',
    breadFull: 'assets/v3/npc-bread-full.png', taxiFull: 'assets/v3/npc-taxi-standing-full.png',
    policeFull: 'assets/v3/npc-police-full.png', thugFull: 'assets/v3/npc-thug-full.png',
    studentFull: 'assets/v3/npc-student-full.png'
  };
  var FULL_TEX = { hero: 'heroFull', citizen: 'heroFull', guide: 'taxiFull', shipper: 'shipperFull', bread: 'breadFull', taxi: 'taxiFull', police: 'policeFull', thug: 'thugFull', student: 'studentFull' };
  // Building sprite per id (Map v2 §6): roof crops where FLUX drew a 3/4
  // facade, full images where the building is already flat. Houses share
  // the 3 variants (a = full, b/c = roof crops).
  var POI_TEX = { bank: 'bank', hospital: 'hospital', warehouse: 'warehouse', shop: 'shop', showroom: 'showroom', motel: 'motel', police: 'policeStation', market: 'market', school: 'school', cafe: 'cafe', pavilion: 'pavilion' };
  var HOUSE_TEX = { house1: 'houseA', house2: 'houseC', house3: 'houseA', house4: 'houseC', house5: 'houseB', house6: 'houseB', house7: 'houseA', house8: 'houseC', house9: 'houseB', house10: 'houseA', house11: 'houseB', house12: 'houseC' };
  var AVATAR_TEX = { hero: 'hero', citizen: 'hero', guide: 'hero', shipper: 'shipper', bread: 'bread', taxi: 'taxi', police: 'police', thug: 'thug', student: 'student' };
  var AVATAR_COLOR = { hero: 0x2980b9, citizen: 0x2980b9, guide: 0x27ae60, shipper: 0xf39c12, bread: 0xe67e22, taxi: 0x3498db, police: 0x2c3e50, thug: 0xc0392b, student: 0x9b59b6 };

  // ---------- M1: multiplayer / chat ----------
  var netMode = 'offline'; // 'offline' | 'online' | 'reconnecting'
  var myName = 'CongDan';
  var mySessionId = null;
  var authSb = null; // M5 Supabase Auth client (when server /config provides URL + publishable key)
  var authSession = null; // current Supabase session
  var firstSelfSync = true;
  var lastSelfBubbleText = '';
  var lastHumanCount = -1;
  var remotePlayers = {}; // id -> remote entry (humans + bots, online & offline)
  var offlineBotsSpawned = false;
  var moveSeq = 0, moveAccumMs = 0, lastMoveSentAt = 0;
  var lastInput = { dx: 0, dy: 0, sprint: false, len: 0 };
  var lastSentMove = { dx: 0, dy: 0, sprint: false, len: 0 };
  var chatChannel = 'nearby'; // default: Gần
  var chatOpen = false;
  var chatInputFocused = false;
  var chatTargetId = null; // radial-selected player id (for private chat)
  var chatEls = {};

  // ---------- app ----------
  var app, world, hud, nightOverlay, startOverlay;
  var player, playerGfx;
  var npcs = [], tutorialNpc = null;
  var animals = []; // Map v2 §7: dogs + cats, visual-only wanderers (no gameplay)
  var traffic = []; // 2026-11-25: ambient moving cars/motorbikes on the roads (visual only)
  var cullables = []; // {obj, x, y, w, h}
  var lampGlows = [];
  var keys = {};
  var joy = { active: false, id: null, dx: 0, dy: 0 };
  var sprintTouch = false;
  var started = false;
  var scale = 1;
  var longPressTimer = null, longPressPos = null;
  // TAP-TO-TALK (2026-11-25, phone play-test): long-press was the only
  // touch path and NPCs walk away in 500ms, so the menu opened on empty
  // air. A quick tap (<350ms, <14px move) on a nearby NPC/player now
  // opens the radial menu instantly; long-press stays as a fallback.
  var tapDown = null; // {sx, sy, t, wx, wy} — screen + world coords of pointerdown
  var talkHint = null; // world-space floating "💬" above the nearest in-range NPC/player
  // VEHICLES FIX (2026-11-25): the ridden vehicle was invisible (speed
  // changed but no sprite, no indicator) and owned parked vehicles were
  // never drawn — the player could not find or see their bike. rideSpr is
  // the vehicle sprite under the player; parkedVehicleNodes holds one
  // labelled container per vehicle type for the parked owned vehicles.
  var rideSpr = null;
  var parkedVehicleNodes = {}; // id -> {c, spr}
  var radialTarget = null; // {kind, name, x, y, npc}
  var bubbleTimer = null;
  var minimapTimer = 0, fpsTimer = 0, fpsCount = 0, fpsValue = 60;

  var hudRefs = {}; // graphics/text refs created in buildHUD
  var radialMenu, radialButtons = [];
  var bubble, bubbleText;
  var minimapG, minimapMask;

  // ---------- M3: survival / faint / shipper (offline mirror of the server) ----------
  var faintInfo = null; // {at, until} — set when isFainted flips true
  var faintAlerts = []; // {x, y, until} — fainted players doctors must see (§3.4.3)
  var localSurv = { hungerAcc: 0, hpLossAcc: 0, regenAcc: 0 }; // offline 1s accumulators
  var orderArrow = null; // world-space arrow pointing at the delivery target
  var faintPanelEl = null, faintTextEl = null, hospitalBtnEl = null;
  // M4: online vehicle/motel state mirrored from the server (vehicleResult
  // / motelResult messages + state patches), and taxi-customer sprites.
  var onlineVehicles = { riding: '', bicycle: { owned: false }, motorbike: { owned: false } };
  var onlineTaxiCustomers = []; // {npcId, x, y} from server NpcState taxi_customer
  var onlineTaxi = { taxiMode: false, ride: null, customers: [], invitedBy: null };
  var taxiSprites = {}; // npcId -> Pixi container (taxi customers, both modes)
  var lastFaintSfxAt = 0; // M4: the 'fainted' broadcast + the state patch
  // both fire for one faint — play the sound at most once per 3 s.
  var JOB_LABELS = { unemployed: 'Chưa có', shipper: 'Shipper', doctor: 'Bác sĩ', taxi_driver: 'Tài xế' };

  // SFX (M3 skills revision, audio-gen tier a): safe wrapper — audio must
  // never crash the game, and sounds only play for events involving me.
  function sfx(name) {
    try { if (typeof DTA_SFX !== 'undefined' && DTA_SFX[name]) DTA_SFX[name](); } catch (e) { /* ignore */ }
  }

  // M4: faint sound, throttled — the server 'fainted' broadcast and the
  // state patch both fire for one faint; play at most once per 3 s.
  function playFaintSfx() {
    var now = Date.now();
    if (now - lastFaintSfxAt < 3000) return;
    lastFaintSfxAt = now;
    sfx('faint');
  }

  // VFX (rename+VFX, Godot-VFX principles adapted to Pixi): safe wrapper —
  // visuals must never crash the game. Same call sites as sfx() above, so
  // sight + sound fire together for the same event.
  function vfx(name, a, b, c) {
    try { if (typeof DTA_VFX !== 'undefined' && DTA_VFX[name]) DTA_VFX[name](a, b, c); } catch (e) { /* ignore */ }
  }

  // M2: random walkers use full-body persona sprites (cycling the 6 NPC
  // looks) instead of the M0 code-drawn person — no more SVG-looking NPCs.
  // Map v2: v3 taxiFull is Chú Ba STANDING with a helmet (verified by
  // viewing the sprite), so it is no longer a "man on a motorbike" — but
  // it stays reserved for the parked Guide and bot Chú Ba, and the walker
  // list must stay index-aligned with the persona list or a walker talks
  // in the wrong voice (e.g. bread sprite speaking as Chú Ba). Walkers
  // therefore cycle only the 5 on-foot personas.
  var WALKER_FULL = ['shipperFull', 'breadFull', 'policeFull', 'thugFull', 'studentFull'];
  var WALKER_PERSONAS = ['tung', 'lan', 'cong', 'ty', 'mai'];
  var NPC_NAMES = ['An', 'Bình', 'Chi', 'Dũng', 'Hà', 'Khánh', 'Linh', 'Minh', 'Ngọc', 'Phúc', 'Thu', 'Tuấn'];
  var NPC_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xfd79a8, 0x00b894, 0x6c5ce7, 0xd63031, 0x0984e3, 0xe17055];
  var TALK_LINES = [
    'Chào bạn! Thành phố hôm nay đông vui lắm.',
    'Đi làm Shipper kiếm tiền nhanh lắm, thử đi.',
    'Đói thì ghé Cửa Hàng Tiện Lợi mua bánh mì nhé.',
    'Ban đêm đi xe ôm được thêm phụ cấp 30% đó.',
    'Muốn mua xe máy thì qua Showroom ở phía Tây Nam.',
    'Ngân hàng ở phía Tây Bắc, nhớ gửi tiền cho an toàn.'
  ];

  function text(str, size, fill, bold) {
    return new PIXI.Text({
      text: str,
      style: {
        fontFamily: 'Arial, sans-serif', fontSize: size || 14,
        fill: fill !== undefined ? fill : 0xffffff,
        fontWeight: bold ? 'bold' : 'normal', align: 'center'
      }
    });
  }
  function barLabel(str, x, y, parent, size) {
    var t = text(str, size || 12, 0xffffff, true);
    t.anchor.set(0, 0.5); t.position.set(x, y); parent.addChild(t); return t;
  }

  function makePerson(color, withDir) {
    var c = new PIXI.Container();
    var g = new PIXI.Graphics();
    // shadow
    g.ellipse(0, 14, 14, 6).fill({ color: 0x000000, alpha: 0.25 });
    // body
    g.roundRect(-11, -6, 22, 24, 8).fill(color);
    g.roundRect(-11, -6, 22, 24, 8).stroke({ width: 2, color: 0x000000, alpha: 0.25 });
    // head
    g.circle(0, -16, 10).fill(0xffd9b3);
    g.circle(0, -16, 10).stroke({ width: 2, color: 0x000000, alpha: 0.2 });
    // eyes
    g.circle(-3.5, -17, 1.4).fill(0x222222);
    g.circle(3.5, -17, 1.4).fill(0x222222);
    if (withDir) {
      g.moveTo(0, -30); g.lineTo(-5, -38); g.lineTo(5, -38); g.closePath().fill(0xffffff);
    }
    c.addChild(g);
    return c;
  }

  // M2 full-body character (REPLACES the M1 circular badge — user complaint:
  // "người chơi sao lại là avatar hình tròn?"). A transparent full-body
  // sprite (head + body + legs) standing on the map with a soft shadow
  // ellipse under the feet + name label above. The inner `face` container
  // holds the sprite only (flips for direction, bobs while walking) — the
  // shadow and the name label never mirror. Falls back to the M0 code-drawn
  // person when no texture is available. Map v2: v3 figures are high-angle
  // overhead (MAP_V3_DESIGN.md §6) — 40 world px tall, so at mobile zoom
  // 1.6x they render ~64px on a 390px portrait screen.
  var CHAR_H = 40;
  function makeFullBody(tex, nameText) {
    var c = new PIXI.Container();
    var face = new PIXI.Container();
    var shadow = new PIXI.Graphics();
    shadow.ellipse(0, 18, 13, 5).fill({ color: 0x000000, alpha: 0.25 });
    c.addChild(shadow);
    if (tex) {
      var spr = new PIXI.Sprite(tex);
      spr.anchor.set(0.5, 0.5);
      spr.height = CHAR_H;
      spr.width = CHAR_H * tex.width / tex.height;
      spr.position.set(0, -3);
      face.addChild(spr);
    } else {
      // fallback: M0 code-drawn person (same shapes as makePerson)
      var g = new PIXI.Graphics();
      g.roundRect(-11, -6, 22, 24, 8).fill(0x2980b9);
      g.roundRect(-11, -6, 22, 24, 8).stroke({ width: 2, color: 0x000000, alpha: 0.25 });
      g.circle(0, -16, 10).fill(0xffd9b3);
      g.circle(0, -16, 10).stroke({ width: 2, color: 0x000000, alpha: 0.2 });
      g.circle(-3.5, -17, 1.4).fill(0x222222);
      g.circle(3.5, -17, 1.4).fill(0x222222);
      face.addChild(g);
    }
    c.addChild(face);
    c.userData = c.userData || {};
    c.userData.face = face;
    if (nameText) {
      var label = text(nameText, 12, 0xffffff, true);
      label.anchor.set(0.5, 0.5);
      label.position.set(0, -32);
      label.style.stroke = { color: 0x000000, width: 3 };
      c.addChild(label);
      c.userData.label = label;
    }
    return c;
  }

  function avatarTexFor(avatarKey) {
    var k = AVATAR_TEX[avatarKey] || 'hero';
    return TEX[k] || null;
  }
  // Map v2 prop helper: a transparent v3 *-full.png at a world size.
  // `w` = width in world px; height follows the texture aspect. Returns
  // null (caller draws nothing) when the texture failed to load.
  function propSprite(texKey, x, y, w) {
    var tex = TEX[texKey];
    if (!tex) return null;
    var spr = new PIXI.Sprite(tex);
    spr.anchor.set(0.5, 0.5);
    spr.width = w;
    spr.height = w * tex.height / tex.width;
    spr.position.set(x, y);
    if (world) world.addChild(spr);
    cullables.push({ obj: spr, x: x - w / 2, y: y - spr.height / 2, w: w, h: spr.height });
    return spr;
  }
  // Bush spots inside the two flower gardens (Map v2 §4: A x3, B x2).
  function gdBushSpots() {
    return [{ x: 590, y: 3200 }, { x: 890, y: 3350 }, { x: 740, y: 3300 },
            { x: 3010, y: 750 }, { x: 3310, y: 900 }];
  }
  // Map v2 §7: one wandering animal (dog/cat). Visual only — no NPC id, no
  // radial menu, no chat. Sprite drawn by width (dog 30px, cat 22px).
  function spawnAnimal(kind, x, y, speed, w) {
    var tex = TEX[kind];
    if (!tex) return;
    var spr = new PIXI.Sprite(tex);
    spr.anchor.set(0.5, 0.5);
    spr.width = w;
    spr.height = w * tex.height / tex.width;
    spr.position.set(x, y);
    world.addChild(spr);
    var tgt = animalTarget({ x: x, y: y });
    // DOG-STREAK FIX (2026-11-25): PixiJS derives a Sprite's rendered
    // width from scale.x (width = |scale.x| * texture.width) — and setting
    // .width only sets scale.x = w / texture.width ONCE. The old flip code
    // below did `container.scale.x = -1`, which reset the dog's rendered
    // width to the full texture width (301px) while the height stayed ~36px:
    // a flat tan smear with the magenta shadow fringe along its bottom edge
    // (exactly the user's 05:52 + 08:22 screenshots, ~80% of a 390px screen
    // at zoom 1.0x). Keep the base scale and flip by SIGN only, so the
    // rendered size never changes. Same rule for every width-sized sprite.
    var a = { kind: kind, container: spr, baseScaleX: spr.scale.x, x: x, y: y, targetX: tgt.x, targetY: tgt.y, speed: speed, pauseUntil: 0 };
    spr.userData = a; // lets updateCulling follow the animal (same as NPCs)
    animals.push(a);
    cullables.push({ obj: spr, x: x - 20, y: y - 20, w: 40, h: 40 });
  }
  // Animals wander locally (client-side only — the server never sees them).
  // Same pattern as the offline NPC walk: pick a new open target on arrival
  // or when blocked, pause 3-8 s, flip by horizontal movement.
  // Điểm đích gần đó mà đường thẳng tới nó không cắt lòng đường / vật cản.
  function animalTarget(a) {
    for (var i = 0; i < 30; i++) {
      var x = a.x + (Math.random() - 0.5) * 440, y = a.y + (Math.random() - 0.5) * 440;
      if (!isOpenPoint(x, y)) continue;
      var clear = true;
      for (var t = 1; t <= 20; t++) {
        var px = a.x + (x - a.x) * t / 20, py = a.y + (y - a.y) * t / 20;
        if (inRoad(px, py) || blocked(px, py, 10)) { clear = false; break; }
      }
      if (clear) return { x: x, y: y };
    }
    return { x: a.x, y: a.y };
  }
  function updateAnimals(dt) {
    var now = Date.now();
    animals.forEach(function (a) {
      if (now < a.pauseUntil) return;
      var dx = a.targetX - a.x, dy = a.targetY - a.y;
      var d = Math.hypot(dx, dy);
      if (d < 10) {
        a.pauseUntil = now + 3000 + Math.random() * 5000;
        var p = animalTarget(a);
        a.targetX = p.x; a.targetY = p.y;
        return;
      }
      var nx = a.x + dx / d * a.speed * dt, ny = a.y + dy / d * a.speed * dt;
      if (blocked(nx, a.y, 10) || blocked(a.x, ny, 10)) {
        var p2 = animalTarget(a);
        a.targetX = p2.x; a.targetY = p2.y;
        return;
      }
      a.x = nx; a.y = ny;
      a.container.position.set(a.x, a.y);
      a.container.zIndex = a.y; // y-sorted with the player (traffic)
      // Flip by sign of the BASE scale (see spawnAnimal): scale.x = -1
      // would blow the sprite up to its full texture width (dog streak).
      if (dx < -0.1) a.container.scale.x = -Math.abs(a.baseScaleX);
      else if (dx > 0.1) a.container.scale.x = Math.abs(a.baseScaleX);
    });
  }
  // ---------- Traffic: mô phỏng nằm ở shared/roadnet.js, đây chỉ vẽ sprite.
  // Ảnh ô tô có đầu xe quay sang TRÁI, ảnh xe máy có đầu xe quay LÊN.
  var TRAFFIC_COUNT = 20;
  var HEADING_FIX = { car: Math.PI, motorbike: Math.PI / 2 };
  function spawnTraffic() {
    if (!world) return;
    RoadNet.createTraffic(TRAFFIC_COUNT).forEach(function (v) {
      var tex = TEX[v.kind];
      if (!tex) return;
      var spr = new PIXI.Sprite(tex);
      spr.anchor.set(0.5, 0.5);
      // chiều dài xe = v.len; giữ nguyên tỉ lệ ảnh
      var k = v.len / (v.kind === 'car' ? tex.width : tex.height);
      spr.width = tex.width * k; spr.height = tex.height * k;
      world.addChild(spr);
      v.spr = spr;
      spr.userData = v; // lets updateCulling follow the vehicle (same as NPCs)
      traffic.push(v);
      cullables.push({ obj: spr, x: v.x - 55, y: v.y - 55, w: 110, h: 110 });
    });
    updateTraffic(0);
  }
  function trafficObstacles() {
    var list = [];
    if (!playerState.isFainted) list.push(playerState);
    npcs.forEach(function (n) { list.push(n); });
    Object.keys(remotePlayers).forEach(function (id) {
      list.push({ x: remotePlayers[id].rx, y: remotePlayers[id].ry });
    });
    return list;
  }
  function updateTraffic(dt) {
    RoadNet.stepTraffic(traffic, dt, signalNow(), trafficObstacles());
    for (var i = 0; i < traffic.length; i++) {
      var v = traffic[i];
      v.spr.position.set(v.x, v.y);
      v.spr.rotation = v.heading + HEADING_FIX[v.kind];
      v.spr.zIndex = v.y; // y-sorted with the player
    }
  }
  var serverClockOffset = 0;
  function signalNow() { return Date.now() + (netMode === 'online' ? serverClockOffset : 0); }
  // Full-body texture for the in-world character (transparent *-full.png).
  function fullTexFor(avatarKey) {
    var k = FULL_TEX[avatarKey] || 'heroFull';
    return TEX[k] || null;
  }
  function avatarColorFor(avatarKey) {
    return AVATAR_COLOR[avatarKey] !== undefined ? AVATAR_COLOR[avatarKey] : 0x2980b9;
  }

  // Aspect-preserving contain-fit (render fix 2026-11-25): fit a texture
  // of (tw x th) inside rect (x,y,w,h), centred. NEVER stretch a sprite
  // into a collider rect — a 1024x1024 FLUX scene stretched into a
  // 480x360 rect painted fake streets / brown asphalt inside the block.
  function fitRect(tw, th, x, y, w, h) {
    var s = Math.min(w / tw, h / th);
    var fw = tw * s, fh = th * s;
    return { x: x + (w - fw) / 2, y: y + (h - fh) / 2, w: fw, h: fh };
  }

  function buildWorld() {
    world = new PIXI.Container();
    // TRAFFIC (2026-11-25): y-sort the moving things (player, NPCs,
    // animals, traffic, remote players) by their y so a car south of the
    // player draws above them and one north draws below. Static props keep
    // zIndex 0 (below all movers, as today — the player was already drawn
    // above buildings). UI world children (arrow, radial, bubble, hint,
    // guide label) and the VFX layer are pinned to 99999/100000.
    world.sortableChildren = true;
    app.stage.addChild(world);

    // ground: grass
    var ground = new PIXI.Graphics();
    ground.rect(0, 0, MAP_W, MAP_H).fill(0x5da24a);
    // grass patches (deterministic)
    for (var i = 0; i < 500; i++) {
      var gx = randRange(0, MAP_W), gy = randRange(0, MAP_H);
      if (RoadNet.inRoad(gx, gy) || RoadNet.inSidewalk(gx, gy)) continue;
      ground.circle(gx, gy, randRange(6, 18)).fill({ color: 0x4c8a3d, alpha: 0.5 });
    }
    ground.eventMode = 'static';
    ground.on('pointerdown', onWorldPointerDown);
    world.addChild(ground);

    // Map v2 §4: flower-garden beds — drawn BEFORE the roads (2026-11-25
    // render fix): Garden A overlaps the vertical road band [1140,1320]
    // by 60px and the horizontal band [2340,2520] by 120px, Garden B the
    // vertical band [3540,3720] by 60px. Beds were drawn AFTER the roads,
    // so they covered road segments and broke the road continuity.
    var gardens = (typeof Colliders !== 'undefined' && Colliders.GARDENS) ? Colliders.GARDENS : [];
    gardens.forEach(function (gd) {
      var bed = new PIXI.Graphics();
      bed.rect(gd.x, gd.y, gd.w, gd.h).fill(0x7fbf5a);
      world.addChild(bed);
      cullables.push({ obj: bed, x: gd.x, y: gd.y, w: gd.w, h: gd.h });
    });

    // Đường, vỉa hè, vạch kẻ, quảng trường, đèn tín hiệu: src/roadrender.js
    RoadRender.drawRoads(world);
    RoadRender.drawPlaza(world);

    // TEST: Đặt thử nghiệm 1 đoạn vỉa hè 2.5D Pixel Art mới tại Quảng trường (gần điểm spawn 2430, 2650)
    (function () {
      if (TEX.sampleSidewalk) {
        var sw = new PIXI.Sprite(TEX.sampleSidewalk);
        sw.anchor.set(0.5, 0.5);
        sw.position.set(2430, 2690);
        sw.width = 180;
        sw.height = 70;
        sw.zIndex = 0;
        world.addChild(sw);
      }
      if (TEX.samplePowerBox) {
        var pbox = new PIXI.Sprite(TEX.samplePowerBox);
        pbox.anchor.set(0.5, 1.0);
        pbox.position.set(2360, 2690);
        pbox.width = 32;
        pbox.height = 42;
        pbox.zIndex = 2690;
        world.addChild(pbox);
      }
      if (TEX.sampleStools) {
        var stools = new PIXI.Sprite(TEX.sampleStools);
        stools.anchor.set(0.5, 1.0);
        stools.position.set(2430, 2690);
        stools.width = 38;
        stools.height = 36;
        stools.zIndex = 2690;
        world.addChild(stools);
      }
      if (TEX.sampleTreeBox) {
        var tb = new PIXI.Sprite(TEX.sampleTreeBox);
        tb.anchor.set(0.5, 1.0);
        tb.position.set(2500, 2690);
        tb.width = 54;
        tb.height = 75;
        tb.zIndex = 2690;
        world.addChild(tb);
      }
    })();
    var plazaLabel = text('Quảng Trường Trung Tâm', 22, 0x5d4037, true);
    plazaLabel.style.stroke = { color: 0xffffff, width: 4 };
    plazaLabel.anchor.set(0.5, 0.5); plazaLabel.position.set(2430, 2145);
    world.addChild(plazaLabel);
    cullables.push({ obj: plazaLabel, x: 2100, y: 2100, w: 660, h: 60 });
    signalLayer = RoadRender.createSignals(world);

    // Map v2 §4: flower gardens — beds are drawn BEFORE the roads above
    // (render fix 2026-11-25); only bushes + benches are drawn here
    // (decorative only, no collision).
    // bushes: Garden A x3, Garden B x2 (design §4)
    var bushSpots = gdBushSpots();
    bushSpots.forEach(function (s) {
      propSprite('bushFlower', s.x, s.y, 56);
    });
    // benches: plaza x4 + gardens (A x2, B x1)
    var benchSpots = [[2160, 2330], [2700, 2330], [2160, 2540], [2700, 2540], [540, 3400], [940, 3130], [3060, 950]];
    benchSpots.forEach(function (s) {
      propSprite('bench', s[0], s[1], 56);
    });

    // buildings (Map v2): the M0 coloured rect stays as flat backing; the
    // v3 sprite is drawn over it, CONTAIN-FIT centred inside the collider
    // rect (fitRect — render fix 2026-11-25). The old code stretched every
    // sprite to exactly (b.w x b.h): roof crops are e.g. 705x210 stretched
    // to 480x360 (1.71x vertical) and full 1024x1024 scenes painted fake
    // streets + brown asphalt inside their blocks. Roof strip / door /
    // windows are fallback detail ONLY when there is no texture — with a
    // texture they would poke out around the contain-fit sprite.
    BUILDINGS.forEach(function (b) {
      var c = new PIXI.Container();
      var g = new PIXI.Graphics();
      g.rect(b.x, b.y, b.w, b.h).fill(b.color);
      g.rect(b.x, b.y, b.w, b.h).stroke({ width: 3, color: 0x000000, alpha: 0.3 });
      var bTexKey = POI_TEX[b.id] || HOUSE_TEX[b.id];
      var bTex = (bTexKey && TEX[bTexKey]) || null;
      if (!bTex) {
        // fallback detail when no texture
        g.rect(b.x, b.y, b.w, 26).fill(b.roof);
        g.rect(b.x + b.w / 2 - 16, b.y + b.h - 34, 32, 34).fill(0x5d4037);
        for (var wx = b.x + 22; wx < b.x + b.w - 30; wx += 52) {
          g.rect(wx, b.y + 44, 28, 26).fill(0xbfe3ff);
        }
      }
      c.addChild(g);
      if (bTex) {
        var fit = fitRect(bTex.width, bTex.height, b.x, b.y, b.w, b.h);
        var bspr = new PIXI.Sprite(bTex);
        bspr.width = fit.w; bspr.height = fit.h;
        bspr.position.set(fit.x, fit.y);
        c.addChild(bspr);
      }
      var label = text(b.name, 20, 0xffffff, true);
      label.anchor.set(0.5, 0.5);
      label.position.set(b.x + b.w / 2, b.y + b.h / 2 + 12);
      // dark backing behind label so it stays readable
      var back = new PIXI.Graphics();
      back.roundRect(b.x + 8, b.y + b.h / 2 - 2, b.w - 16, 30, 6).fill({ color: 0x000000, alpha: 0.45 });
      c.addChild(back, label);
      c.eventMode = 'static';
      c.on('pointerdown', onWorldPointerDown);
      world.addChild(c);
      cullables.push({ obj: c, x: b.x, y: b.y, w: b.w, h: b.h });
    });

    // Map v2 §4: fences — segment sprites tiled along each blocking rect
    // (horizontal runs as-is, vertical runs rotated 90°), corner sprites
    // where two runs meet. The corner GAPS have no fence rects, so nothing
    // is drawn over them: the shortcuts stay open.
    var fences = (typeof Colliders !== 'undefined' && Colliders.FENCES) ? Colliders.FENCES : [];
    fences.forEach(function (f) {
      if (f.w >= f.h) {
        var nH = Math.max(1, Math.ceil(f.w / 55));
        for (var i = 0; i < nH; i++) {
          var s = propSprite('fenceSeg', f.x + i * 55 + 27, f.y + f.h / 2, 55);
          if (s) s.height = 20;
        }
      } else {
        var nV = Math.max(1, Math.ceil(f.h / 55));
        for (var j = 0; j < nV; j++) {
          var tex = TEX.fenceSeg;
          if (!tex) break;
          var sv = new PIXI.Sprite(tex);
          sv.anchor.set(0.5, 0.5);
          sv.width = 55; sv.height = 20;
          sv.rotation = Math.PI / 2;
          sv.position.set(f.x + f.w / 2, f.y + j * 55 + 27);
          world.addChild(sv);
          cullables.push({ obj: sv, x: f.x - 10, y: f.y + j * 55, w: 32, h: 55 });
        }
      }
    });
    // fence corners where two runs meet (the other two corners of each
    // garden are the open gaps — no corner sprite there).
    [[1040, 3050], [440, 3470], [2860, 600], [3460, 1020]].forEach(function (pt) {
      propSprite('fenceCorner', pt[0], pt[1], 56);
    });

    // POI markers (coloured dot + pin at building front / spawn)
    POIS.forEach(function (p) {
      var m = new PIXI.Graphics();
      m.circle(p.x, p.y, 12).fill(p.color);
      m.circle(p.x, p.y, 12).stroke({ width: 3, color: 0xffffff });
      m.circle(p.x, p.y, 4).fill(0xffffff);
      world.addChild(m);
      cullables.push({ obj: m, x: p.x - 14, y: p.y - 14, w: 28, h: 28 });
    });

    // trees (Map v2 §5): v3 tree sprites scattered on grass blocks,
    // never on roads/sidewalks/plaza. Decorative only (no collision),
    // same as the M0 code-drawn trees — the design leaves that choice to
    // code, and blocking trees would need a shared tree list.
    var treeSpots = RoadRender.treeSpots(60, rand);
    for (var t = 0; t < treeSpots.length; t++) {
      var tp = treeSpots[t];
      var tree = propSprite(t % 2 === 0 ? 'treeA' : 'treeB', tp.x, tp.y, randRange(56, 90));
      if (!tree) {
        var tf = new PIXI.Graphics();
        tf.rect(-3, 0, 6, 14).fill(0x6e4b2a);
        tf.circle(0, -10, 16).fill(0x2e7d32);
        tf.circle(-8, -4, 10).fill(0x388e3c);
        tf.circle(8, -4, 10).fill(0x388e3c);
        tf.position.set(tp.x, tp.y);
        world.addChild(tf);
        cullables.push({ obj: tf, x: tp.x - 18, y: tp.y - 28, w: 36, h: 46 });
      }
    }

    // lamps along roads (glow at night) — v3 lamp sprite at road
    // intersections; the glow Graphics feed DTA_VFX.init() in boot().
    RoadRender.lampSpots().forEach(function (s) {
      var lampX = s.x, lampY = s.y;
      var lamp = propSprite('lamp', lampX, lampY - 18, 18);
      if (!lamp) {
        lamp = new PIXI.Graphics();
        lamp.rect(-2, -22, 4, 22).fill(0x333333);
        lamp.circle(0, -24, 6).fill(0xffe082);
        world.addChild(lamp);
        lamp.position.set(lampX, lampY);
        cullables.push({ obj: lamp, x: lampX - 20, y: lampY - 50, w: 40, h: 50 });
      }
      var glow = new PIXI.Graphics();
      glow.circle(0, 0, 34).fill({ color: 0xffe082, alpha: 0.18 });
      glow.position.set(lampX, lampY - 30);
      glow.visible = false;
      world.addChild(glow);
      lampGlows.push(glow);
      cullables.push({ obj: glow, x: lampX - 40, y: lampY - 70, w: 80, h: 80 });
    });

    // parked vehicles (Map v2 §5, decorative): 5 motorbikes in a row at the
    // showroom, cars at the hospital bay, police car park and motel car park.
    [3140, 3200, 3260].forEach(function (by) {
      propSprite('motorbike', 1960, by, 30);
    });
    // VEHICLES FIX (2026-11-25): the OWNED parked vehicles — one labelled
    // container per type (sprite + green ring + "Xe … của bạn" label), shown
    // by syncParkedVehicles() at the parked spot from the vehicle state.
    // Before this fix nothing was drawn there: the player was told "xe đang
    // đỗ ở Showroom" but saw only the 5 decorative bikes, none of them
    // theirs, and mounting (80px range) felt like it did nothing.
    ['bicycle', 'motorbike'].forEach(function (id) {
      var c = new PIXI.Container();
      var tex = TEX[id] || null;
      var spr = null;
      if (tex) {
        spr = new PIXI.Sprite(tex);
        spr.anchor.set(0.5, 0.5);
        if (id === 'bicycle') { spr.width = 56; spr.height = 56 * tex.height / tex.width; }
        else { spr.width = 34; spr.height = 34 * tex.height / tex.width; }
        c.addChild(spr);
      }
      var ring = new PIXI.Graphics();
      ring.ellipse(0, 10, 32, 15).stroke({ width: 3, color: 0x2ecc71 });
      c.addChild(ring);
      var lbl = text(id === 'motorbike' ? 'Xe máy của bạn' : 'Xe đạp của bạn', 12, 0xffffff, true);
      lbl.anchor.set(0.5, 0.5);
      lbl.position.set(0, -42);
      lbl.style.stroke = { color: 0x000000, width: 4 };
      c.addChild(lbl);
      c.visible = false;
      world.addChild(c);
      parkedVehicleNodes[id] = { c: c, spr: spr };
    });
    propSprite('car', 4000, 1920, 90);
    propSprite('car', 3900, 1010, 90);
    propSprite('car', 2750, 3300, 90);
    // delivery boxes + bins (decorative): boxes at the warehouse dock,
    // bins near the shop, market, plaza and gardens.
    propSprite('box', 3900, 3200, 40);
    propSprite('box', 3980, 3200, 40);
    [[3250, 1770], [4100, 3815], [2700, 2260], [900, 3000], [3250, 560]].forEach(function (bp) {
      propSprite('bin', bp[0], bp[1], 30);
    });

    // NPCs (M2: full-body persona sprites, not code-drawn persons)
    for (var n = 0; n < 10; n++) {
      var walker = RoadNet.createWalker(Math.floor(Math.random() * RoadNet.PED.length), { speed: 90 });
      var sp = { x: walker.x, y: walker.y };
      var npc = makeFullBody(TEX[WALKER_FULL[n % WALKER_FULL.length]], null);
      npc.position.set(sp.x, sp.y);
      npc.eventMode = 'static';
      npc.cursor = 'pointer';
      npc.on('pointerdown', onWorldPointerDown);
      // M3 (§10.2): server id 'npc-walker-i' + a BotBrain persona (cycles
      // the 5 on-foot personas, index-aligned with WALKER_FULL) so
      // "Nói chuyện" gets a persona line in the matching voice, online & offline.
      var personaId = WALKER_PERSONAS[n % WALKER_PERSONAS.length];
      // Keep the inner face container: npc.userData is replaced by obj
      // below, so makeFullBody's userData.face would be lost — and the
      // flip code needs the face (never the width-sized sprite itself).
      var npcFace = (npc.userData && npc.userData.face) || npc;
      var obj = {
        id: 'npc-walker-' + n, personaId: personaId, lastTalkLine: null,
        container: npc, face: npcFace, x: sp.x, y: sp.y, walker: walker,
        speed: 90, name: NPC_NAMES[n % NPC_NAMES.length],
        color: NPC_COLORS[n % NPC_COLORS.length], isTutorial: false
      };
      npc.userData = obj;
      world.addChild(npc);
      npcs.push(obj);
      cullables.push({ obj: npc, x: sp.x - 20, y: sp.y - 30, w: 40, h: 60 });
    }

    // Map v2 §7: dogs + cats — visual-only wanderers (no gameplay yet, no
    // talk/radial: they are NOT in npcs[]). Sidewalks/grass only, never on
    // roads; dogs ~60 px/s, cats ~40 px/s, pause 3-8 s like walkers.
    var animalSpawns = (typeof Colliders !== 'undefined' && Colliders.ANIMALS) ? Colliders.ANIMALS : { dogs: [], cats: [] };
    animalSpawns.dogs.forEach(function (s) { spawnAnimal('dog', s.x, s.y, 60, 30); });
    animalSpawns.cats.forEach(function (s) { spawnAnimal('cat', s.x, s.y, 40, 22); });
    // Traffic (2026-11-25): ambient cars + motorbikes on the road bands.
    spawnTraffic();

    // tutorial NPC (fixed at spawn) — Map v2: v3 taxiFull is Chú Ba STANDING
    // holding a helmet (verified by viewing the sprite), so the Guide reads
    // as a friendly driver, not a man sitting on a motorbike (the v2 look).
    tutorialNpc = makeFullBody(TEX.taxiFull, null);
    tutorialNpc.position.set(2430, 2545);
    tutorialNpc.eventMode = 'static';
    tutorialNpc.cursor = 'pointer';
    tutorialNpc.on('pointerdown', onWorldPointerDown);
    var tutObj = {
      id: 'npc-guide', personaId: null, lastTalkLine: null,
      container: tutorialNpc, x: 2430, y: 2545, targetX: 2430, targetY: 2545,
      speed: 0, name: 'NPC Hướng Dẫn', color: 0x27ae60, isTutorial: true
    };
    tutorialNpc.userData = tutObj;
    tutorialNpc.zIndex = 2545; // static guide: y-sorted like the movers
    world.addChild(tutorialNpc);
    npcs.push(tutObj);
    cullables.push({ obj: tutorialNpc, x: 2410, y: 2515, w: 40, h: 60 });
    var tutLabel = text('NPC Hướng Dẫn', 18, 0xffff00, true);
    tutLabel.anchor.set(0.5, 0.5); tutLabel.position.set(2430, 2503);
    tutLabel.zIndex = 99999; // UI label: always above movers
    world.addChild(tutLabel);
    cullables.push({ obj: tutLabel, x: 2330, y: 2485, w: 200, h: 36 });

    // player (M2: full-body hero sprite + shadow; M0 code-drawn person as fallback)
    player = makeFullBody(TEX.heroFull, playerState.name);
    player.position.set(playerState.x, playerState.y);
    player.zIndex = playerState.y; // y-sorted with traffic / NPCs / animals
    world.addChild(player);
    playerGfx = player;
    // VEHICLES FIX (2026-11-25): the ridden vehicle sprite, a child of the
    // player container at index 1 (behind the face, above the shadow) so it
    // follows the player + camera. syncRideSprite() sets its texture/size.
    rideSpr = new PIXI.Sprite(PIXI.Texture.EMPTY);
    rideSpr.anchor.set(0.5, 0.5);
    rideSpr.position.set(0, 8);
    rideSpr.visible = false;
    player.addChildAt(rideSpr, 1);

    // M3 (§6.2): delivery arrow — a world-space line + triangle from the
    // player toward the active order's target, redrawn every frame.
    orderArrow = new PIXI.Graphics();
    orderArrow.zIndex = 99999; // UI: always above movers
    orderArrow.visible = false;
    world.addChild(orderArrow);

    // radial menu + speech bubble (world-space, hidden by default)
    buildRadialMenu();
    buildBubble();
  }

  function buildRadialMenu() {
    radialMenu = new PIXI.Container();
    radialMenu.visible = false;
    radialMenu.zIndex = 99999; // UI: always above movers
    world.addChild(radialMenu);
    var defs = [
      { label: 'Nói chuyện', action: 'talk' },
      { label: 'Thông tin', action: 'info' },
      { label: 'Cấp cứu', action: 'revive' },
      { label: 'Đóng', action: 'close' }
    ];
    var angles = [-90, 0, 90, 180];
    defs.forEach(function (d, i) {
      var a = angles[i] * Math.PI / 180;
      var btn = new PIXI.Container();
      btn.position.set(Math.cos(a) * 78, Math.sin(a) * 78);
      var g = new PIXI.Graphics();
      var col = d.action === 'close' ? 0x7f8c8d : (d.action === 'revive' ? 0xe74c3c : 0x2980b9);
      g.circle(0, 0, 32).fill(col);
      g.circle(0, 0, 32).stroke({ width: 3, color: 0xffffff });
      btn.addChild(g);
      var t = text(d.label, 10, 0xffffff, true);
      t.anchor.set(0.5, 0.5);
      btn.addChild(t);
      btn.eventMode = 'static';
      btn.cursor = 'pointer';
      btn._radialAction = d.action; // changed by openRadial (revive <-> report)
      btn.on('pointerdown', function (e) { e.stopPropagation(); onRadialAction(btn._radialAction); });
      radialMenu.addChild(btn);
      radialButtons.push({ btn: btn, gfx: g, label: t, action: d.action, baseColor: col });
    });
    var hub = new PIXI.Graphics();
    hub.circle(0, 0, 20).fill({ color: 0x000000, alpha: 0.55 });
    hub.circle(0, 0, 20).stroke({ width: 2, color: 0xffffff });
    radialMenu.addChild(hub);
    // TAP-TO-TALK (2026-11-25): floating "💬" above the nearest in-range
    // NPC/player — world-space so it follows the camera. eventMode 'none'
    // so it never eats the tap it advertises.
    talkHint = text('💬', 26, 0xffffff, true);
    talkHint.anchor.set(0.5, 0.5);
    talkHint.style.stroke = { color: 0x000000, width: 5 };
    talkHint.eventMode = 'none';
    talkHint.visible = false;
    talkHint.zIndex = 99999; // UI: always above movers
    world.addChild(talkHint);
  }

  function buildBubble() {
    bubble = new PIXI.Container();
    bubble.visible = false;
    bubble.zIndex = 99999; // UI: always above movers
    var bg = new PIXI.Graphics();
    // M2: smaller bubble (200x48, was 260x56) — at zoom 1.6x the old bubble
    // was 416px wide on a 390px screen and overflowed the frame.
    bg.roundRect(-100, -66, 200, 48, 12).fill(0xffffff);
    bg.roundRect(-100, -66, 200, 48, 12).stroke({ width: 2, color: 0x333333 });
    bg.moveTo(-10, -18); bg.lineTo(10, -18); bg.lineTo(0, -6); bg.closePath().fill(0xffffff);
    bubble.addChild(bg);
    bubbleText = text('', 15, 0x222222, false);
    bubbleText.anchor.set(0.5, 0.5);
    bubbleText.position.set(0, -42);
    bubble.addChild(bubbleText);
    world.addChild(bubble);
  }

  function showBubble(x, y, str, ms) {
    bubbleText.text = str;
    // wrap: split long lines manually (Pixi Text wordWrap)
    bubbleText.style.wordWrap = true;
    bubbleText.style.wordWrapWidth = 180;
    bubble.position.set(x, y);
    bubble.visible = true;
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () { bubble.visible = false; }, ms || 3000);
  }

  // M1: relabel/recolour one radial button (index 2 swaps Cấp cứu <-> Báo cáo)
  function setRadialButton(idx, label, action, color, enabled) {
    var b = radialButtons[idx];
    if (!b) return;
    b.action = action;
    b.label.text = label;
    b.btn._radialAction = action;
    b.btn.alpha = enabled ? 1 : 0.45;
    b.gfx.clear();
    b.gfx.circle(0, 0, 32).fill(color);
    b.gfx.circle(0, 0, 32).stroke({ width: 3, color: 0xffffff });
  }

  // VEHICLES FIX (2026-11-25): which vehicle (if any) the player is
  // riding right now. Online it is the server-synced playerState.vehicleId;
  // offline applyToState() never syncs it, so read Economy.getRiding().
  function currentRidingId() {
    if (playerState.vehicleId) return playerState.vehicleId;
    if (netMode !== 'online' && typeof Economy !== 'undefined' && Economy.getRiding) {
      return Economy.getRiding() || '';
    }
    return '';
  }
  // Owned-vehicle state for the world (parked positions included — the
  // server status message carries x/y, and so does Economy.getVehicleState).
  function vehicleStateForWorld() {
    if (netMode === 'online') return onlineVehicles;
    if (typeof Economy !== 'undefined' && Economy.getVehicleState) return Economy.getVehicleState();
    return { riding: '', bicycle: { owned: false }, motorbike: { owned: false } };
  }
  // Tap targets for the owned parked vehicles (nearestTarget includes them,
  // so tapping your parked bike opens the radial with "Lên xe").
  function parkedVehicleTargets() {
    var vs = vehicleStateForWorld();
    var out = [];
    ['bicycle', 'motorbike'].forEach(function (id) {
      var v = vs[id];
      if (v && v.owned && vs.riding !== id && typeof v.x === 'number' && typeof v.y === 'number') {
        out.push({ kind: 'vehicle', vehicleId: id, name: id === 'motorbike' ? 'Xe máy của bạn' : 'Xe đạp của bạn', x: v.x, y: v.y, npc: null });
      }
    });
    return out;
  }
  // Parked owned vehicles: show the sprite + green ring + label at the
  // parked spot, hide while riding (the bike is under the player then) or
  // when not owned. Called once per ticker tick — 2 sprites, cheap.
  function syncParkedVehicles() {
    var vs = vehicleStateForWorld();
    ['bicycle', 'motorbike'].forEach(function (id) {
      var node = parkedVehicleNodes[id];
      if (!node) return;
      var v = vs[id];
      var show = !!(v && v.owned && vs.riding !== id && typeof v.x === 'number' && typeof v.y === 'number');
      node.c.visible = show;
      if (show) node.c.position.set(v.x, v.y);
    });
  }
  // Ridden vehicle under the player: the bike sprite is a child of the
  // player container (index 1, behind the face, above the shadow), so it
  // follows the player and the camera for free. Texture + size follow the
  // ridden type; hidden on foot.
  function syncRideSprite() {
    if (!rideSpr) return;
    var ridingId = currentRidingId();
    if (!ridingId) { rideSpr.visible = false; return; }
    var tex = TEX[ridingId] || null;
    if (!tex) { rideSpr.visible = false; return; }
    if (rideSpr.texture !== tex) rideSpr.texture = tex;
    // Aspect-preserving, sized to read at game scale: bicycle is wide
    // (472x360) -> 56px wide; motorbike is tall (204x360) -> 34px wide,
    // same as the decorative parked motorbikes.
    if (ridingId === 'bicycle') { rideSpr.width = 56; rideSpr.height = 56 * tex.height / tex.width; }
    else { rideSpr.width = 34; rideSpr.height = 34 * tex.height / tex.width; }
    rideSpr.visible = true;
  }
  // Contextual LÊN XE / XUỐNG XE DOM button (#rideBtn, bottom centre).
  // Riding -> "XUỐNG XE". On foot near a parked owned vehicle (within the
  // 80px mount range) -> "LÊN XE". Otherwise hidden — and hidden while the
  // chat or any econ panel is open, so it never covers them.
  function updateRideButton() {
    var b = document.getElementById('rideBtn');
    if (!b) return;
    if (!started || chatOpen || playerState.isFainted) { b.style.display = 'none'; return; }
    if (document.querySelector('.econPanel.open')) { b.style.display = 'none'; return; }
    if (currentRidingId()) {
      b.textContent = 'XUỐNG XE';
      b.style.display = 'block';
      return;
    }
    var near = parkedVehicleTargets().some(function (t) {
      return Math.hypot(t.x - playerState.x, t.y - playerState.y) <= 80;
    });
    if (near) {
      b.textContent = 'LÊN XE';
      b.style.display = 'block';
    } else {
      b.style.display = 'none';
    }
  }

  function nearestTarget(wx, wy) {
    // TAP-TO-TALK (2026-11-25): range is 120px (NPC-talk range, §10.2) for
    // every path — tap, long-press and right-click alike.
    var best = null, bestD = 120;
    npcs.forEach(function (n) {
      var d = Math.hypot(n.x - wx, n.y - wy);
      if (d < bestD) { bestD = d; best = { kind: 'npc', name: n.name, x: n.x, y: n.y, npc: n }; }
    });
    POIS.forEach(function (p) {
      var d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bestD) { bestD = d; best = { kind: 'poi', id: p.id, name: p.name, x: p.x, y: p.y, npc: null }; }
    });
    // M1: remote players (humans + bots, online & offline) are targets too
    Object.keys(remotePlayers).forEach(function (id) {
      var r = remotePlayers[id];
      var d = Math.hypot(r.rx - wx, r.ry - wy);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'player', name: r.name, x: r.rx, y: r.ry, npc: null, id: id, remote: r, isBot: r.isBot, isFainted: r.isFainted, personaId: r.personaId };
      }
    });
    // VEHICLES FIX (2026-11-25): owned parked vehicles are tap targets —
    // tapping your parked bike opens the radial with "Lên xe".
    parkedVehicleTargets().forEach(function (t) {
      var d = Math.hypot(t.x - wx, t.y - wy);
      if (d < bestD) { bestD = d; best = t; }
    });
    return best;
  }

  function openRadial(target) {
    radialTarget = target;
    radialMenu.position.set(target.x, target.y - 10);
    radialMenu.visible = true;
    // M2: button 0 becomes context action for POIs — Cửa hàng at the shop,
    // ATM at the bank (SRS §11 Radial Menu, max 4 buttons).
    // VEHICLES FIX (2026-11-25): tapping your parked vehicle offers "Lên xe".
    if (target.kind === 'vehicle') {
      setRadialButton(0, 'Lên xe', 'mount', 0x27ae60, true);
    } else if (target.kind === 'poi') {
      if (target.id === 'shop' || target.name.indexOf('Cửa Hàng') === 0) {
        setRadialButton(0, 'Cửa hàng', 'shop', 0xe67e22, true);
      } else if (target.id === 'bank' || target.name.indexOf('Ngân Hàng') === 0) {
        setRadialButton(0, 'ATM', 'atm', 0x2980b9, true);
      } else if (target.id === 'showroom' || target.name.indexOf('Showroom') === 0) {
        // M4: Showroom — buy a bicycle / motorbike (shop panel, §8.1).
        setRadialButton(0, 'Showroom', 'showroom', 0x9b59b6, true);
      } else if (target.id === 'motel' || target.name.indexOf('Nhà Trọ') === 0) {
        // M4: Motel — rent a room + chest (§8.2).
        setRadialButton(0, 'Nhà trọ', 'motel', 0x16a085, true);
      } else {
        setRadialButton(0, 'Nói chuyện', 'talk', 0x2980b9, true);
      }
    } else {
      setRadialButton(0, 'Nói chuyện', 'talk', 0x2980b9, true);
    }
    // M1: 4th button is Báo cáo for a (non-fainted) player, Cấp cứu for a
    // fainted player; for NPC/POI it stays Cấp cứu, disabled as in M0.
    if (target.kind === 'player') {
      if (target.isFainted) setRadialButton(2, 'Cấp cứu', 'revive', 0xe74c3c, true);
      else setRadialButton(2, 'Báo cáo', 'report', 0xe67e22, true);
      chatTargetId = target.id; // private chat goes to this player
    } else {
      setRadialButton(2, 'Cấp cứu', 'revive', 0xe74c3c, false);
      chatTargetId = null; // private chat needs a player target
    }
  }
  function closeRadial() { radialMenu.visible = false; radialTarget = null; }

  function onRadialAction(action) {
    if (!radialTarget) { closeRadial(); return; }
    var t = radialTarget;
    if (action === 'close') { closeRadial(); return; }
    // VEHICLES FIX (2026-11-25): mount from the radial — same path as the
    // E key / job panel button (Jobs.mountNearest handles online + offline
    // and the 80px range check; TOO_FAR tells the player where the bike is).
    if (action === 'mount') {
      closeRadial();
      if (typeof Jobs !== 'undefined' && Jobs.mountNearest) Jobs.mountNearest();
      else if (typeof Economy !== 'undefined' && Economy.mountVehicle && t.vehicleId) {
        var res = Economy.mountVehicle(t.vehicleId);
        if (!res.ok) appendChatLog('', '', 'Không lên xe được: ' + (res.error || ''), true);
      }
      sfx('click');
      return;
    }
    // M2: shop / ATM open the DOM panels (Hybrid UI: money input is DOM).
    if (action === 'shop') {
      closeRadial();
      if (typeof window.openShopPanel === 'function') window.openShopPanel();
      return;
    }
    if (action === 'atm') {
      closeRadial();
      if (typeof window.openAtmPanel === 'function') window.openAtmPanel();
      return;
    }
    // M4: Showroom (buy vehicles — the shop panel's vehicle section) and
    // Motel (rent a room + chest). Online the motel panel asks the server
    // for its status first so it shows server state, not the local wallet.
    if (action === 'showroom') {
      closeRadial();
      if (typeof window.openShopPanel === 'function') window.openShopPanel();
      return;
    }
    if (action === 'motel') {
      closeRadial();
      if (netMode === 'online' && typeof NetClient !== 'undefined' && NetClient.sendMotel) {
        NetClient.sendMotel('status', {});
      }
      if (typeof window.openMotelPanel === 'function') window.openMotelPanel();
      return;
    }
    if (action === 'report') {
      // M1: report only logs (no server endpoint yet)
      console.log('[report] player reported', t.id || t.name, 'by', playerState.name);
      showBubble(t.x, t.y, 'Đã gửi báo cáo\n(M1: chỉ ghi log)', 3000);
      return;
    }
    if (action === 'revive') {
      if (t.kind === 'player' && t.isFainted && netMode === 'online' && typeof NetClient !== 'undefined' && NetClient.connected) {
        // M4 (§18.5, PROPOSAL): the doctor plays the rhythm-tap mini-game
        // first; the result (accuracy %) rides along with the revive, and
        // the server adds +20 HP when accuracy >= 90%.
        closeRadial();
        if (typeof Jobs !== 'undefined' && Jobs.startReviveGame) Jobs.startReviveGame(t.id);
        else NetClient.sendInteract(t.id, 'revive');
        sfx('click');
        showBubble(t.x, t.y, 'Đang cấp cứu ' + t.name + '…', 3000);
      } else if (t.kind === 'player' && t.isFainted) {
        showBubble(t.x, t.y, 'Không cấp cứu được khi\noffline (cần máy chủ).', 3000);
      } else if (t.kind === 'player') {
        showBubble(t.x, t.y, t.name + ' không cần cấp cứu.', 3000);
      } else {
        showBubble(t.x, t.y, 'M0: chưa có ai ngất xỉu\nnên chưa cấp cứu được.', 3000);
      }
      return;
    }
    if (action === 'talk') {
      var line;
      if (t.kind === 'player' && t.isBot) {
        // bot persona line from shared/botBrain.js (same lines server uses)
        line = botPersonaLine(t.personaId);
        showRemoteBubble(t.id, line, 4000);
        sfx('talk');
        vfx('talk', t.x, t.y);
      } else if (t.kind === 'player') {
        // human player: show a line, send nothing extra (per M1 brief)
        showRemoteBubble(t.id, 'Đây là ' + t.name + '.', 3000);
      } else if (t.npc && t.npc.isTutorial) {
        // M3 (§10.2): guide shows the 5-step tutorial quest. Online the
        // server answers (npc_talk); offline the same text is local.
        if (netMode === 'online' && typeof NetClient !== 'undefined' && NetClient.connected) {
          NetClient.sendInteract(t.npc.id, 'talk');
          showBubble(t.x, t.y, 'NPC Hướng Dẫn đang nói…', 2000);
        } else {
          showTutorialQuest(t);
          sfx('talk');
          vfx('talk', t.x, t.y);
        }
      } else if (t.npc) {
        // M3 (§10.2): walking NPC — one random persona line. Online the
        // server answers (npc_talk, same BotBrain personas); offline local.
        if (netMode === 'online' && typeof NetClient !== 'undefined' && NetClient.connected) {
          NetClient.sendInteract(t.npc.id, 'talk');
          showBubble(t.x, t.y, t.name + ' đang nói…', 2000);
        } else {
          line = npcPersonaLine(t.npc);
          showBubble(t.x, t.y, line, 4000);
          sfx('talk');
          vfx('talk', t.x, t.y);
        }
      } else {
        line = 'Đây là ' + t.name + '.\n(M0 chỉ xem thông tin, chưa mua bán)';
        showBubble(t.x, t.y, line, 3000);
      }
      return;
    }
    if (action === 'info') {
      var info;
      if (t.kind === 'player') {
        info = t.name + (t.isBot ? ' — Bot dân cư' : ' — Người chơi') +
          (t.isFainted ? '\nĐang ngất xỉu.' : '\nĐang ở trong thành phố.');
        showRemoteBubble(t.id, info, 3000);
      } else {
        info = t.kind === 'npc'
          ? t.name + ' — Dân cư thành phố\nĐang đi dạo quanh thành phố.'
          : t.name + '\nĐịa điểm quan trọng (M0: chỉ xem).';
        showBubble(t.x, t.y, info, 3000);
      }
      return;
    }
  }

  function screenToWorld(e) {
    var gx = (typeof e.globalX === 'number') ? e.globalX : e.global.x;
    var gy = (typeof e.globalY === 'number') ? e.globalY : e.global.y;
    return { x: (gx - world.x) / scale, y: (gy - world.y) / scale };
  }

  function onWorldPointerDown(e) {
    if (!started) return;
    var w = screenToWorld(e);
    // right-click -> radial immediately
    if (e.button === 2) {
      var target = nearestTarget(w.x, w.y);
      if (target) openRadial(target); else closeRadial();
      return;
    }
    // TAP-TO-TALK (2026-11-25): record the tap start — the window
    // pointerup handler opens the radial instantly on a quick tap.
    // (e.global is canvas coords; the canvas fills the window, so it
    // matches clientX/Y used at pointerup.)
    tapDown = { sx: e.global.x, sy: e.global.y, t: Date.now(), wx: w.x, wy: w.y };
    // left click / touch: close menu if clicked elsewhere, else arm long-press
    if (radialMenu.visible) {
      var rt = radialTarget;
      if (!rt || Math.hypot(w.x - rt.x, w.y - rt.y) > 130) closeRadial();
    }
    // long-press for touch (500ms, hold still) — fallback, tap is primary
    if (e.pointerType === 'touch' || e.data.pointerType === 'touch') {
      clearLongPress();
      longPressPos = { x: w.x, y: w.y, sx: e.global.x, sy: e.global.y };
      longPressTimer = setTimeout(function () {
        var t2 = nearestTarget(longPressPos.x, longPressPos.y);
        if (t2) openRadial(t2);
        longPressTimer = null;
      }, 500);
    }
  }
  function clearLongPress() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    longPressPos = null;
  }
  // TAP-TO-TALK: a quick tap (<350ms, <14 screen px) on the world opens the
  // radial menu for the nearest target within 120px (searched at the DOWN
  // position — the NPC may have walked a few px by pointerup). Called from
  // the window pointerup handler in boot().
  function handleTap(e) {
    if (!tapDown) return false;
    var d = tapDown; tapDown = null;
    if (!started || chatOpen) return false;
    if (e.target !== app.view) return false; // tap ended on a DOM panel/button
    if (pinchActive) return false; // two-finger pinch, not a tap
    if (Date.now() - d.t >= 350) return false; // too slow — long-press path owns it
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) >= 14) return false; // dragged
    var t = nearestTarget(d.wx, d.wy);
    if (t) { openRadial(t); sfx('click'); }
    else if (radialMenu.visible) { closeRadial(); }
    return !!t;
  }
  // Floating "💬" above the nearest NPC/player within 120px of the player,
  // so the player knows who is tappable. Updated once per ticker tick.
  function updateTalkHint() {
    if (!talkHint) return;
    if (!started || radialMenu.visible || chatOpen || playerState.isFainted) {
      talkHint.visible = false;
      return;
    }
    var t = nearestTarget(playerState.x, playerState.y);
    if (t && (t.kind === 'npc' || t.kind === 'player')) {
      talkHint.position.set(t.x, t.y - 58);
      talkHint.visible = true;
    } else {
      talkHint.visible = false;
    }
  }

  // ---------- HUD (Canvas only) ----------
  function buildHUD() {
    hud = new PIXI.Container();
    app.stage.addChild(hud);

    // top-left panel — M2 (user: "chữ không đúng trong khung, thu nhỏ chữ và
    // các nút vòng tròn 1 chút"): name 15px, bar labels 13px, money/clock
    // 14px, panel 300px wide so "Tiền mặt: 50.000đ • Ngân hàng: 0đ" fits on
    // ONE line (with a fit-shrink fallback in updateHUD).
    // BUG FIX (M2 browser test): desktop panel was 108px tall but the money
    // line sits at y=122 (+~18px text height = bottom ~140), while the panel
    // bottom was 10+108=118 — the money line overflowed onto the grass.
    // Panel height must cover money bottom + padding: 122+18+12 = 152 abs,
    // i.e. height 148 (bottom 158, money bottom ~140 < 158-8). Mobile (BIG)
    // was already 158 (bottom 168, money bottom ~152) and is unchanged.
    // PHONE FIX (2026-11-25, 390px play-test): the 300px mobile panel ran
    // under the minimap (centre 308,82 r65 -> x243-373) and the money line
    // collided with it. Mobile panel is now 236px wide (ends x246) and the
    // minimap shrank to r48 at (W-56,56) -> x286-382: a 40px clear gap.
    var panelW = HUD_BIG ? 236 : 300, panelH = HUD_BIG ? 158 : 148;
    var panel = new PIXI.Graphics();
    panel.roundRect(10, 10, panelW, panelH, 12).fill({ color: 0x000000, alpha: 0.55 });
    hud.addChild(panel);
    // HUD avatar: hero crop in a circular mask (M0 drawn circle as fallback).
    // NOTE: the circle is ONLY for this small HUD portrait — the in-world
    // character is full-body (makeFullBody), never a badge.
    if (TEX.hero) {
      var avSpr = new PIXI.Sprite(TEX.hero);
      var avR = HUD_BIG ? 22 : 22, avCx = HUD_BIG ? 40 : 38, avCy = HUD_BIG ? 40 : 38;
      avSpr.anchor.set(0.5, 0.5);
      avSpr.width = avR * 2; avSpr.height = avR * 2;
      avSpr.position.set(avCx, avCy);
      var avMask = new PIXI.Graphics();
      avMask.circle(avCx, avCy, avR).fill(0xffffff);
      hud.addChild(avMask);
      hud.addChild(avSpr);
      avSpr.mask = avMask;
      var avRing = new PIXI.Graphics();
      avRing.circle(avCx, avCy, avR).stroke({ width: 3, color: 0xffffff });
      hud.addChild(avRing);
    } else {
      var avatar = new PIXI.Graphics();
      avatar.circle(38, 38, 22).fill(0x2980b9);
      avatar.circle(38, 38, 22).stroke({ width: 3, color: 0xffffff });
      avatar.circle(38, 34, 8).fill(0xffd9b3);
      avatar.roundRect(28, 42, 20, 12, 5).fill(0xffffff);
      hud.addChild(avatar);
    }
    var nameT = text(playerState.name, HUD_BIG ? 15 : 15, 0xffffff, true);
    nameT.anchor.set(0, 0.5); nameT.position.set(HUD_BIG ? 70 : 68, HUD_BIG ? 26 : 26); hud.addChild(nameT);
    // PHONE FIX (2026-11-25): a long name ran under the centred netStatus
    // pill ("Offline — chơi đơn") and looked truncated. Cap the name width
    // to the panel (mobile 166px, desktop 232px): shrink, then ellipsis.
    var nameMaxW = HUD_BIG ? 166 : 232;
    while (nameT.width > nameMaxW && nameT.style.fontSize > 12) {
      nameT.style.fontSize = nameT.style.fontSize - 1;
    }
    while (nameT.width > nameMaxW && nameT.text.length > 2) {
      nameT.text = nameT.text.slice(0, -2) + '…';
    }
    var jobT = text('Nghề: Chưa có', HUD_BIG ? 12 : 12, 0xdddddd);
    jobT.anchor.set(0, 0.5); jobT.position.set(HUD_BIG ? 70 : 68, HUD_BIG ? 46 : 46); hud.addChild(jobT);

    hudRefs.hpG = new PIXI.Graphics(); hud.addChild(hudRefs.hpG);
    hudRefs.hungerG = new PIXI.Graphics(); hud.addChild(hudRefs.hungerG);
    hudRefs.staminaG = new PIXI.Graphics(); hud.addChild(hudRefs.staminaG);
    // bar geometry (shared with updateHUD): M2 bars 16px tall (was 20).
    // PHONE FIX (2026-11-25): mobile bars 212 -> 160 so they end at x234,
    // inside the 236px mobile panel.
    hudRefs.barGeom = HUD_BIG
      ? { x: 74, w: 160, h: 16, ys: [68, 90, 112], labelX: 14, labelYs: [76, 98, 120], labelSize: 13 }
      : { x: 52, w: 190, h: 14, ys: [61, 79, 97], labelX: 14, labelYs: [68, 86, 104], labelSize: 12 };
    var bg = hudRefs.barGeom;
    barLabel('HP', bg.labelX, bg.labelYs[0], hud, bg.labelSize);
    barLabel('Đói', bg.labelX, bg.labelYs[1], hud, bg.labelSize);
    barLabel('Thể lực', bg.labelX, bg.labelYs[2], hud, bg.labelSize);
    hudRefs.moneyT = text('', HUD_BIG ? 14 : 14, 0xffe082, true);
    hudRefs.moneyT.anchor.set(0, 0); hudRefs.moneyT.position.set(14, HUD_BIG ? 134 : 122); hud.addChild(hudRefs.moneyT);
    // VEHICLES FIX (2026-11-25): riding indicator — the old build showed
    // nothing while riding, so mounting "seemed to do nothing". Centred at
    // the bottom (position set in layoutHUD, text set in updateHUD); hidden
    // on foot. NOT under the panel: the mobile netStatus pill sits at y174.
    hudRefs.rideT = text('', HUD_BIG ? 13 : 13, 0x7dff9e, true);
    hudRefs.rideT.anchor.set(0.5, 0.5);
    hudRefs.rideT.style.stroke = { color: 0x000000, width: 4 };
    hud.addChild(hudRefs.rideT);

    // top-right: minimap + clock. PHONE FIX (2026-11-25): mobile minimap
    // r65 -> r48 via minimapR(), centred (W-56,56) in layoutHUD — it no
    // longer covers the money line; the clock moves under it.
    hudRefs.minimapWrap = new PIXI.Container(); hud.addChild(hudRefs.minimapWrap);
    minimapMask = new PIXI.Graphics();
    minimapMask.circle(0, 0, minimapR()).fill(0xffffff);
    hudRefs.minimapWrap.addChild(minimapMask);
    minimapG = new PIXI.Graphics();
    minimapG.mask = minimapMask;
    hudRefs.minimapWrap.addChild(minimapG);
    var ring = new PIXI.Graphics();
    ring.circle(0, 0, minimapR()).stroke({ width: 4, color: 0xffffff });
    hudRefs.minimapWrap.addChild(ring);
    hudRefs.clockT = text('08:00', HUD_BIG ? 14 : 16, 0xffffff, true);
    hudRefs.clockT.anchor.set(0.5, 0);
    hud.addChild(hudRefs.clockT);

    // bottom hint bar — M2: shortened on mobile + smaller font so it fits
    // 390px wide (the M1 hint overflowed the screen width).
    hudRefs.hintT = text(HUD_BIG
      ? 'Joystick: di chuyển  •  CHẠY: chạy nhanh  •  Chạm NPC: nói chuyện'
      : 'WASD / Mũi tên: di chuyển  •  Shift: chạy nhanh  •  Chạm NPC: nói chuyện (chuột phải cũng được)', HUD_BIG ? 12 : 14, 0xffffff, false);
    hudRefs.hintT.anchor.set(0.5, 0.5);
    hudRefs.hintT.style.stroke = { color: 0x000000, width: 4 };
    hud.addChild(hudRefs.hintT);

    hudRefs.fpsT = text('60 FPS', 12, 0xdddddd);
    hudRefs.fpsT.anchor.set(1, 1);
    hud.addChild(hudRefs.fpsT);

    // M3 (§6.2): order status line — countdown + distance + reward, shown
    // top-centre under the netStatus pill while an order is active.
    // PHONE FIX (2026-11-25): on mobile it is 12px, LEFT-aligned at x14 —
    // centred at 14px it was ~315px wide and ran into the right button
    // column (x328+) on a 700px-tall screen.
    hudRefs.orderT = text('', HUD_BIG ? 12 : 14, 0xffe082, true);
    hudRefs.orderT.anchor.set(HUD_BIG ? 0 : 0.5, 0);
    hudRefs.orderT.style.stroke = { color: 0x000000, width: 4 };
    hud.addChild(hudRefs.orderT);
    // M3: keep the HUD job label in sync (buildHUD only set the initial text).
    hudRefs.jobT = jobT;

    buildJoystick();
    buildZoomControls();
    layoutHUD();
  }

  // ---------- zoom controls (Canvas +/- buttons under the minimap) ----------
  function buildZoomControls() {
    function mkZoomBtn(label) {
      var b = new PIXI.Container();
      var g = new PIXI.Graphics();
      g.circle(0, 0, 20).fill({ color: 0x000000, alpha: 0.55 });
      g.circle(0, 0, 20).stroke({ width: 2, color: 0xffffff });
      b.addChild(g);
      var t = text(label, 22, 0xffffff, true);
      t.anchor.set(0.5, 0.5);
      b.addChild(t);
      b.eventMode = 'static';
      b.cursor = 'pointer';
      hud.addChild(b);
      return b;
    }
    zoomOutBtn = mkZoomBtn('-');
    zoomOutBtn.on('pointerdown', function (e) { e.stopPropagation(); setZoom(zoom - ZOOM_STEP); });
    zoomInBtn = mkZoomBtn('+');
    zoomInBtn.on('pointerdown', function (e) { e.stopPropagation(); setZoom(zoom + ZOOM_STEP); });
    zoomLabel = text('Zoom ' + zoom.toFixed(2) + 'x', 12, 0xffffff, true);
    zoomLabel.anchor.set(0.5, 0.5);
    zoomLabel.style.stroke = { color: 0x000000, width: 4 };
    hud.addChild(zoomLabel);
  }

  function setZoom(z) {
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(z * 100) / 100));
    if (zoomLabel) zoomLabel.text = 'Zoom ' + zoom.toFixed(2) + 'x';
    updateCamera();
  }

  function drawBar(g, x, y, w, h, value, color) {
    g.clear();
    g.roundRect(x, y, w, h, h / 2).fill({ color: 0x000000, alpha: 0.6 });
    if (value > 0) {
      g.roundRect(x, y, Math.max(h, w * Math.max(0, Math.min(1, value / 100))), h, h / 2).fill(color);
    }
    g.roundRect(x, y, w, h, h / 2).stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
  }

  function updateHUD() {
    var bg = hudRefs.barGeom || { x: 52, w: 190, h: 14, ys: [61, 79, 97] };
    drawBar(hudRefs.hpG, bg.x, bg.ys[0], bg.w, bg.h, playerState.hp, 0xe74c3c);
    drawBar(hudRefs.hungerG, bg.x, bg.ys[1], bg.w, bg.h, playerState.hunger, 0xe67e22);
    drawBar(hudRefs.staminaG, bg.x, bg.ys[2], bg.w, bg.h, playerState.stamina, 0x2ecc71);
    // M3: job label follows the chosen job (Shipper / Bác sĩ / Tài xế).
    if (hudRefs.jobT) hudRefs.jobT.text = 'Nghề: ' + (JOB_LABELS[playerState.job] || 'Chưa có');
    // M3 (§6.2): active order — countdown + distance + reward.
    if (hudRefs.orderT) {
      var order = currentOrder();
      if (order) {
        var secLeft = Math.max(0, Math.ceil((order.deadlineAt - Date.now()) / 1000));
        var d = Math.round(Math.hypot(order.targetX - playerState.x, order.targetY - playerState.y));
        hudRefs.orderT.text = 'Giao hàng: còn ' + secLeft + 's • cách ' + d + 'm • thưởng ' +
          Math.floor(order.reward).toLocaleString('vi-VN') + 'đ';
      } else hudRefs.orderT.text = '';
    }
    var cashStr = 'Tiền mặt: ' + Math.floor(playerState.cash).toLocaleString('vi-VN') + 'đ';
    var bankStr = 'Ngân hàng: ' + Math.floor(playerState.bank).toLocaleString('vi-VN') + 'đ';
    // M2: ONE line, panel is 300px wide (236px mobile); shrink the font
    // if a big balance would overflow the panel (user: "chữ không đúng trong khung").
    var moneySize = 14;
    hudRefs.moneyT.style.fontSize = moneySize;
    hudRefs.moneyT.text = cashStr + '  •  ' + bankStr;
    var moneyMaxW = HUD_BIG ? 212 : 272;
    while (hudRefs.moneyT.width > moneyMaxW && moneySize > 11) {
      moneySize -= 1;
      hudRefs.moneyT.style.fontSize = moneySize;
    }
    var hh = Math.floor(worldTime / 60) % 24, mm = Math.floor(worldTime % 60);
    var clockStr = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
    var isNight = hh >= 18 || hh < 6;
    hudRefs.clockT.text = clockStr + (isNight ? '  •  Đêm ' : '  •  Ngày ') + worldDay;
    // VEHICLES FIX (2026-11-25): riding indicator — speed + how to
    // dismount. Hidden on foot (empty text). Kept SHORT on purpose: the
    // full text with fuel % is ~310px and would overlap the FPS counter
    // at 390px; fuel/durability stay visible in the job + shop panels.
    if (hudRefs.rideT) {
      var ridingId = currentRidingId();
      if (ridingId) {
        var spd = ridingId === 'motorbike' ? 324 : 234;
        hudRefs.rideT.text = (ridingId === 'motorbike' ? '🏍 Xe máy' : '🚲 Xe đạp') +
          ' • ' + spd + ' px/s • E: xuống xe';
      } else {
        hudRefs.rideT.text = '';
      }
    }
  }

  // M3: the active Shipper order, from the server state (online, synced
  // into playerState.order by syncSelf) or the local engine (offline).
  function currentOrder() {
    if (netMode === 'online') {
      var o = playerState.order;
      return (o && o.status === 'accepted') ? o : null;
    }
    if (typeof Jobs !== 'undefined' && Jobs.getOrder) return Jobs.getOrder();
    return null;
  }

  // M3 (§6.2): redraw the delivery arrow — a yellow line from the player
  // toward the target with a triangle head 90 px out, so the player always
  // knows which way to run. Hidden when there is no active order.
  function updateOrderArrow() {
    if (!orderArrow) return;
    var order = currentOrder();
    if (!order) { orderArrow.visible = false; return; }
    var dx = order.targetX - playerState.x, dy = order.targetY - playerState.y;
    var d = Math.hypot(dx, dy);
    if (d < 30) { orderArrow.visible = false; return; }
    var ux = dx / d, uy = dy / d;
    var hx = playerState.x + ux * 90, hy = playerState.y + uy * 90;
    orderArrow.clear();
    orderArrow.moveTo(playerState.x, playerState.y);
    orderArrow.lineTo(hx, hy);
    orderArrow.stroke({ width: 4, color: 0xf1c40f, alpha: 0.9 });
    // triangle head at (hx, hy), pointing along (ux, uy)
    var px = -uy, py = ux; // perpendicular
    orderArrow.moveTo(hx + ux * 18, hy + uy * 18);
    orderArrow.lineTo(hx - ux * 6 + px * 12, hy - uy * 6 + py * 12);
    orderArrow.lineTo(hx - ux * 6 - px * 12, hy - uy * 6 - py * 12);
    orderArrow.closePath().fill(0xf1c40f);
    orderArrow.visible = true;
  }

  // M3 (§3.2.4): faint panel — countdown + "Về Bệnh viện" button, which
  // only enables 10 s after fainting (so a doctor has time to arrive).
  function updateFaintPanel() {
    if (!faintPanelEl) return;
    if (!playerState.isFainted) { faintPanelEl.classList.remove('open'); return; }
    faintPanelEl.classList.add('open');
    var now = Date.now();
    var until = faintInfo ? faintInfo.until : now + 60000;
    var at = faintInfo ? faintInfo.at : now;
    var left = Math.max(0, Math.ceil((until - now) / 1000));
    var elapsed = Math.floor((now - at) / 1000);
    if (faintTextEl) {
      faintTextEl.textContent = 'Tự về Bệnh viện sau ' + left + 's — hoặc gọi bác sĩ trong chat (kênh Gần / Thế giới).';
    }
    if (hospitalBtnEl) hospitalBtnEl.disabled = elapsed < 10;
  }

  function drawMinimap() {
    var R = minimapR(), s = 2 * R / MAP_W;
    minimapG.clear();
    minimapG.circle(0, 0, R).fill(0x5da24a);
    RoadNet.ROAD_RECTS.forEach(function (q) {
      minimapG.rect(q.x * s - R, q.y * s - R, q.w * s, q.h * s).fill(0x3d3d3d);
    });
    BUILDINGS.forEach(function (b) {
      minimapG.rect(b.x * s - R, b.y * s - R, b.w * s, b.h * s).fill(0x888888);
    });
    POIS.forEach(function (p) {
      minimapG.circle(p.x * s - R, p.y * s - R, 3.5).fill(p.color);
    });
    npcs.forEach(function (n) {
      minimapG.circle(n.x * s - R, n.y * s - R, 3).fill(0xdddddd);
    });
    // Map v2 §7: animals as small brown dots on the minimap.
    animals.forEach(function (a) {
      minimapG.circle(a.x * s - R, a.y * s - R, 2).fill(0x8d6e63);
    });
    // M1: remote players (humans white, bots yellow) — dots big enough to tell apart
    Object.keys(remotePlayers).forEach(function (id) {
      var r = remotePlayers[id];
      minimapG.circle(r.rx * s - R, r.ry * s - R, r.isBot ? 3.5 : 4).fill(r.isBot ? 0xf1c40f : 0xffffff);
      // M3 (§3.2.3): a fainted remote player shows a red ring so a doctor
      // can spot them on the minimap.
      if (r.isFainted) minimapG.circle(r.rx * s - R, r.ry * s - R, 6).stroke({ width: 2, color: 0xe74c3c });
    });
    // M3 (§3.4.3): faint alerts from the server — red X where someone fainted.
    var now = Date.now();
    faintAlerts = faintAlerts.filter(function (a) { return now < a.until; });
    faintAlerts.forEach(function (a) {
      var ax = a.x * s - R, ay = a.y * s - R;
      minimapG.moveTo(ax - 5, ay - 5); minimapG.lineTo(ax + 5, ay + 5);
      minimapG.moveTo(ax + 5, ay - 5); minimapG.lineTo(ax - 5, ay + 5);
      minimapG.stroke({ width: 2.5, color: 0xe74c3c });
    });
    // M3 (§6.2): delivery target — green diamond on the minimap.
    var order = currentOrder();
    if (order) {
      var ox = order.targetX * s - R, oy = order.targetY * s - R;
      minimapG.moveTo(ox, oy - 6); minimapG.lineTo(ox + 6, oy);
      minimapG.lineTo(ox, oy + 6); minimapG.lineTo(ox - 6, oy);
      minimapG.closePath().fill(0x2ecc71);
    }
    minimapG.circle(playerState.x * s - R, playerState.y * s - R, 5.5).fill(0xffffff);
    minimapG.circle(playerState.x * s - R, playerState.y * s - R, 5.5).stroke({ width: 1.5, color: 0x2980b9 });
  }

  // ---------- virtual joystick + sprint (Canvas) ----------
  var joyBase, joyKnob, sprintBtn;
  function buildJoystick() {
    joyBase = new PIXI.Container();
    var baseG = new PIXI.Graphics();
    // M2: joystick base 100px diameter (r=50, was 104), knob r=20 (was 22).
    baseG.circle(0, 0, 50).fill({ color: 0xffffff, alpha: 0.18 });
    baseG.circle(0, 0, 50).stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
    joyBase.addChild(baseG);
    joyKnob = new PIXI.Graphics();
    joyKnob.circle(0, 0, 20).fill({ color: 0xffffff, alpha: 0.55 });
    joyBase.addChild(joyKnob);
    joyBase.eventMode = 'static';
    joyBase.on('pointerdown', function (e) { if (pinchActive) return; joy.active = true; joy.id = e.pointerId; updateJoy(e); });
    joyBase.on('pointermove', function (e) { if (joy.active && e.pointerId === joy.id) updateJoy(e); });
    joyBase.on('pointerup', endJoy);
    joyBase.on('pointerupoutside', endJoy);
    hud.addChild(joyBase);

    sprintBtn = new PIXI.Container();
    var sg = new PIXI.Graphics();
    // M2: CHẠY button 56px diameter (r=28, was 80px) — user asked smaller.
    sg.circle(0, 0, 28).fill({ color: 0xe67e22, alpha: 0.85 });
    sg.circle(0, 0, 28).stroke({ width: 3, color: 0xffffff });
    sprintBtn.addChild(sg);
    var st = text('CHẠY', 13, 0xffffff, true);
    st.anchor.set(0.5, 0.5);
    sprintBtn.addChild(st);
    sprintBtn.eventMode = 'static';
    sprintBtn.cursor = 'pointer';
    sprintBtn.on('pointerdown', function () { sprintTouch = true; });
    sprintBtn.on('pointerup', function () { sprintTouch = false; });
    sprintBtn.on('pointerupoutside', function () { sprintTouch = false; });
    hud.addChild(sprintBtn);
  }
  function updateJoy(e) {
    var cx = joyBase.x, cy = joyBase.y;
    var gx = e.global ? e.global.x : e.clientX;
    var gy = e.global ? e.global.y : e.clientY;
    var dx = gx - cx, dy = gy - cy;
    var len = Math.hypot(dx, dy), max = 46;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    joyKnob.position.set(dx, dy);
    joy.dx = dx / max; joy.dy = dy / max;
  }
  function endJoy() {
    joy.active = false; joy.id = null; joy.dx = 0; joy.dy = 0;
    joyKnob.position.set(0, 0);
  }

  // PHONE FIX (2026-11-25): minimap radius — 65 desktop, 48 on a phone
  // (HUD_BIG). The 65px circle at (W-82,82) overlapped the 300px HUD panel
  // and the money line on a 390px screen.
  function minimapR() { return HUD_BIG ? 48 : 65; }

  function layoutHUD() {
    var W = app.renderer.width, H = app.renderer.height;
    if (hudRefs.minimapWrap) {
      // mobile: centre (W-56,56) -> x286-382, y8-104: clear of the 236px
      // panel (ends x246) and of the clock below it.
      hudRefs.minimapWrap.position.set(HUD_BIG ? W - 56 : W - 82, HUD_BIG ? 56 : 82);
      minimapMask.position.set(0, 0);
    }
    if (hudRefs.clockT) hudRefs.clockT.position.set(HUD_BIG ? W - 56 : W - 82, HUD_BIG ? 112 : 152);
    // PHONE FIX (2026-11-25): the order line was at (W/2,36) — on a 390px
    // phone that lands INSIDE the HUD panel, on top of the "Nghề:" line
    // (x70-160, y40-52). Mobile order line now sits at the bottom-left
    // (14, H-200), above the riding indicator (H-148); centred it ran
    // into the right button column on a 700px-tall screen. Desktop keeps
    // (W/2,36) where the panel is far left of the centre.
    if (hudRefs.orderT) hudRefs.orderT.position.set(HUD_BIG ? 14 : W / 2, HUD_BIG ? H - 200 : 36);
    if (hudRefs.hintT) hudRefs.hintT.position.set(W / 2, H - 18);
    // VEHICLES FIX (2026-11-25): riding indicator centred just above the
    // joystick/sprint (joystick base r50 at (78,H-84) spans y H-134..H-34,
    // sprint r28 spans y H-112..H-56 — the first draft at H-42 overlapped
    // the joystick). At H-148 it clears both (7px above the joystick top)
    // and the DOM ride button (bottom 64px, y H-108..H-64).
    if (hudRefs.rideT) hudRefs.rideT.position.set(W / 2, H - 148);
    // PHONE FIX (2026-11-25): FPS was at (W-10,H-8) — same band as the
    // hint line (H-24..H-12), so "60 FPS" was half-covered by it. Mobile
    // FPS now sits at H-30 (occupies H-42..H-30), clear of the hint line
    // and of the sprint button (ends H-44).
    if (hudRefs.fpsT) hudRefs.fpsT.position.set(W - 10, HUD_BIG ? H - 30 : H - 8);
    if (joyBase) joyBase.position.set(78, H - 84);
    if (sprintBtn) sprintBtn.position.set(W - 78, H - 84);
    if (zoomOutBtn) zoomOutBtn.position.set(W - 122, 202);
    if (zoomInBtn) zoomInBtn.position.set(W - 42, 202);
    if (zoomLabel) zoomLabel.position.set(W - 82, 236);
    if (nightOverlay) {
      nightOverlay.clear();
      nightOverlay.rect(0, 0, W, H).fill(0x0a1a3a);
    }
    if (startOverlay) layoutStart();
  }

  // ---------- night overlay ----------
  function buildNightOverlay() {
    nightOverlay = new PIXI.Graphics();
    nightOverlay.eventMode = 'none';
    nightOverlay.alpha = 0;
    app.stage.addChild(nightOverlay);
    // keep HUD above it: re-add hud on top if it already exists
    if (hud) app.stage.addChild(hud);
    if (startOverlay) app.stage.addChild(startOverlay);
  }
  function darknessFor(hour) {
    if (hour >= 18 || hour < 6) return 0.38;
    if (hour >= 17 && hour < 18) return 0.38 * (hour - 17);
    if (hour >= 6 && hour < 7) return 0.38 * (7 - hour);
    return 0;
  }

  // ---------- start screen (Canvas) ----------
  function buildStart() {
    startOverlay = new PIXI.Container();
    // start-screen backdrop: the aerial city image, dimmed behind the title
    var backdrop = null;
    if (TEX.plaza) {
      backdrop = new PIXI.Sprite(TEX.plaza);
      backdrop.alpha = 0.5;
      startOverlay.addChild(backdrop);
    }
    var bg = new PIXI.Graphics();
    bg.rect(0, 0, 10, 10).fill({ color: 0x0d1b2a, alpha: 0.88 });
    startOverlay.addChild(bg);
    startOverlay.userData = { bg: bg, backdrop: backdrop };
    var title = text('CUỘC SỐNG ẢO', 44, 0xffe082, true);
    title.anchor.set(0.5, 0.5);
    var sub = text('M4  •  PixiJS v8  •  Colyseus  •  Xe cộ + Taxi + Bác sĩ + Nhà trọ', 16, 0xffffff);
    sub.anchor.set(0.5, 0.5);
    var statusT = text('Đang kiểm tra máy chủ…', 14, 0xffe082, true);
    statusT.anchor.set(0.5, 0.5);
    // M2: guide is word-wrapped to the screen width — the M1 guide lines
    // overflowed a 390px phone screen ("chữ không đúng trong khung").
    var guide = text(
      'Joystick: di chuyển  •  Nút CHẠY: chạy nhanh\n' +
      'Chạm vào NPC / người chơi gần bạn: mở menu tròn ngay\n' +
      'Bấm NGHỀ để chọn Shipper / Bác sĩ, nhận đơn ở Kho Hàng.\n' +
      'Tới Cửa Hàng mua bánh mì, tới Ngân Hàng gửi tiền.', 14, 0xdddddd);
    guide.anchor.set(0.5, 0.5);
    guide.style.wordWrap = true;
    guide.style.wordWrapWidth = 340;
    var btn = new PIXI.Container();
    var btnG = new PIXI.Graphics();
    btnG.roundRect(-110, -28, 220, 56, 14).fill(0x27ae60);
    btnG.roundRect(-110, -28, 220, 56, 14).stroke({ width: 3, color: 0xffffff });
    btn.addChild(btnG);
    var btnT = text('BẮT ĐẦU', 22, 0xffffff, true);
    btnT.anchor.set(0.5, 0.5);
    btn.addChild(btnT);
    btn.eventMode = 'static';
    btn.cursor = 'pointer';
    btn.on('pointerdown', function () {
      started = true;
      startOverlay.visible = false;
      var chip = document.getElementById('authChip');
      if (chip) chip.style.display = 'none';
    });
    startOverlay.addChild(title, sub, guide, btn, statusT);
    startOverlay.userData.title = title;
    startOverlay.userData.sub = sub;
    startOverlay.userData.guide = guide;
    startOverlay.userData.btn = btn;
    startOverlay.userData.statusT = statusT;
    app.stage.addChild(startOverlay);
    layoutStart();
  }
  function layoutStart() {
    if (!startOverlay) return;
    var W = app.renderer.width, H = app.renderer.height;
    var bg = startOverlay.userData.bg;
    bg.clear();
    // dimmer is lighter when the aerial backdrop is showing through
    bg.rect(0, 0, W, H).fill({ color: 0x0d1b2a, alpha: startOverlay.userData.backdrop ? 0.55 : 0.88 });
    var bd = startOverlay.userData.backdrop;
    if (bd) {
      var s = Math.max(W / 1024, H / 1024);
      bd.width = 1024 * s; bd.height = 1024 * s;
      bd.position.set((W - bd.width) / 2, (H - bd.height) / 2);
    }
    startOverlay.userData.title.position.set(W / 2, H / 2 - 90);
    startOverlay.userData.sub.position.set(W / 2, H / 2 - 46);
    startOverlay.userData.guide.style.wordWrapWidth = Math.min(560, W - 40);
    startOverlay.userData.guide.position.set(W / 2, H / 2 + 6);
    startOverlay.userData.btn.position.set(W / 2, H / 2 + 78);
    if (startOverlay.userData.statusT) startOverlay.userData.statusT.position.set(W / 2, H / 2 + 136);
  }

  // ---------- movement / collision ----------
  function tryMove(x, y, r) {
    // axis-separated: caller moves one axis at a time
    return !blocked(x, y, r);
  }

  // Current movement input, shared by updatePlayer (local prediction) and
  // moveTick (20 Hz network send). Same shape the server expects.
  function readInput() {
    var ix = 0, iy = 0;
    if (keys['KeyW'] || keys['ArrowUp']) iy -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) iy += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) ix -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) ix += 1;
    if (joy.active) { ix += joy.dx; iy += joy.dy; }
    var len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }
    return { dx: ix, dy: iy, len: len, wantSprint: !!(keys['ShiftLeft'] || keys['ShiftRight'] || sprintTouch) };
  }

  // M4 (§8.1): speed of the ridden vehicle from the server-synced state
  // (fuel/durability). 0 fuel (motorbike) / 0 durability (bicycle) = push
  // speed 180. Shared M3.vehicleSpeed is the source of truth when loaded.
  function currentRideSpeed() {
    var ridingId = playerState.vehicleId || '';
    if (!ridingId) return WALK_SPEED;
    if (typeof M3 !== 'undefined' && M3.vehicleSpeed) {
      return M3.vehicleSpeed(ridingId, playerState.fuel, playerState.durability);
    }
    if (ridingId === 'motorbike') return (playerState.fuel > 0) ? 324 : 180;
    if (ridingId === 'bicycle') return (playerState.durability > 0) ? 234 : 180;
    return WALK_SPEED;
  }

  function updatePlayer(dt) {
    var inp = readInput();
    var ix = inp.dx, iy = inp.dy, len = inp.len;

    // M3 (§3.2.3): a fainted player cannot move, work or buy — but CAN
    // still chat (sendChatFromInput does not check isFainted).
    if (playerState.isFainted) {
      playerState.vx = 0; playerState.vy = 0; playerState.anim = 'fainted';
      lastInput = { dx: 0, dy: 0, sprint: false, len: 0 };
      if (netMode !== 'online') offlineSurvival(dt);
      var face = (player.userData && player.userData.face) || player;
      face.scale.y = 1;
      return;
    }

    // input shape (Colyseus-ready): {dx, dy, sprint}
    // M3 (§7.4 step 3, same as server): sprint is blocked below 10 stamina.
    // M4: sprint is on foot only — a ridden vehicle never sprints; the
    // speed comes from the vehicle (bicycle 234 / motorbike 324, pushed
    // 180 at 0 fuel/durability), then the Hunger x0.7 factor (§3.2.2).
    var ridingId = playerState.vehicleId || '';
    var sprinting = inp.wantSprint && len > 0.1 && playerState.stamina >= 10 && !ridingId;
    var speed;
    if (sprinting) speed = SPRINT_SPEED;
    else if (ridingId) speed = currentRideSpeed();
    else if (netMode !== 'online' && typeof Economy !== 'undefined' && Economy.ridingSpeed) speed = Economy.ridingSpeed();
    else speed = WALK_SPEED;
    if (typeof M3 !== 'undefined' && M3.speedWithHunger) speed = M3.speedWithHunger(speed, playerState.hunger);
    else if (playerState.hunger < 20) speed *= 0.7;
    // TEST MODE (?test=1): speed multiplier, OFFLINE only. Online the
    // server enforces its own speed and would snap the player back, so
    // the multiplier is never applied there (the panel says so).
    if (testMode && netMode !== 'online' && testSpeedMult !== 1) speed = Math.round(speed * testSpeedMult);
    var input = { dx: ix, dy: iy, sprint: sprinting };
    lastInput = { dx: ix, dy: iy, sprint: sprinting, len: len };

    var ox = playerState.x, oy = playerState.y;
    var nx = playerState.x + input.dx * speed * dt;
    var ny = playerState.y + input.dy * speed * dt;
    if (tryMove(nx, playerState.y, 16)) playerState.x = nx;
    if (tryMove(playerState.x, ny, 16)) playerState.y = ny;
    playerState.x = Math.max(20, Math.min(MAP_W - 20, playerState.x));
    playerState.y = Math.max(20, Math.min(MAP_H - 20, playerState.y));
    // M4 (§8.1, offline): drain fuel/durability by distance travelled.
    if (netMode !== 'online' && ridingId && typeof Economy !== 'undefined' && Economy.rideDistance) {
      var moved = Math.hypot(playerState.x - ox, playerState.y - oy);
      var drain = Economy.rideDistance(moved);
      if (drain.outOfFuel) {
        appendChatLog('', '', 'Hết xăng — tốc độ về 180 px/s (đẩy xe). Đổ xăng 5.000đ/bình ở Cửa Hàng.', true);
        sfx('expire');
      }
      if (drain.wornOut) {
        appendChatLog('', '', 'Xe đạp hỏng (độ bền 0%) — tốc độ về 180 px/s. Sửa 10.000đ ở Cửa Hàng.', true);
        sfx('expire');
      }
    }
    playerState.vx = input.dx * speed;
    playerState.vy = input.dy * speed;
    playerState.anim = len > 0.1 ? (sprinting ? 'run' : 'walk') : 'idle';

    // stamina / hunger are server-authoritative when online — never apply
    // them locally there, or the client and server will fight each other.
    if (netMode !== 'online') {
      if (sprinting) playerState.stamina = Math.max(0, playerState.stamina - 5 * dt);
      else playerState.stamina = Math.min(100, playerState.stamina + 3 * dt);
      offlineSurvival(dt);
    }

    player.position.set(playerState.x, playerState.y);
    player.zIndex = playerState.y; // y-sorted with traffic / NPCs / animals
    // flip/bob the badge face (not the whole container — the name label
    // must not mirror); for the M0 fallback person the face IS the container.
    var face2 = (player.userData && player.userData.face) || player;
    face2.scale.y = playerState.anim === 'idle' ? 1 : 1 + Math.sin(performance.now() / 90) * 0.03;
    // direction indicator: flip by horizontal movement
    if (input.dx < -0.1) face2.scale.x = -1;
    else if (input.dx > 0.1) face2.scale.x = 1;
  }

  // M3 (§3.2, offline mirror of the server _secondTick): Hunger -1/15s,
  // Hunger=0 -> -2 HP/10s, Hunger>50 -> +1 HP/10s, HP=0 -> faint (lose 50%
  // Cash immediately), fainted 60s -> hospital auto-revive with fee.
  // Called every frame while offline; accumulators make it frame-rate
  // independent. Online the server does all of this — never call it there.
  function offlineSurvival(dt) {
    if (playerState.isFainted) {
      if (faintInfo && Date.now() >= faintInfo.until) offlineHospitalRevive('auto');
      return;
    }
    localSurv.hungerAcc += dt;
    if (localSurv.hungerAcc >= 15) {
      localSurv.hungerAcc -= 15;
      playerState.hunger = Math.max(0, playerState.hunger - 1);
    }
    if (playerState.hunger === 0) {
      localSurv.hpLossAcc += dt;
      if (localSurv.hpLossAcc >= 10) {
        localSurv.hpLossAcc -= 10;
        playerState.hp = Math.max(0, playerState.hp - 2);
        localSurv.regenAcc = 0;
      }
    } else {
      localSurv.hpLossAcc = 0;
      if (playerState.hunger > 50) {
        localSurv.regenAcc += dt;
        if (localSurv.regenAcc >= 10) {
          localSurv.regenAcc -= 10;
          playerState.hp = Math.min(100, playerState.hp + 1);
        }
      } else localSurv.regenAcc = 0;
    }
    if (playerState.hp <= 0) offlineFaint();
  }

  function offlineFaint() {
    playerState.hp = 0;
    playerState.isFainted = true;
    playerState.anim = 'fainted';
    playerState.vx = 0; playerState.vy = 0;
    var now = Date.now();
    faintInfo = { at: now, until: now + 60000 };
    var lost = 0;
    if (typeof Economy !== 'undefined' && Economy.faintLoss) {
      lost = Economy.faintLoss().lost || 0;
    } else {
      lost = Math.floor(playerState.cash / 2);
      playerState.cash -= lost;
    }
    if (typeof Jobs !== 'undefined' && Jobs.onLocalFaint) Jobs.onLocalFaint();
    sfx('faint');
    vfx('faint', playerState.x, playerState.y, player);
    appendChatLog('', '', 'Bạn đã ngất xỉu! Mất ' + Math.floor(lost).toLocaleString('vi-VN') +
      'đ tiền mặt. Gọi bác sĩ trong chat, hoặc bấm "Về Bệnh viện" sau 10s.', true);
    showBubble(playerState.x, playerState.y, 'Cứu tôi với! Tôi ngất rồi…', 4000);
  }

  // M3 (§3.2.4/§3.2.5): hospital revive — 50 HP, 50 stamina, teleport to
  // the hospital, fee = 10.000 + 50% of remaining Cash (Cash first, then Bank).
  function offlineHospitalRevive(how) {
    var res = { fee: 0, paid: 0 };
    if (typeof Economy !== 'undefined' && Economy.hospitalFee) {
      res = Economy.hospitalFee();
    } else {
      var fee = 10000 + Math.floor(playerState.cash / 2);
      var fromCash = Math.min(playerState.cash, fee);
      playerState.cash -= fromCash;
      var fromBank = Math.min(playerState.bank, fee - fromCash);
      playerState.bank -= fromBank;
      res = { fee: fee, paid: fromCash + fromBank };
    }
    var hSpawn = (typeof M3 !== 'undefined' && M3.HOSPITAL_SPAWN) ? M3.HOSPITAL_SPAWN : { x: 4125, y: 1890 };
    playerState.x = hSpawn.x; playerState.y = hSpawn.y; // Open ground south of Bệnh Viện (Map v2)
    playerState.hp = 50; playerState.stamina = 50;
    playerState.isFainted = false; playerState.anim = 'idle';
    faintInfo = null;
    localSurv.hungerAcc = 0; localSurv.hpLossAcc = 0; localSurv.regenAcc = 0;
    if (player) player.position.set(playerState.x, playerState.y);
    sfx('hospital');
    vfx('revive', playerState.x, playerState.y);
    vfx('unfaint', player);
    appendChatLog('', '', 'Bạn đã hồi sinh tại Bệnh viện (50 HP). Phí ' +
      Math.floor(res.paid).toLocaleString('vi-VN') + 'đ' +
      (how === 'auto' ? ' (hết 60s ngất).' : ' (tự về bệnh viện).'), true);
  }

  // M1: send local input to the server at 20 Hz (every 50 ms) with an
  // incrementing seq — when input changes, or at least every 100 ms while moving.
  function moveTick(dt) {
    if (netMode !== 'online' || !started) return;
    if (typeof NetClient === 'undefined' || !NetClient.connected) return;
    moveAccumMs += dt * 1000;
    if (moveAccumMs < 50) return;
    moveAccumMs = 0;
    var inp = lastInput;
    var now = performance.now();
    var changed = Math.abs(inp.dx - lastSentMove.dx) > 0.01 ||
      Math.abs(inp.dy - lastSentMove.dy) > 0.01 ||
      inp.sprint !== lastSentMove.sprint;
    var moving = inp.len > 0.1;
    if (changed || (moving && now - lastMoveSentAt >= 100) || (!moving && lastSentMove.len > 0.1)) {
      moveSeq += 1;
      if (NetClient.sendMove(moveSeq, Math.round(inp.dx * 1000) / 1000, Math.round(inp.dy * 1000) / 1000, inp.sprint)) {
        lastSentMove = { dx: inp.dx, dy: inp.dy, sprint: inp.sprint, len: inp.len };
        lastMoveSentAt = now;
      }
    }
  }

  function updateNPCs(dt) {
    npcs.forEach(function (n) {
      if (n.speed === 0 && netMode !== 'online') return; // tutorial NPC stays put (offline)
      if (netMode === 'online') {
        // server-driven: interpolate toward the server target (n.tx/n.ty,
        // set from state.npcs patches; guide target never moves)
        var tdx = (n.tx !== undefined ? n.tx : n.x) - n.x;
        var tdy = (n.ty !== undefined ? n.ty : n.y) - n.y;
        var td = Math.hypot(tdx, tdy);
        if (td > 1) {
          var k = Math.min(1, dt * 10);
          n.x += tdx * k; n.y += tdy * k;
          n.container.position.set(n.x, n.y);
          n.container.zIndex = n.y; // y-sorted with the player / traffic
          // FLIP AUDIT (2026-11-25, dog streak): flip the inner FACE
          // container (a plain Container — mirroring it cannot change any
          // size), never the sprite itself and never with scale.x = +/-1 on
          // a width-sized sprite. Same rule as the player (updatePlayer)
          // and remote players (updateRemotePlayers, r.face).
          var faceO = n.face || n.container;
          if (tdx < -0.5) faceO.scale.x = -1;
          else if (tdx > 0.5) faceO.scale.x = 1;
        }
        return;
      }
      var w = RoadNet.stepWalker(n.walker, dt, signalNow());
      var stepX = w.x - n.x;
      n.x = w.x; n.y = w.y;
      n.container.position.set(n.x, n.y);
      n.container.zIndex = n.y; // y-sorted with the player / traffic
      // Flip the inner face container, not the outer container (see the
      // online branch above — same dog-streak audit).
      var faceW = n.face || n.container;
      if (stepX < -0.1) faceW.scale.x = -1;
      else if (stepX > 0.1) faceW.scale.x = 1;
    });
  }

  function updateCamera() {
    var W = app.renderer.width, H = app.renderer.height;
    // M2 zoom: mobile portrait 1.6x, desktop 1.2x, user-adjustable 1.0x–2.2x.
    // screenToWorld / culling divide by this same `scale`, so hit-testing
    // and culling stay correct at any zoom.
    scale = zoom;
    world.scale.set(scale);
    var vw = MAP_W * scale, vh = MAP_H * scale;
    var cx = playerState.x * scale, cy = playerState.y * scale;
    var wx = W / 2 - cx, wy = H / 2 - cy;
    if (vw <= W) wx = (W - vw) / 2; else wx = Math.max(W - vw, Math.min(0, wx));
    if (vh <= H) wy = (H - vh) / 2; else wy = Math.max(H - vh, Math.min(0, wy));
    world.x = wx; world.y = wy;
  }

  function updateCulling() {
    var left = -world.x / scale, top = -world.y / scale;
    var right = left + app.renderer.width / scale, bottom = top + app.renderer.height / scale;
    var pad = 80;
    for (var i = 0; i < cullables.length; i++) {
      var c = cullables[i];
      c.obj.visible = !(c.x + c.w < left - pad || c.x > right + pad || c.y + c.h < top - pad || c.y > bottom + pad);
      // keep cull rect in sync for NPCs (they move)
      if (c.obj === player) continue;
    }
    // NPC cull rects follow their containers
    for (var j = 0; j < cullables.length; j++) {
      var cc = cullables[j];
      if (cc.obj && cc.obj.userData) {
        cc.x = cc.obj.userData.x - 20; cc.y = cc.obj.userData.y - 30;
      }
    }
    player.visible = true;
    radialMenu.visible = radialMenu.visible; // menu is world-space, stays with target
    bubble.visible = bubble.visible;
  }

  // ---------- M1: asset loading (async, per-file fallback) ----------
  async function loadTextures() {
    var keys = Object.keys(ASSET_FILES);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      try { TEX[k] = await PIXI.Assets.load(ASSET_FILES[k]); }
      catch (e) { console.warn('[assets] failed to load ' + ASSET_FILES[k] + ', using M0 drawing:', e); TEX[k] = null; }
    }
  }

  // ---------- M1: remote players (humans + bots, online & offline) ----------
  function makeEntityBubble() {
    var b = new PIXI.Container();
    b.visible = false;
    b.position.set(0, -66);
    var bg = new PIXI.Graphics();
    bg.roundRect(-95, -58, 190, 48, 12).fill(0xffffff);
    bg.roundRect(-95, -58, 190, 48, 12).stroke({ width: 2, color: 0x333333 });
    bg.moveTo(-10, -10); bg.lineTo(10, -10); bg.lineTo(0, 2); bg.closePath().fill(0xffffff);
    b.addChild(bg);
    var t = text('', 15, 0x222222, false);
    t.anchor.set(0.5, 0.5);
    t.position.set(0, -34);
    t.style.wordWrap = true;
    t.style.wordWrapWidth = 170;
    b.addChild(t);
    return { container: b, text: t, timer: null };
  }

  function createRemotePlayer(p, opts) {
    opts = opts || {};
    // M2: remote players/bots are full-body characters, never circular badges.
    var container = makeFullBody(fullTexFor(p.avatar), p.name);
    container.position.set(p.x, p.y);
    var bub = makeEntityBubble();
    container.addChild(bub.container);
    world.addChild(container);
    var entry = {
      id: p.id, name: p.name, avatar: p.avatar || 'hero',
      container: container, face: (container.userData && container.userData.face) || container,
      label: (container.userData && container.userData.label) || null,
      bubble: bub.container, bubbleText: bub.text, bubbleTimer: null,
      rx: p.x, ry: p.y, tx: p.x, ty: p.y, x: p.x, y: p.y,
      isBot: !!opts.isBot, personaId: opts.personaId || null,
      isFainted: !!p.isFainted, lastBubbleText: '',
      wander: opts.wander || null, brain: opts.brain || null,
      nextProactiveAt: opts.nextProactiveAt || 0
    };
    container.userData = container.userData || {};
    container.userData.x = p.x; container.userData.y = p.y;
    // keep the entry itself reachable from the container for culling
    container.userData.entry = entry;
    remotePlayers[p.id] = entry;
    cullables.push({ obj: container, x: p.x - 20, y: p.y - 30, w: 40, h: 60 });
    return entry;
  }

  function removeRemotePlayer(id) {
    var entry = remotePlayers[id];
    if (!entry) return;
    if (entry.bubbleTimer) clearTimeout(entry.bubbleTimer);
    if (entry.container.parent) entry.container.parent.removeChild(entry.container);
    for (var i = cullables.length - 1; i >= 0; i--) {
      if (cullables[i].obj === entry.container) cullables.splice(i, 1);
    }
    delete remotePlayers[id];
  }

  function clearRemotePlayers() {
    Object.keys(remotePlayers).forEach(function (id) { removeRemotePlayer(id); });
    offlineBotsSpawned = false;
  }

  function showRemoteBubble(id, str, ms) {
    var entry = remotePlayers[id];
    if (!entry) return;
    entry.bubbleText.text = str;
    entry.bubble.visible = true;
    entry.lastBubbleText = str;
    if (entry.bubbleTimer) clearTimeout(entry.bubbleTimer);
    entry.bubbleTimer = setTimeout(function () { entry.bubble.visible = false; }, ms || 4000);
  }

  // Interpolate remote players between patches; offline bots wander locally.
  function updateRemotePlayers(dt) {
    var now = Date.now();
    Object.keys(remotePlayers).forEach(function (id) {
      var r = remotePlayers[id];
      if (netMode === 'offline' && r.wander) {
        // local wander (same rules as M0 NPCs / server bots)
        var w = RoadNet.stepWalker(r.wander, dt, signalNow());
        if (w.x - r.rx < -0.1) r.face.scale.x = -1;
        else if (w.x - r.rx > 0.1) r.face.scale.x = 1;
        r.rx = w.x; r.ry = w.y;
        // proactive chat: every 20-40 s, only when the player is within 600px
        if (now >= r.nextProactiveAt) {
          r.nextProactiveAt = now + 20000 + Math.random() * 20000;
          if (Math.hypot(r.rx - playerState.x, r.ry - playerState.y) <= 600) {
            var line = botPersonaLine(r.personaId);
            if (line) deliverChat({ fromId: r.id, fromName: r.name, channel: 'nearby', text: line, targetId: null, at: now });
          }
        }
      } else if (netMode === 'online') {
        var k = Math.min(1, dt * 10);
        var odx = r.tx - r.rx, ody = r.ty - r.ry;
        r.rx += odx * k; r.ry += ody * k;
        if (odx < -0.5) r.face.scale.x = -1;
        else if (odx > 0.5) r.face.scale.x = 1;
      }
      r.x = r.rx; r.y = r.ry;
      if (r.container.userData) { r.container.userData.x = r.rx; r.container.userData.y = r.ry; }
      r.container.position.set(r.rx, r.ry);
      r.container.zIndex = r.ry; // y-sorted with the player / traffic
    });
  }

  // ---------- M1: offline bots (shared/botBrain.js, same rules as server) ----------
  function spawnOfflineBots() {
    if (offlineBotsSpawned) return;
    if (typeof BotBrain === 'undefined') { console.warn('[bots] BotBrain not loaded, offline bots disabled'); return; }
    BotBrain.PERSONAS.forEach(function (persona) {
      var near = randomOpenPoint();
      var home = { x: 2430, y: 2650 };
      var walker = RoadNet.createWalker(RoadNet.nearestPed(home.x + (near.x % 600) - 300, home.y + (near.y % 600) - 300),
        { speed: 45 + Math.random() * 30, home: home, radius: 900 });
      createRemotePlayer(
        { id: 'bot-' + persona.id, name: persona.name, x: walker.x, y: walker.y, avatar: persona.avatar, isFainted: false },
        {
          isBot: true, personaId: persona.id,
          wander: walker,
          brain: BotBrain.createBotState(persona.id),
          nextProactiveAt: Date.now() + 20000 + Math.random() * 20000
        }
      );
    });
    offlineBotsSpawned = true;
  }

  function botPersonaLine(personaId) {
    if (typeof BotBrain === 'undefined') return pick(TALK_LINES);
    var persona = null;
    BotBrain.PERSONAS.forEach(function (p) { if (p.id === personaId) persona = p; });
    if (!persona) return pick(TALK_LINES);
    var pool = persona.lines.filter(function (l) { return l !== (persona._lastLine || null); });
    var line = pool.length ? pick(pool) : pick(persona.lines);
    persona._lastLine = line;
    return line;
  }

  // M3 (§10.2): one random line from a walking NPC's persona (same
  // BotBrain personas the server uses — never the generic TALK_LINES).
  function npcPersonaLine(npc) {
    if (typeof BotBrain === 'undefined' || !npc || !npc.personaId) return pick(TALK_LINES);
    var persona = null;
    BotBrain.PERSONAS.forEach(function (p) { if (p.id === npc.personaId) persona = p; });
    if (!persona) return pick(TALK_LINES);
    var pool = persona.lines.filter(function (l) { return l !== npc.lastTalkLine; });
    var line = pool.length ? pick(pool) : pick(persona.lines);
    npc.lastTalkLine = line;
    return line;
  }

  // M3 (§3.5): the 5-step tutorial quest from the guide NPC.
  var TUTORIAL_QUEST = [
    '1. Nói chuyện với NPC Hướng Dẫn — nhận 80.000đ vốn khởi nghiệp',
    '2. Mua 1 Bánh mì ở Cửa Hàng Tiện Lợi và ăn (+40 Độ no)',
    '3. Làm Shipper: nhận 1 đơn ở Kho Hàng và giao thành công',
    '4. Gửi 20.000đ vào Bank tại ATM',
    '5. Hoàn thành cả 4 bước — thưởng 30.000đ + danh hiệu "Công dân chính thức"'
  ];
  function showTutorialQuest(t) {
    showBubble(t.x, t.y, 'Chào Công Dân mới! Xem nhiệm vụ tân thủ trong khung chat nhé.', 4000);
    appendChatLog('', '', '— Nhiệm vụ tân thủ —', true);
    TUTORIAL_QUEST.forEach(function (step) { appendChatLog('', '', step, true); });
  }

  function findCalledBotId(text) {
    if (typeof BotBrain === 'undefined') return null;
    var norm = BotBrain.stripDiacritics(text);
    for (var i = 0; i < BotBrain.PERSONAS.length; i++) {
      var persona = BotBrain.PERSONAS[i];
      for (var j = 0; j < persona.callNames.length; j++) {
        if (norm.indexOf(persona.callNames[j]) !== -1) return 'bot-' + persona.id;
      }
    }
    return null;
  }

  // Offline bot replies to a local chat message (mirrors the server:
  // 1-3 s delay, at most one bot answers, prefers the bot called by name).
  function offlineBotReplies(channel, text, targetId) {
    if (typeof BotBrain === 'undefined') return;
    var candidates = [];
    Object.keys(remotePlayers).forEach(function (id) {
      var r = remotePlayers[id];
      if (!r.isBot) return;
      if (channel === 'nearby' && Math.hypot(r.rx - playerState.x, r.ry - playerState.y) > 600) return;
      candidates.push(r);
    });
    if (!candidates.length) return;
    var chosen = null;
    if (targetId && remotePlayers[targetId] && remotePlayers[targetId].isBot) {
      chosen = remotePlayers[targetId];
    } else {
      var called = findCalledBotId(text);
      if (called && remotePlayers[called]) chosen = remotePlayers[called];
      else chosen = candidates[Math.floor(Math.random() * candidates.length)];
    }
    if (!chosen) return;
    var delay = 1000 + Math.random() * 2000;
    setTimeout(function () {
      if (netMode !== 'offline' || !remotePlayers[chosen.id]) return;
      var reply = BotBrain.respond(chosen.personaId, text, playerState.name, chosen.brain);
      if (!reply) return; // bot stays silent sometimes, same as server
      deliverChat({ fromId: chosen.id, fromName: chosen.name, channel: channel, text: reply, targetId: targetId || null, at: Date.now() });
    }, delay);
  }

  // ---------- M1: chat DOM ----------
  function channelLabel(ch) {
    return ch === 'world' ? 'Thế giới' : ch === 'private' ? 'Riêng' : 'Gần';
  }

  function buildChat() {
    chatEls.panel = document.getElementById('chatPanel');
    chatEls.log = document.getElementById('chatLog');
    chatEls.input = document.getElementById('chatInput');
    chatEls.btn = document.getElementById('chatBtn');
    chatEls.status = document.getElementById('netStatus');
    if (!chatEls.panel || !chatEls.log || !chatEls.input) return;
    var tabs = chatEls.panel.querySelectorAll('#chatTabs button[data-channel]');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { setChatChannel(tab.getAttribute('data-channel')); });
    });
    var closeBtn = document.getElementById('chatClose');
    if (closeBtn) closeBtn.addEventListener('click', closeChat);
    if (chatEls.btn) chatEls.btn.addEventListener('click', function () { if (chatOpen) closeChat(); else openChat(); });
    var sendBtn = document.getElementById('chatSend');
    if (sendBtn) sendBtn.addEventListener('click', sendChatFromInput);
    chatEls.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); sendChatFromInput(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeChat(); }
      e.stopPropagation();
    });
    chatEls.input.addEventListener('focus', function () { chatInputFocused = true; });
    chatEls.input.addEventListener('blur', function () { chatInputFocused = false; });
  }

  function openChat() {
    if (!chatEls.panel) return;
    chatOpen = true;
    chatEls.panel.classList.add('open');
    if (chatEls.input) chatEls.input.focus();
  }
  function closeChat() {
    chatOpen = false;
    if (chatEls.panel) chatEls.panel.classList.remove('open');
    if (chatEls.input) chatEls.input.blur();
  }

  function setChatChannel(ch) {
    chatChannel = ch;
    if (!chatEls.panel) return;
    var tabs = chatEls.panel.querySelectorAll('#chatTabs button[data-channel]');
    tabs.forEach(function (tab) {
      if (tab.getAttribute('data-channel') === ch) tab.classList.add('active');
      else tab.classList.remove('active');
    });
    if (chatEls.input) {
      chatEls.input.placeholder = ch === 'private' ? 'Nhắn riêng… (chọn người qua menu tròn)' : ch === 'world' ? 'Nhắn thế giới…' : 'Nhắn gần…';
    }
  }

  function appendChatLog(fromName, channel, text, isSys) {
    if (!chatEls.log) return;
    var div = document.createElement('div');
    div.className = 'line' + (isSys ? ' sys' : '');
    if (isSys) {
      div.textContent = text;
    } else {
      var color = channel === 'world' ? '#82cfff' : channel === 'private' ? '#f0a6ff' : '#a5e08a';
      var tag = document.createElement('span');
      tag.style.color = color;
      tag.textContent = '[' + channelLabel(channel) + '] ' + fromName + ': ';
      div.appendChild(tag);
      div.appendChild(document.createTextNode(text));
    }
    chatEls.log.appendChild(div);
    while (chatEls.log.children.length > 20) chatEls.log.removeChild(chatEls.log.firstChild);
    chatEls.log.scrollTop = chatEls.log.scrollHeight;
  }

  // Single delivery path for every chat message (online via server, offline
  // local): append to the log + show a bubble above the sender for 4 s.
  function deliverChat(msg) {
    if (!msg || !msg.text) return;
    appendChatLog(msg.fromName, msg.channel, msg.text, false);
    var fromId = msg.fromId;
    if (fromId === 'local-1' || (mySessionId && fromId === mySessionId)) {
      if (msg.text !== lastSelfBubbleText) {
        lastSelfBubbleText = msg.text;
        showBubble(playerState.x, playerState.y, msg.text, 4000);
      }
    } else if (remotePlayers[fromId]) {
      showRemoteBubble(fromId, msg.text, 4000);
    }
  }

  function nearestRemotePlayerId() {
    var best = null, bestD = 600;
    Object.keys(remotePlayers).forEach(function (id) {
      var r = remotePlayers[id];
      var d = Math.hypot(r.rx - playerState.x, r.ry - playerState.y);
      if (d < bestD) { bestD = d; best = id; }
    });
    return best;
  }

  function sendChatFromInput() {
    if (!chatEls.input) return;
    var textVal = chatEls.input.value.trim();
    if (!textVal) return;
    if (textVal.length > 200) {
      appendChatLog('', '', 'Tin nhắn quá dài (tối đa 200 ký tự).', true);
      return;
    }
    var channel = chatChannel;
    var targetId = null;
    if (channel === 'private') {
      targetId = chatTargetId || nearestRemotePlayerId();
      if (!targetId) {
        appendChatLog('', '', 'Chưa chọn người để nhắn riêng — chạm vào một người chơi để mở menu.', true);
        return;
      }
    }
    chatEls.input.value = '';
    if (netMode === 'online' && typeof NetClient !== 'undefined' && NetClient.connected) {
      NetClient.sendChat(channel, textVal, targetId);
      // own message comes back via the server broadcast — no local echo
    } else {
      deliverChat({ fromId: 'local-1', fromName: playerState.name, channel: channel, text: textVal, targetId: targetId, at: Date.now() });
      offlineBotReplies(channel, textVal, targetId);
    }
    if (chatEls.input) chatEls.input.focus();
  }

  // ---------- M1: net integration ----------
  // ---------- TEST MODE (?test=1, 2026-11-25) ----------
  // Dev-only panel (#testPanel in index.html): free money, speed x2/x3,
  // full heal. OFF unless the URL has ?test=1 — no test UI otherwise.
  // Money + heal are OFFLINE-ONLY by design: online the server owns the
  // wallet and the stats, and there is no test endpoint on the server
  // (adding one would be a cheat vector). Speed is offline-only for the
  // same reason (the server enforces its own speed). The panel states
  // these limits in its note line; syncTestPanel re-checks netMode twice
  // a second (called from the FPS block) so the buttons follow a
  // connect/disconnect without a reload.
  function syncTestPanel() {
    var panel = document.getElementById('testPanel');
    if (!panel || !testMode) return;
    var online = netMode === 'online';
    var moneyBtn = document.getElementById('testMoney');
    var healBtn = document.getElementById('testHeal');
    var note = document.getElementById('testNote');
    if (moneyBtn) moneyBtn.disabled = online;
    if (healBtn) healBtn.disabled = online;
    var btns = panel.querySelectorAll('[data-speed]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].disabled = online;
      btns[i].classList.toggle('active', parseInt(btns[i].getAttribute('data-speed'), 10) === testSpeedMult);
    }
    if (note) note.textContent = online
      ? 'Đang ONLINE: tiền + hồi máu bị khóa (do server quản lý), tốc độ do server quyết định — các nút test không có tác dụng.'
      : 'Chỉ hoạt động offline. Tiền cộng vào ví local (localStorage). Tốc độ x2/x3 nhân tốc độ đi/chạy.';
  }
  function initTestMode() {
    try {
      var q = new URLSearchParams(window.location.search || '');
      testMode = q.get('test') === '1';
    } catch (e) { testMode = false; }
    var panel = document.getElementById('testPanel');
    if (!panel) return;
    if (!testMode) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    var toggle = document.getElementById('testToggle');
    var body = document.getElementById('testBody');
    if (toggle && body) toggle.addEventListener('click', function () {
      var open = body.classList.toggle('open');
      toggle.textContent = open ? '🧪 TEST ▾' : '🧪 TEST ▸';
    });
    var moneyBtn = document.getElementById('testMoney');
    if (moneyBtn) moneyBtn.addEventListener('click', function () {
      if (netMode === 'online') return; // server owns the wallet online
      if (typeof Economy !== 'undefined' && Economy.grant) {
        Economy.grant(1000000, 'test_grant', { source: 'test_mode' });
        appendChatLog('', '', 'TEST: +1.000.000đ vào ví (test_grant).', true);
        sfx('coin');
      }
    });
    var healBtn = document.getElementById('testHeal');
    if (healBtn) healBtn.addEventListener('click', function () {
      if (netMode === 'online') return; // server owns the stats online
      playerState.hp = 100; playerState.hunger = 100; playerState.stamina = 100;
      if (playerState.isFainted) {
        playerState.isFainted = false; playerState.anim = 'idle'; faintInfo = null;
        vfx('unfaint', player);
      }
      appendChatLog('', '', 'TEST: HP/Đói/Thể lực đã hồi đầy 100.', true);
      sfx('heal');
    });
    var btns = panel.querySelectorAll('[data-speed]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        if (netMode === 'online') return;
        testSpeedMult = parseInt(this.getAttribute('data-speed'), 10) || 1;
        appendChatLog('', '', 'TEST: tốc độ di chuyển x' + testSpeedMult + ' (offline).', true);
        syncTestPanel();
      });
    }
    syncTestPanel();
  }

  function setNetStatus(t) {
    if (chatEls.status) chatEls.status.textContent = t;
  }
  function setStartStatus(t) {
    if (startOverlay && startOverlay.userData && startOverlay.userData.statusT) {
      startOverlay.userData.statusT.text = t;
    }
  }

  function serverUrlFromPage() {
    try {
      var q = new URLSearchParams(window.location.search);
      if (q.get('offline') === '1') return null;
      var s = q.get('server');
      if (s) return s;
    } catch (e) { /* URLSearchParams unsupported — fall through */ }
    var host = window.location.hostname || '';
    if (host === 'localhost' || host === '127.0.0.1' || host === '') return 'ws://localhost:2567';
    return 'wss://newlife.up.railway.app';
  }

  function goOffline(reason) {
    console.log('[net] offline mode:', reason);
    netMode = 'offline';
    setNetStatus('Offline — chơi đơn');
    setStartStatus('Offline — chơi đơn (không có máy chủ)');
    clearRemotePlayers();
    spawnOfflineBots();
  }

  function syncSelf(p) {
    // authoritative stats from the server
    playerState.hp = p.hp; playerState.hunger = p.hunger; playerState.stamina = p.stamina;
    playerState.cash = p.cash; playerState.bank = p.bank; playerState.isFainted = p.isFainted;
    // M4: vehicle / taxi / motel state from the server.
    if (p.vehicleId !== undefined) playerState.vehicleId = p.vehicleId || null;
    if (p.fuel !== undefined) playerState.fuel = p.fuel;
    if (p.durability !== undefined) playerState.durability = p.durability;
    if (p.passengerId !== undefined) playerState.passengerId = p.passengerId || null;
    if (p.roomExpiresAt !== undefined) playerState.roomExpiresAt = p.roomExpiresAt;
    // M3: job + active order (server-authoritative, §6 state lives in state).
    if (p.job) playerState.job = p.job;
    if (p.orderStatus === 'accepted') {
      playerState.order = {
        status: 'accepted', id: p.orderId, targetX: p.orderX, targetY: p.orderY,
        deadlineAt: p.orderDeadline, reward: p.orderReward,
        pickupName: p.orderPickupName || '', pickupX: p.orderPickupX || 0, pickupY: p.orderPickupY || 0,
      };
    } else playerState.order = null;
    // M3 (§3.2.3): track when fainting started — the faint panel counts
    // down from it and the hospital button enables after 10 s.
    // M4: the false->true edge is ALSO the online self-faint event. The
    // sound now comes from the server 'fainted' broadcast (onFainted,
    // the M3-gap fix); this edge plays it too as a fallback, throttled
    // to once per 3 s so a faint never plays twice.
    if (p.isFainted && !faintInfo) {
      faintInfo = { at: Date.now(), until: Date.now() + 60000 };
      playFaintSfx();
      vfx('faint', p.x, p.y, player);
    }
    if (!p.isFainted && faintInfo) { vfx('unfaint', player); faintInfo = null; }
    // reconcile predicted position: <24px lerp, >=24px snap
    if (firstSelfSync) {
      playerState.x = p.x; playerState.y = p.y;
      if (player) player.position.set(p.x, p.y);
      firstSelfSync = false;
    } else {
      var d = Math.hypot(p.x - playerState.x, p.y - playerState.y);
      if (d >= 24) {
        playerState.x = p.x; playerState.y = p.y;
        if (player) player.position.set(p.x, p.y);
      } else if (d > 0.5) {
        playerState.x += (p.x - playerState.x) * 0.25;
        playerState.y += (p.y - playerState.y) * 0.25;
      }
    }
    if (p.chatBubble && p.chatBubbleUntil > Date.now() && p.chatBubble !== lastSelfBubbleText) {
      lastSelfBubbleText = p.chatBubble;
      showBubble(playerState.x, playerState.y, p.chatBubble, 4000);
    }
  }

  function syncRemotePlayer(p) {
    var entry = remotePlayers[p.id];
    if (!entry) {
      entry = createRemotePlayer(p, { isBot: p.id.indexOf('bot-') === 0, personaId: p.id.indexOf('bot-') === 0 ? p.id.slice(4) : null });
    } else {
      entry.tx = p.x; entry.ty = p.y;
      entry.isFainted = !!p.isFainted;
      if (p.name && p.name !== entry.name) {
        entry.name = p.name;
        if (entry.label) entry.label.text = p.name;
      }
      if (p.chatBubble && p.chatBubbleUntil > Date.now() && p.chatBubble !== entry.lastBubbleText) {
        showRemoteBubble(p.id, p.chatBubble, 4000);
      }
    }
    return entry;
  }

  function syncNpc(n) {
    // M4: NPC taxi customers (server-spawned while the room has < 4 real
    // players and a driver has "Nhận khách" on) get their own sprite so
    // the driver can see and drive to them. They are NOT in npcs[].
    if (n.type === 'taxi_customer') {
      syncTaxiCustomerSprite(n.id, n.x, n.y);
      var found = false;
      for (var i = 0; i < onlineTaxiCustomers.length; i++) {
        if (onlineTaxiCustomers[i].npcId === n.id) {
          onlineTaxiCustomers[i].x = n.x; onlineTaxiCustomers[i].y = n.y; found = true;
        }
      }
      if (!found) onlineTaxiCustomers.push({ npcId: n.id, x: n.x, y: n.y });
      onlineTaxi.customers = onlineTaxiCustomers;
      return;
    }
    // map server NPC ids onto the local M0 NPC objects
    var local = null;
    if (n.id === 'npc-guide') local = tutorialNpc ? tutorialNpc.userData : null;
    else if (n.id.indexOf('npc-walker-') === 0) {
      var idx = parseInt(n.id.slice('npc-walker-'.length), 10);
      if (!isNaN(idx) && npcs[idx]) local = npcs[idx];
    }
    if (!local) return;
    if (local.tx === undefined || Math.hypot(n.x - local.x, n.y - local.y) > 200) {
      local.x = n.x; local.y = n.y; // first sync (or teleport): snap
      if (local.container) local.container.position.set(n.x, n.y);
    }
    local.tx = n.x; local.ty = n.y;
  }

  // M4: one sprite per taxi customer (NPC or offline local). Created on
  // demand, removed when the customer is picked up / despawns. Offline
  // customers come from Jobs.getTaxiCustomers(); online ones from syncNpc.
  function syncTaxiCustomerSprite(id, x, y) {
    if (!world) return;
    var spr = taxiSprites[id];
    if (!spr) {
      spr = makeFullBody(TEX.studentFull, 'Khách vãng lai');
      spr.position.set(x, y);
      world.addChild(spr);
      taxiSprites[id] = spr;
    }
    spr.position.set(x, y);
    spr.zIndex = y; // y-sorted with the player / traffic
  }
  function removeTaxiCustomerSprite(id) {
    var spr = taxiSprites[id];
    if (!spr) return;
    if (world) world.removeChild(spr);
    delete taxiSprites[id];
  }
  function updateTaxiCustomerSprites() {
    if (netMode === 'online') return; // online: syncNpc drives the sprites
    if (typeof Jobs === 'undefined' || !Jobs.getTaxiCustomers) return;
    var seen = {};
    Jobs.getTaxiCustomers().forEach(function (c) {
      seen[c.id] = true;
      syncTaxiCustomerSprite(c.id, c.x, c.y);
    });
    Object.keys(taxiSprites).forEach(function (id) {
      if (!seen[id]) removeTaxiCustomerSprite(id);
    });
  }

  function initNet() {
    setNetStatus('Đang kết nối…');
    setStartStatus('Đang kiểm tra máy chủ…');
    var url = serverUrlFromPage();
    if (!url) { goOffline('no-server-configured'); return; }
    if (typeof NetClient === 'undefined' || !NetClient.available) { goOffline('no-colyseus-lib'); return; }
    var selfId = function () { return NetClient.sessionId; };
    NetClient.hooks = {
      onPlayerAdded: function (p) {
        if (p.id === selfId()) return;
        syncRemotePlayer(p);
      },
      onPlayerChanged: function (p) {
        if (p.id === selfId()) { syncSelf(p); return; }
        syncRemotePlayer(p);
      },
      onPlayerRemoved: function (id) {
        if (id === selfId()) return;
        removeRemotePlayer(id);
      },
      onNpcAdded: function (n) { syncNpc(n); },
      onNpcChanged: function (n) { syncNpc(n); },
      onNpcRemoved: function (id) {
        // M4: a picked-up / despawned taxi customer loses its sprite.
        if (taxiSprites[id]) {
          removeTaxiCustomerSprite(id);
          onlineTaxiCustomers = onlineTaxiCustomers.filter(function (c) { return c.npcId !== id; });
          onlineTaxi.customers = onlineTaxiCustomers;
        }
      },
      onChatMessage: function (msg) { deliverChat(msg); },
      onChatError: function (err) {
        appendChatLog('', '', 'Không gửi được tin nhắn: ' + (err && err.error ? err.error : 'lỗi không rõ'), true);
      },
      onInteractError: function (err) {
        var msg = (err && err.error === 'TOO_FAR') ? 'Quá xa để cấp cứu (cần ≤ 120px).'
          : (err && err.error === 'INVALID_TARGET') ? 'Không cấp cứu được người này.'
          : (err && err.error === 'TOO_EARLY') ? 'Nút "Về Bệnh viện" chỉ mở sau 10s ngất — chờ bác sĩ tới cứu đã.'
          : 'Hành động chưa có trong M1.';
        appendChatLog('', '', msg, true);
        showBubble(playerState.x, playerState.y, msg, 3000);
      },
      onRevived: function (msg) {
        var text = msg.byName + ' đã hồi sinh một công dân.';
        if (msg.bonusHp > 0) text += ' (cấp cứu theo nhịp xuất sắc: +' + msg.bonusHp + ' HP, tổng ' + msg.hp + ' HP)';
        if (msg.reward > 0) text += ' (thưởng ' + Math.floor(msg.reward).toLocaleString('vi-VN') + 'đ)';
        else if (msg.reason && msg.reason !== 'OK') text += ' (không thưởng: ' + msg.reason + ')';
        appendChatLog('', '', text, true);
        // Sound only when I am the reviver or the revived (local feedback).
        if (msg.targetId === mySessionId || msg.byId === mySessionId) sfx('revive');
        // VFX twin: green sparkles + ring at the revived player.
        if (msg.targetId === mySessionId) { vfx('revive', playerState.x, playerState.y); vfx('unfaint', player); }
        else if (msg.targetId && remotePlayers[msg.targetId]) {
          var rp = remotePlayers[msg.targetId];
          vfx('revive', rp.rx, rp.ry);
        }
        if (msg.targetId && remotePlayers[msg.targetId]) {
          showRemoteBubble(msg.targetId, 'Cảm ơn ' + msg.byName + '!', 4000);
        }
      },
      // M3: job/shipper results from the server.
      onJobResult: function (msg) {
        if (!msg) return;
        if (msg.type === 'job') {
          if (msg.ok) {
            playerState.job = msg.job;
            appendChatLog('', '', 'Đã chọn nghề: ' + (JOB_LABELS[msg.job] || msg.job) + '.', true);
            sfx('jobPick');
          } else {
            var why = msg.error === 'ACTIVE_ORDER' ? 'Đang có đơn Shipper — giao xong / hủy rồi mới đổi nghề.'
              : msg.error === 'ACTIVE_RIDE' ? 'Đang chở khách Taxi — trả khách xong rồi mới đổi nghề.'
              : 'Không đổi được nghề: ' + (msg.error || 'lỗi không rõ');
            appendChatLog('', '', why, true);
          }
          if (typeof Jobs !== 'undefined' && Jobs.render) Jobs.render();
          return;
        }
        if (msg.type === 'shipper') {
          if (msg.ok && msg.action === 'complete') {
            appendChatLog('', '', 'Giao hàng thành công! +' +
              Math.floor(msg.reward).toLocaleString('vi-VN') + 'đ.', true);
            sfx('deliver');
            vfx('deliver', playerState.x, playerState.y, '+' + Math.floor(msg.reward).toLocaleString('vi-VN') + 'đ');
            vfx('clearPath');
            if (typeof msg.cash === 'number') playerState.cash = msg.cash;
            if (typeof msg.bank === 'number') playerState.bank = msg.bank;
          } else if (msg.ok && msg.action === 'accept' && msg.order) {
            appendChatLog('', '', 'Đã nhận đơn: lấy hàng ở ' + (msg.order.pickupName || 'Kho Hàng Trung Tâm') +
              ', giao tới ' + (msg.order.poiName || 'điểm giao') +
              ' — hạn ' + msg.order.secondsLeft + 's, thưởng ' +
              Math.floor(msg.order.reward).toLocaleString('vi-VN') + 'đ. Mũi tên vàng chỉ đường!', true);
            sfx('accept');
            vfx('acceptPath', msg.order.targetX, msg.order.targetY);
          } else if (msg.ok && msg.action === 'cancel') {
            appendChatLog('', '', 'Đã hủy đơn — chờ 10s mới nhận đơn mới.', true);
            sfx('click');
            vfx('clearPath');
          } else if (!msg.ok) {
            var errMsg = msg.error === 'ALREADY_PROCESSED' ? 'Đơn này đã giao xong rồi (chống trùng).'
              : msg.error === 'TOO_FAR' ? 'Chưa tới nơi — tới Kho Hàng Trung Tâm hoặc cửa hàng (Cửa Hàng Tiện Lợi, Nhà Trọ, Chợ, Quán Cà Phê) để nhận đơn, tới đúng điểm giao (trong 80px) để giao hàng.'
              : msg.error === 'NOT_SHIPPER' ? 'Bạn chưa chọn nghề Shipper — bấm nút NGHỀ trước.'
              : msg.error === 'ALREADY_HAVE_ORDER' ? 'Bạn đang có 1 đơn rồi.'
              : msg.error === 'COOLDOWN' ? 'Vừa hủy đơn, chờ ' + (msg.retryAfterSec || 10) + 's nữa.'
              : msg.error === 'EXPIRED' ? 'Đơn đã hết hạn — không thưởng, nhận đơn mới được rồi.'
              : msg.error === 'FAILED' ? 'Đơn FAILED (bạn ngất giữa đường) — không thưởng.'
              : msg.error === 'FAINTED' ? 'Bạn đang ngất, không làm đơn được.'
              : msg.error === 'ORDER_TAKEN' ? 'Đơn này vừa có người nhận — thử nhận đơn khác.'
              : 'Shipper lỗi: ' + (msg.error || 'không rõ');
            appendChatLog('', '', errMsg, true);
            if (msg.error === 'EXPIRED' || msg.error === 'FAILED') sfx('expire');
            else sfx('error');
            vfx('clearPath');
          }
          if (typeof Jobs !== 'undefined' && Jobs.render) Jobs.render();
          return;
        }
        if (msg.type === 'hospital' && msg.ok) {
          if (typeof msg.cash === 'number') playerState.cash = msg.cash;
          if (typeof msg.bank === 'number') playerState.bank = msg.bank;
          appendChatLog('', '', 'Bạn đã về Bệnh viện (50 HP).', true);
          sfx('hospital');
          vfx('revive', playerState.x, playerState.y);
          vfx('unfaint', player);
        }
      },
      // M3 (§10.2): NPC talk reply — bubble at the NPC + quest in chat log.
      onNpcTalk: function (msg) {
        if (!msg) return;
        sfx('talk');
        vfx('talk', msg.x, msg.y);
        if (msg.isGuide && msg.quest) {
          showBubble(msg.x, msg.y, 'Chào Công Dân mới! Xem nhiệm vụ tân thủ trong khung chat nhé.', 4000);
          appendChatLog('', '', '— Nhiệm vụ tân thủ —', true);
          msg.quest.forEach(function (step) { appendChatLog('', '', step, true); });
        } else {
          showBubble(msg.x, msg.y, msg.text, 4000);
        }
      },
      // M3 (§3.4.3): someone fainted — doctors get the alert (minimap + log).
      onFaintAlert: function (msg) {
        if (!msg) return;
        sfx('alert');
        faintAlerts.push({ x: msg.x, y: msg.y, until: Date.now() + 60000 });
        appendChatLog('', '', 'Có người ngất xỉu: ' + msg.name + ' tại (' +
          Math.round(msg.x) + ', ' + Math.round(msg.y) + ') — Bác sĩ tới cứu ngay!', true);
      },
      // M4: explicit 'fainted' broadcast — THE fix for the known M3 gap
      // (online self-faint played no sound). Self-faint -> faint SFX +
      // chat line; other players' faints are silent for me (doctors
      // already get faint_alert). Throttled in playFaintSfx (once / 3 s)
      // because the state patch also fires the same edge.
      onFainted: function (msg) {
        if (!msg) return;
        if (msg.playerId === mySessionId) {
          playFaintSfx();
          appendChatLog('', '', 'Bạn đã ngất xỉu! Mất 50% tiền mặt. Gọi bác sĩ trong chat, hoặc bấm "Về Bệnh viện" sau 10s.', true);
        }
      },
      // M4: vehicle results (buy / mount / dismount / refuel / repair /
      // status / out_of_fuel / worn_out).
      onVehicleResult: function (msg) {
        if (!msg) return;
        if (typeof msg.cash === 'number') playerState.cash = msg.cash;
        if (typeof msg.bank === 'number') playerState.bank = msg.bank;
        if (msg.ok && msg.action === 'status' && msg.vehicles) {
          onlineVehicles = {
            riding: msg.riding || '',
            bicycle: msg.vehicles.bicycle || { owned: false },
            motorbike: msg.vehicles.motorbike || { owned: false },
          };
          if (typeof Economy !== 'undefined' && Economy.setOnlineVehicles) Economy.setOnlineVehicles(onlineVehicles);
        } else if (msg.ok && msg.action === 'buy') {
          var bought = msg.vehicleId === 'motorbike' ? 'xe máy' : 'xe đạp';
          var buyMsg = 'Đã mua ' + bought + ' (' + Math.floor(msg.price).toLocaleString('vi-VN') + 'đ). Xe đang đỗ ở Showroom — tới gần rồi bấm Lên xe (phím E).';
          appendChatLog('', '', buyMsg, true);
          if (typeof Economy !== 'undefined' && Economy.showOnlineFeedback) Economy.showOnlineFeedback('shop', buyMsg, false);
          sfx('deliver');
          if (typeof NetClient !== 'undefined' && NetClient.sendVehicle) NetClient.sendVehicle('status', {});
        } else if (msg.ok && msg.action === 'mount') {
          onlineVehicles.riding = msg.vehicleId || '';
          if (typeof Economy !== 'undefined' && Economy.setOnlineVehicles) Economy.setOnlineVehicles(onlineVehicles);
          appendChatLog('', '', 'Đã lên ' + (msg.vehicleId === 'motorbike' ? 'xe máy (324 px/s)' : 'xe đạp (234 px/s)') + '.', true);
          sfx('accept');
          if (typeof NetClient !== 'undefined' && NetClient.sendVehicle) NetClient.sendVehicle('status', {});
        } else if (msg.ok && msg.action === 'dismount') {
          onlineVehicles.riding = '';
          if (typeof Economy !== 'undefined' && Economy.setOnlineVehicles) Economy.setOnlineVehicles(onlineVehicles);
          appendChatLog('', '', 'Đã xuống xe — xe đỗ tại chỗ này.', true);
          sfx('click');
          if (typeof NetClient !== 'undefined' && NetClient.sendVehicle) NetClient.sendVehicle('status', {});
        } else if (msg.ok && msg.action === 'refuel') {
          var fuelMsg = 'Đã đổ đầy bình xăng (đi được 8.000 px).';
          appendChatLog('', '', fuelMsg, true);
          if (typeof Economy !== 'undefined' && Economy.showOnlineFeedback) Economy.showOnlineFeedback('shop', fuelMsg, false);
          sfx('deliver');
          if (typeof NetClient !== 'undefined' && NetClient.sendVehicle) NetClient.sendVehicle('status', {});
        } else if (msg.ok && msg.action === 'repair') {
          var repMsg = 'Đã sửa xe đạp — độ bền 100%.';
          appendChatLog('', '', repMsg, true);
          if (typeof Economy !== 'undefined' && Economy.showOnlineFeedback) Economy.showOnlineFeedback('shop', repMsg, false);
          sfx('deliver');
          if (typeof NetClient !== 'undefined' && NetClient.sendVehicle) NetClient.sendVehicle('status', {});
        } else if (msg.ok && (msg.action === 'out_of_fuel' || msg.action === 'worn_out')) {
          appendChatLog('', '', msg.message || 'Xe không chạy được nữa.', true);
          sfx('expire');
          if (typeof NetClient !== 'undefined' && NetClient.sendVehicle) NetClient.sendVehicle('status', {});
        } else if (!msg.ok) {
          var why = msg.error === 'TOO_FAR' && msg.x !== undefined
            ? 'Xe đang đỗ ở (' + Math.round(msg.x) + ', ' + Math.round(msg.y) + ') — tới gần trong 80 px rồi lên xe.'
            : (typeof Jobs !== 'undefined' && Jobs.jobErrText ? Jobs.jobErrText(msg) : 'Xe lỗi: ' + (msg.error || 'không rõ'));
          appendChatLog('', '', why, true);
          if (typeof Economy !== 'undefined' && Economy.showOnlineFeedback) Economy.showOnlineFeedback('shop', why, true);
          sfx('error');
        }
        if (typeof Economy !== 'undefined' && Economy.renderShop) Economy.renderShop();
        if (typeof Jobs !== 'undefined' && Jobs.render) Jobs.render();
      },
      // M4: taxi results (toggle / invite / accept / pickup / dropoff /
      // status / ride_ended).
      onTaxiResult: function (msg) {
        if (!msg) return;
        if (msg.action === 'toggle' && msg.ok) {
          onlineTaxi.taxiMode = !!msg.taxiMode;
          appendChatLog('', '', msg.taxiMode ? 'Đã bật "Nhận khách" — khách vãng lai sẽ xuất hiện ở các ngã tư.' : 'Đã tắt "Nhận khách".', true);
        } else if (msg.action === 'invited' && msg.ok) {
          onlineTaxi.invitedBy = msg.driverId;
          appendChatLog('', '', msg.driverName + ' mời bạn lên xe ôm — mở bảng NGHỀ rồi bấm "Lên xe" để đồng ý (30s).', true);
          sfx('alert');
        } else if (msg.action === 'accept' && msg.ok) {
          onlineTaxi.invitedBy = null;
          appendChatLog('', '', 'Bạn đang ngồi sau xe ' + msg.driverName + ' — bấm "Trả khách" trong bảng NGHỀ để xuống (tính cước theo quãng đường).', true);
          sfx('accept');
        } else if (msg.action === 'pickup' && msg.ok) {
          onlineTaxi.ride = { kind: 'npc', passengerId: msg.npcId, poiName: msg.poiName, destX: msg.destX, destY: msg.destY, distancePx: 0 };
          appendChatLog('', '', 'Đã đón khách — chở tới ' + (msg.poiName || 'điểm đến') + '. Cước 1.000đ/100 px, tối thiểu 5.000đ.', true);
          sfx('accept');
        } else if (msg.action === 'dropoff' && msg.ok) {
          onlineTaxi.ride = null;
          if (typeof msg.cash === 'number') playerState.cash = msg.cash;
          appendChatLog('', '', 'Trả khách xong! Cước ' + Math.floor(msg.fare).toLocaleString('vi-VN') + 'đ' +
            (msg.nightBonus ? ' + phụ cấp đêm ' + Math.floor(msg.nightBonus).toLocaleString('vi-VN') + 'đ' : '') +
            ' = +' + Math.floor(msg.received).toLocaleString('vi-VN') + 'đ.', true);
          sfx('deliver');
          vfx('deliver', playerState.x, playerState.y, '+' + Math.floor(msg.received).toLocaleString('vi-VN') + 'đ');
        } else if (msg.action === 'status' && msg.ok) {
          onlineTaxi.taxiMode = !!msg.taxiMode;
          onlineTaxi.ride = msg.ride || null;
          onlineTaxiCustomers = (msg.customers || []).map(function (c) { return { npcId: c.npcId, x: c.x, y: c.y }; });
          onlineTaxi.customers = onlineTaxiCustomers;
          if (msg.invitedBy) onlineTaxi.invitedBy = msg.invitedBy;
        } else if (!msg.ok) {
          if (msg.error === 'PASSENGER_LEFT' || msg.error === 'DRIVER_LEFT') {
            onlineTaxi.ride = null;
            appendChatLog('', '', msg.error === 'PASSENGER_LEFT' ? 'Khách đã xuống xe giữa đường — chuyến xe kết thúc (không tính cước).' : 'Tài xế đã rời đi — chuyến xe kết thúc.', true);
          } else if (msg.error !== 'DECLINED') {
            appendChatLog('', '', typeof Jobs !== 'undefined' && Jobs.jobErrText ? Jobs.jobErrText(msg) : 'Taxi lỗi: ' + (msg.error || 'không rõ'), true);
            sfx('error');
          }
        }
        if (typeof Jobs !== 'undefined') {
          if (Jobs.setOnlineTaxi) Jobs.setOnlineTaxi(onlineTaxi);
          else if (Jobs.render) Jobs.render();
        }
      },
      // M4: motel results (rent / renew / chest_put / chest_take / status).
      onMotelResult: function (msg) {
        if (!msg) return;
        if (typeof msg.cash === 'number') playerState.cash = msg.cash;
        if (typeof msg.bank === 'number') playerState.bank = msg.bank;
        if (msg.inventory && typeof Economy !== 'undefined' && Economy.setOnlineInventory) {
          Economy.setOnlineInventory(msg.inventory);
        }
        if (msg.ok && (msg.action === 'rent' || msg.action === 'renew')) {
          appendChatLog('', '', (msg.action === 'rent' ? 'Đã thuê phòng trọ 50.000đ / 24h' : 'Đã gia hạn phòng trọ') +
            ' — hết hạn ' + new Date(msg.expiresAt).toLocaleString('vi-VN') + '. Điểm hồi sinh của bạn là phòng trọ.', true);
          sfx('deliver');
          if (typeof Economy !== 'undefined' && Economy.setOnlineMotelStatus) {
            Economy.setOnlineMotelStatus({ expiresAt: msg.expiresAt, chestState: 'active' });
          }
        } else if (msg.ok && msg.action === 'status') {
          if (typeof Economy !== 'undefined' && Economy.setOnlineMotelStatus) {
            Economy.setOnlineMotelStatus({ expiresAt: msg.expiresAt, chestState: msg.chestState, chest: msg.chest || {} });
          }
        } else if (msg.ok && (msg.action === 'chest_put' || msg.action === 'chest_take')) {
          if (typeof Economy !== 'undefined' && Economy.setOnlineMotelStatus) {
            Economy.setOnlineMotelStatus({ chest: msg.chest || {} });
          }
          sfx('click');
        } else if (!msg.ok) {
          appendChatLog('', '', typeof Jobs !== 'undefined' && Jobs.jobErrText ? Jobs.jobErrText(msg) : 'Nhà trọ lỗi: ' + (msg.error || 'không rõ'), true);
          sfx('error');
        }
        if (typeof Economy !== 'undefined' && Economy.renderMotel) Economy.renderMotel();
        if (typeof Economy !== 'undefined' && Economy.renderShop) Economy.renderShop();
      },
      onServerNow: function (ms) {
        if (ms) serverClockOffset = ms - Date.now();
      },
      onWorldTime: function (minutes) {
        if (netMode !== 'online') return;
        // midnight wrap on the server also starts a new game day; the
        // 1200/240 guard keeps a server restart (back to 08:00 = 480)
        // from counting as a new day.
        if (worldTime > 1200 && minutes < 240) worldDay++;
        worldTime = minutes;
      },
      // M2/M5: server economy results (sync / starter_grant / shop_buy / atm_transfer /
      // use_item). Server is authoritative for cash/bank when online.
      onEconResult: function (msg) {
        if (!msg) return;
        if (typeof msg.cash === 'number') playerState.cash = msg.cash;
        if (typeof msg.bank === 'number') playerState.bank = msg.bank;
        if (msg.inventory && typeof Economy !== 'undefined' && Economy.setOnlineInventory) {
          Economy.setOnlineInventory(msg.inventory);
        }
        if (typeof msg.dayUsed === 'number' && typeof Economy !== 'undefined' && Economy.setOnlineAtmDayUsed) {
          Economy.setOnlineAtmDayUsed(msg.dayUsed);
        }
        if (msg.type === 'sync') {
          if (typeof Economy !== 'undefined') {
            if (Economy.renderShop) Economy.renderShop();
            if (Economy.renderAtm) Economy.renderAtm();
          }
          return;
        }
        if (msg.ok) {
          if (msg.type === 'shop_buy') {
            var itemName = (typeof Economy !== 'undefined' && Economy.ITEMS && Economy.ITEMS[msg.item_id])
              ? Economy.ITEMS[msg.item_id].name : msg.item_id;
            var buyTxt = 'Đã mua ' + itemName + ' (' + Math.floor(msg.total || 0).toLocaleString('vi-VN') + 'đ). Còn ' + Math.floor(playerState.cash).toLocaleString('vi-VN') + 'đ.';
            if (typeof Economy !== 'undefined' && Economy.showOnlineFeedback) Economy.showOnlineFeedback('shop', buyTxt, false);
            sfx('click');
          } else if (msg.type === 'use_item') {
            if (typeof msg.hunger === 'number') playerState.hunger = msg.hunger;
            if (typeof msg.stamina === 'number') playerState.stamina = msg.stamina;
            var useName = (typeof Economy !== 'undefined' && Economy.ITEMS && Economy.ITEMS[msg.item_id])
              ? Economy.ITEMS[msg.item_id].name : 'vật phẩm';
            var useTxt = 'Đã dùng ' + useName + '! Độ no ' + Math.floor(playerState.hunger) + ', Thể lực ' + Math.floor(playerState.stamina) + '.';
            if (typeof Economy !== 'undefined' && Economy.showOnlineFeedback) Economy.showOnlineFeedback('shop', useTxt, false);
            sfx('click');
          } else if (msg.type === 'atm_transfer') {
            var atmTxt = (msg.action === 'deposit' ? 'Đã gửi ' : 'Đã rút ') + Math.floor(msg.amount || 0).toLocaleString('vi-VN') + 'đ.';
            if (typeof Economy !== 'undefined' && Economy.showOnlineFeedback) Economy.showOnlineFeedback('atm', atmTxt, false);
            sfx('click');
          }
        } else {
          if (msg.error !== 'ALREADY_GRANTED') {
            var errMsg = (typeof Economy !== 'undefined' && Economy.errText) ? Economy.errText(msg) : ('Lỗi: ' + (msg.error || 'không rõ'));
            if (typeof Economy !== 'undefined' && Economy.showOnlineFeedback) {
              Economy.showOnlineFeedback(msg.type === 'atm_transfer' ? 'atm' : 'shop', errMsg, true);
            }
            appendChatLog('', '', errMsg, true);
            sfx('error');
          }
        }
        if (typeof Economy !== 'undefined') {
          if (Economy.renderShop) Economy.renderShop();
          if (Economy.renderAtm) Economy.renderAtm();
        }
      },
      onSnapshot: function (snap) {
        if (netMode !== 'online') return;
        var seen = {};
        snap.players.forEach(function (p) {
          seen[p.id] = true;
          if (p.id === selfId()) syncSelf(p);
          else syncRemotePlayer(p);
        });
        Object.keys(remotePlayers).forEach(function (id) {
          if (!seen[id]) removeRemotePlayer(id);
        });
        snap.npcs.forEach(function (n) { syncNpc(n); });
        var humans = 0;
        snap.players.forEach(function (p) { if (p.id.indexOf('bot-') !== 0) humans += 1; });
        if (humans !== lastHumanCount) {
          lastHumanCount = humans;
          setNetStatus('Online: ' + humans + ' người');
          setStartStatus('Online — ' + humans + ' người trong thành phố');
        }
      },
      onDisconnected: function () {
        netMode = 'reconnecting';
        setNetStatus('Đang kết nối lại…');
        setStartStatus('Mất kết nối — đang kết nối lại…');
      },
      onReconnected: function () {
        netMode = 'online';
        mySessionId = NetClient.sessionId;
        firstSelfSync = true;
        setNetStatus('Online…');
        setStartStatus('Online — đã kết nối lại');
        // VEHICLES FIX (2026-11-25): re-ask the owned-vehicle status so a
        // returning player's parked bike renders after a reconnect.
        if (typeof NetClient.sendEconomy === 'function') NetClient.sendEconomy('econ_sync', {});
        if (typeof NetClient.sendVehicle === 'function') NetClient.sendVehicle('status', {});
        if (typeof NetClient.sendMotel === 'function') NetClient.sendMotel('status', {});
      },
      onReconnectFailed: function () {
        goOffline('reconnect-timeout-30s');
      }
    };
    function httpUrlFromWs(wsUrl) {
      return String(wsUrl || '').replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://').replace(/\/+$/, '');
    }
    function fetchServerConfig(wsUrl) {
      var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 8000) : null;
      return fetch(httpUrlFromWs(wsUrl) + '/config', ctrl ? { signal: ctrl.signal } : {})
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .finally(function () { if (timer) clearTimeout(timer); });
    }
    function displayNameFromUser(user, fallback) {
      var meta = (user && user.user_metadata) || {};
      var raw = meta.display_name || meta.full_name || meta.name || (user && user.email ? user.email.split('@')[0] : '');
      return String(raw || '').trim().slice(0, 24) || fallback;
    }
    function updateAuthChip() {
      var chip = document.getElementById('authChip');
      var txt = document.getElementById('authChipText');
      var btn = document.getElementById('authChipBtn');
      if (!chip || !txt || !btn) return;
      if (started || !authSb) { chip.style.display = 'none'; return; }
      chip.style.display = 'flex';
      if (authSession && authSession.user) {
        var label = authSession.user.email || displayNameFromUser(authSession.user, 'Đã đăng nhập');
        txt.textContent = 'TK: ' + label;
        btn.textContent = 'Đăng xuất';
      } else {
        txt.textContent = 'Chế độ Khách (chưa lưu)';
        btn.textContent = 'Đăng nhập';
      }
    }
    function connectAndJoin(joinOpts) {
      NetClient.connect(url).then(function (res) {
        if (!res.ok) { goOffline(res.reason); return null; }
        return NetClient.joinRoom('city', joinOpts);
      }).then(function (res) {
        if (!res) return; // already offline
        if (!res.ok) { goOffline(res.reason); return; }
        mySessionId = res.sessionId;
        netMode = 'online';
        firstSelfSync = true;
        setNetStatus('Online…');
        setStartStatus(authSession ? 'Online — đã đăng nhập & lưu tiến trình' : 'Online — chế độ Khách');
        updateAuthChip();
        if (typeof NetClient.sendEconomy === 'function') {
          NetClient.sendEconomy('econ_sync', {});
          NetClient.sendEconomy('starter_grant', {});
        }
        // VEHICLES FIX (2026-11-25): ask for the owned-vehicle status too —
        // otherwise a returning player never sees their parked bike online.
        if (typeof NetClient.sendEconomy === 'function') NetClient.sendEconomy('econ_sync', {});
        if (typeof NetClient.sendVehicle === 'function') NetClient.sendVehicle('status', {});
        if (typeof NetClient.sendMotel === 'function') NetClient.sendMotel('status', {});
      }).catch(function (err) {
        console.warn('[net] init failed:', err);
        goOffline('error');
      });
    }
    function openAuthModal() {
      var modal = document.getElementById('authModal');
      if (modal) modal.classList.add('open');
    }
    function closeAuthModal() {
      var modal = document.getElementById('authModal');
      if (modal) modal.classList.remove('open');
    }
    function setAuthMsg(msg, isOk) {
      var el = document.getElementById('authMsg');
      if (!el) return;
      el.textContent = msg || '';
      el.style.color = isOk ? '#a5e08a' : '#ff9a9a';
    }
    function joinWithSession(session) {
      authSession = session;
      myName = displayNameFromUser(session.user, myName);
      playerState.name = myName;
      closeAuthModal();
      updateAuthChip();
      connectAndJoin({ accessToken: session.access_token, name: myName, avatar: 'hero' });
    }
    function parseOAuthCallbackError() {
      try {
        var q = new URLSearchParams(window.location.search || '');
        var h = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
        return h.get('error_description') || q.get('error_description') || h.get('error') || q.get('error') || '';
      } catch (e) { return ''; }
    }
    function cleanOAuthUrl() {
      try {
        var hasAuthHash = /access_token=|refresh_token=|error_description=|error=/.test(window.location.hash || '');
        var q = new URLSearchParams(window.location.search || '');
        var hadCode = q.has('code') || q.has('error') || q.has('error_description');
        if (!hasAuthHash && !hadCode) return;
        q.delete('code'); q.delete('error'); q.delete('error_description');
        var qs = q.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
      } catch (e) { /* ignore */ }
    }
    function wireAuthUi() {
      var googleBtn = document.getElementById('authGoogle');
      var loginBtn = document.getElementById('authLogin');
      var signupBtn = document.getElementById('authSignup');
      var guestBtn = document.getElementById('authGuest');
      var chipBtn = document.getElementById('authChipBtn');
      var nameEl = document.getElementById('authName');
      var emailEl = document.getElementById('authEmail');
      var passEl = document.getElementById('authPass');
      if (chipBtn) chipBtn.addEventListener('click', function () {
        if (!authSb) return;
        if (authSession) {
          authSb.auth.signOut().then(function () {
            authSession = null;
            if (typeof NetClient !== 'undefined' && NetClient.leave) NetClient.leave();
            updateAuthChip();
            setAuthMsg('');
            openAuthModal();
          });
        } else {
          setAuthMsg('');
          openAuthModal();
        }
      });
      if (googleBtn) googleBtn.addEventListener('click', function () {
        if (!authSb) return;
        googleBtn.disabled = true;
        setAuthMsg('Đang chuyển sang Google…', true);
        var redirectTo = window.location.origin + window.location.pathname + window.location.search;
        authSb.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: redirectTo }
        }).then(function (r) {
          if (r && r.error) {
            googleBtn.disabled = false;
            var msg = r.error.message || 'Không mở được đăng nhập Google.';
            if (/not enabled|unsupported provider/i.test(msg)) {
              msg = 'Chưa bật đăng nhập Google trên Supabase (Authentication → Providers → Google).';
            }
            setAuthMsg(msg);
          }
        }).catch(function (err) {
          googleBtn.disabled = false;
          setAuthMsg((err && err.message) || 'Lỗi đăng nhập Google.');
        });
      });
      if (guestBtn) guestBtn.addEventListener('click', function () {
        closeAuthModal();
        authSession = null;
        updateAuthChip();
        connectAndJoin({ name: myName, avatar: 'hero' });
      });
      if (loginBtn) loginBtn.addEventListener('click', function () {
        if (!authSb) return;
        var email = emailEl ? emailEl.value.trim() : '';
        var password = passEl ? passEl.value : '';
        if (!email || !password) { setAuthMsg('Nhập đầy đủ Email và Mật khẩu.'); return; }
        loginBtn.disabled = true; setAuthMsg('Đang đăng nhập…', true);
        authSb.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
          loginBtn.disabled = false;
          if (r.error || !r.data || !r.data.session) {
            setAuthMsg((r.error && r.error.message) || 'Đăng nhập thất bại.');
            return;
          }
          joinWithSession(r.data.session);
        }).catch(function (err) {
          loginBtn.disabled = false;
          setAuthMsg((err && err.message) || 'Lỗi đăng nhập.');
        });
      });
      if (signupBtn) signupBtn.addEventListener('click', function () {
        if (!authSb) return;
        var email = emailEl ? emailEl.value.trim() : '';
        var password = passEl ? passEl.value : '';
        var nick = (nameEl ? nameEl.value.trim() : '') || (email.split('@')[0] || 'CongDan');
        if (!email || password.length < 6) { setAuthMsg('Nhập Email hợp lệ và mật khẩu từ 6 ký tự.'); return; }
        signupBtn.disabled = true; setAuthMsg('Đang đăng ký…', true);
        var redirectTo = window.location.origin + window.location.pathname + window.location.search;
        authSb.auth.signUp({
          email: email, password: password,
          options: {
            data: { display_name: nick.slice(0, 24) },
            emailRedirectTo: redirectTo
          }
        }).then(function (r) {
          signupBtn.disabled = false;
          if (r.error) { setAuthMsg(r.error.message || 'Đăng ký thất bại.'); return; }
          if (r.data && r.data.session) {
            joinWithSession(r.data.session);
          } else {
            setAuthMsg('Đăng ký thành công! Hãy kiểm tra email xác nhận (hoặc tắt Confirm Email trên Supabase) rồi bấm Đăng nhập.', true);
          }
        }).catch(function (err) {
          signupBtn.disabled = false;
          setAuthMsg((err && err.message) || 'Lỗi đăng ký.');
        });
      });
    }

    wireAuthUi();
    var oauthErr = parseOAuthCallbackError();
    fetchServerConfig(url).then(function (cfg) {
      var sbUrl = (cfg && cfg.supabaseUrl) || window.SUPABASE_URL || null;
      var sbKey = (cfg && cfg.supabasePublishableKey) || window.SUPABASE_ANON_KEY || null;
      if (sbUrl && sbKey && typeof window.supabase !== 'undefined' && window.supabase.createClient) {
        try {
          authSb = window.supabase.createClient(sbUrl, sbKey);
        } catch (e) { authSb = null; }
      }
      if (!authSb) {
        connectAndJoin({ name: myName, avatar: 'hero' });
        return null;
      }
      return authSb.auth.getSession().then(function (res) {
        cleanOAuthUrl();
        authSession = (res && res.data && res.data.session) ? res.data.session : null;
        updateAuthChip();
        if (authSession && authSession.access_token) {
          joinWithSession(authSession);
        } else {
          setNetStatus('Chờ đăng nhập…');
          setStartStatus('Đăng nhập để lưu tiến trình, hoặc chơi Khách');
          if (oauthErr) setAuthMsg(oauthErr);
          openAuthModal();
        }
      });
    }).catch(function () {
      connectAndJoin({ name: myName, avatar: 'hero' });
    });
  }

  // ---------- boot ----------
  async function boot() {
    if (typeof PIXI === 'undefined') return;
    app = new PIXI.Application();
    await app.init({
      resizeTo: window,
      backgroundColor: 0x1a2b1a,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2)
    });
    document.body.appendChild(app.canvas);
    app.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // M1: identity + textures before building the world (badges need textures)
    myName = 'CongDan-' + Math.random().toString(36).slice(2, 6);
    playerState.name = myName;
    await loadTextures();

    // M2: economy first — starter grant (once) + local wallet load, before
    // the HUD reads playerState.cash. Falls back to the old 80.000đ only if
    // the economy module fails to load at all.
    try {
      if (typeof Economy !== 'undefined') Economy.init(playerState, function () { return worldTime; });
      else playerState.cash = 80000;
    } catch (e) { console.warn('[economy] init failed, fallback cash 80000:', e); playerState.cash = 80000; }

    buildWorld();
    buildNightOverlay();
    buildHUD();
    buildStart();
    buildChat();
    // Rename+VFX: init the Pixi VFX layer on the world built above (lamp
    // glow pools need lampGlows from buildWorld; the fxLayer must exist
    // before the ticker starts). Safe wrapper — VFX never crashes boot.
    try {
      if (typeof DTA_VFX !== 'undefined' && DTA_VFX.init) DTA_VFX.init({ world: world, lamps: lampGlows });
    } catch (e) { console.warn('[vfx] init failed:', e); }
    // M3: job panel + offline Shipper engine (jobs.js) and the faint panel.
    try {
      if (typeof Jobs !== 'undefined') {
        Jobs.init({
          state: playerState,
          isOnline: function () { return netMode === 'online'; },
          sendShipper: function (action, extra) {
            if (typeof NetClient !== 'undefined' && NetClient.sendShipper) NetClient.sendShipper(action, extra);
          },
          sendJob: function (job) {
            if (typeof NetClient !== 'undefined' && NetClient.sendJob) NetClient.sendJob(job);
          },
          // M4: vehicles / taxi / doctor revive mini-game (online).
          sendVehicle: function (action, extra) {
            if (typeof NetClient !== 'undefined' && NetClient.sendVehicle) NetClient.sendVehicle(action, extra);
          },
          sendTaxi: function (action, extra) {
            if (typeof NetClient !== 'undefined' && NetClient.sendTaxi) NetClient.sendTaxi(action, extra);
          },
          sendRevive: function (targetId, pct) {
            if (typeof NetClient !== 'undefined' && NetClient.sendInteract) NetClient.sendInteract(targetId, 'revive', { minigamePct: pct });
          },
          getOnlineVehicle: function () { return onlineVehicles; },
          getTaxiCustomers: function () { return onlineTaxiCustomers; },
          getWorldTime: function () { return worldTime; },
          sys: function (msg) { appendChatLog('', '', msg, true); },
          economy: (typeof Economy !== 'undefined') ? Economy : null
        });
      }
    } catch (e) { console.warn('[jobs] init failed:', e); }
    // TEST MODE (?test=1): dev panel for free money / speed / heal.
    // Hidden entirely unless the URL has ?test=1.
    try { initTestMode(); } catch (e) { console.warn('[test] init failed:', e); }
    faintPanelEl = document.getElementById('faintPanel');
    faintTextEl = document.getElementById('faintText');
    hospitalBtnEl = document.getElementById('hospitalBtn');
    if (hospitalBtnEl) hospitalBtnEl.addEventListener('click', function () {
      if (!playerState.isFainted) return;
      sfx('click');
      if (netMode === 'online' && typeof NetClient !== 'undefined' && NetClient.connected) {
        NetClient.sendInteract(null, 'hospital');
      } else {
        offlineHospitalRevive('button');
      }
    });
    // M3 skills revision (audio-gen): SFX mute toggle, persisted in
    // localStorage via DTA_SFX. Label mirrors the CHS pattern (🔊/🔇).
    (function () {
      var b = document.getElementById('sfxBtn');
      if (!b || typeof DTA_SFX === 'undefined') return;
      var sync = function () {
        b.textContent = DTA_SFX.enabled ? '🔊' : '🔇';
        b.classList.toggle('off', !DTA_SFX.enabled);
      };
      b.addEventListener('click', function () {
        var on = DTA_SFX.toggle();
        sync();
        if (on) sfx('click');
      });
      sync();
    })();
    // Rename+VFX: VFX toggle, same pattern as the SFX toggle above.
    // Persisted in localStorage via DTA_VFX ('dta_vfx').
    (function () {
      var b = document.getElementById('vfxBtn');
      if (!b || typeof DTA_VFX === 'undefined') return;
      var sync = function () {
        b.textContent = DTA_VFX.enabled ? '✨' : '✖';
        b.classList.toggle('off', !DTA_VFX.enabled);
      };
      b.addEventListener('click', function () {
        DTA_VFX.toggle();
        sync();
      });
      sync();
    })();
    // VEHICLES FIX (2026-11-25): contextual LÊN XE / XUỐNG XE button —
    // same mount/dismount path as the E key (Jobs handles online + offline).
    (function () {
      var b = document.getElementById('rideBtn');
      if (!b) return;
      b.addEventListener('click', function () {
        if (typeof Jobs === 'undefined') return;
        if (currentRidingId()) Jobs.dismountCurrent();
        else Jobs.mountNearest();
        sfx('click');
      });
    })();
    initNet(); // async, non-blocking: online if a server answers, else offline

    window.addEventListener('keydown', function (e) {
      // typing in any DOM input (chat, auth, ATM) must not move the character
      var activeTag = document.activeElement && document.activeElement.tagName;
      if (chatInputFocused || activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      // Esc closes the chat panel from anywhere
      if (e.code === 'Escape' && chatOpen) { e.preventDefault(); closeChat(); return; }
      // Enter opens the chat (or focuses it when already open)
      if (e.code === 'Enter' && started) {
        e.preventDefault();
        if (chatOpen) { if (chatEls.input) chatEls.input.focus(); }
        else openChat();
        return;
      }
      // M4 (§8.1): E mounts / dismounts the nearest owned vehicle.
      if (e.code === 'KeyE' && started && !e.repeat) {
        if (typeof Jobs !== 'undefined') {
          if (playerState.vehicleId) Jobs.dismountCurrent();
          else Jobs.mountNearest();
        }
        return;
      }
      keys[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });
    window.addEventListener('pointerup', function (e) { clearLongPress(); if (joy.active) endJoy(); handleTap(e); });
    window.addEventListener('pointermove', function (e) {
      if (joy.active) updateJoy(e);
      if (longPressPos && Math.hypot(e.clientX - longPressPos.sx, e.clientY - longPressPos.sy) > 14) clearLongPress();
      if (tapDown && Math.hypot(e.clientX - tapDown.sx, e.clientY - tapDown.sy) > 14) tapDown = null;
    });
    window.addEventListener('resize', function () { updateCamera(); layoutHUD(); });

    // pinch-to-zoom (touch): two fingers on the world, camera stays on player
    window.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch' || chatOpen) return;
      pinchPointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pinchPointers);
      if (ids.length === 2 && !joy.active) {
        pinchActive = true;
        var a = pinchPointers[ids[0]], b = pinchPointers[ids[1]];
        pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y);
        pinchStartZoom = zoom;
        clearLongPress();
      }
    });
    window.addEventListener('pointermove', function (e) {
      if (!pinchPointers[e.pointerId]) return;
      pinchPointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pinchActive) {
        var ids = Object.keys(pinchPointers);
        if (ids.length >= 2) {
          var a = pinchPointers[ids[0]], b = pinchPointers[ids[1]];
          var d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d > 0 && pinchStartDist > 0) setZoom(pinchStartZoom * d / pinchStartDist);
        }
      }
    });
    var pinchEnd = function (e) {
      delete pinchPointers[e.pointerId];
      if (Object.keys(pinchPointers).length < 2) pinchActive = false;
    };
    window.addEventListener('pointerup', pinchEnd);
    window.addEventListener('pointercancel', pinchEnd);

    updateCamera();
    layoutHUD();
    updateHUD();
    drawMinimap();

    app.ticker.add(function (ticker) {
      var dt = Math.min(0.05, ticker.deltaMS / 1000);
      fpsCount++;
      fpsTimer += ticker.deltaMS;
      if (fpsTimer >= 500) {
        fpsValue = Math.round(fpsCount / (fpsTimer / 1000));
        fpsCount = 0; fpsTimer = 0;
        if (hudRefs.fpsT) hudRefs.fpsT.text = fpsValue + ' FPS';
        if (testMode) syncTestPanel(); // TEST MODE: buttons follow online/offline
      }
      // clock: 1 game minute per real second (offline only — online the
      // server worldTime is authoritative, via onWorldTime). A wrap past
      // midnight starts a new game day (worldDay, shown in the clock).
      if (netMode !== 'online') {
        var nextTime = worldTime + dt;
        if (nextTime >= DAY_MINUTES) worldDay++;
        worldTime = nextTime % DAY_MINUTES;
      }
      var hour = Math.floor(worldTime / 60) % 24;
      var dark = darknessFor(hour);
      nightOverlay.alpha = dark;
      lampGlows.forEach(function (g) { g.visible = dark > 0.05; g.alpha = dark > 0.05 ? 1 : 0; });

      if (started) {
        updatePlayer(dt);
        updateNPCs(dt);
        updateAnimals(dt);
        updateTraffic(dt); // ambient cars/motorbikes on the roads
        RoadRender.updateSignals(signalLayer, signalNow());
        updateRemotePlayers(dt);
        updateTaxiCustomerSprites();
        updateTalkHint(); // TAP-TO-TALK: floating 💬 above the nearest in-range NPC/player
        syncParkedVehicles(); // VEHICLES FIX: draw owned parked bikes at their spots
        syncRideSprite(); // VEHICLES FIX: bike sprite under the player while riding
        updateRideButton(); // VEHICLES FIX: contextual LÊN XE / XUỐNG XE button
        moveTick(dt);
        // M3: offline Shipper countdown/expiry, delivery arrow, faint panel.
        if (typeof Jobs !== 'undefined' && Jobs.tick) Jobs.tick(dt);
        updateOrderArrow();
        updateFaintPanel();
      }
      updateCamera();
      // Rename+VFX: night glow pools follow the clock; particles, rain,
      // the dashed path and the shake update AFTER updateCamera() so the
      // shake offset is transient (updateCamera resets world.x/y each
      // frame). The delivery arrow pulses while an order is active
      // (Godot-VFX juice: a static arrow reads as dead UI).
      if (typeof DTA_VFX !== 'undefined') {
        try {
          DTA_VFX.setNight(dark);
          DTA_VFX.tick(dt, {
            hour: hour,
            view: {
              left: -world.x / scale, top: -world.y / scale,
              right: (-world.x + app.renderer.width) / scale,
              bottom: (-world.y + app.renderer.height) / scale
            },
            playerX: playerState.x, playerY: playerState.y,
            order: currentOrder(),
            faint: playerState.isFainted ? { x: playerState.x, y: playerState.y } : null
          });
          if (orderArrow && currentOrder()) orderArrow.alpha = 0.7 + 0.3 * Math.sin(performance.now() / 150);
          else if (orderArrow) orderArrow.alpha = 1;
        } catch (e) { /* VFX must never crash the game */ }
      }
      updateCulling();
      updateHUD();
      minimapTimer += ticker.deltaMS;
      if (minimapTimer > 250) { minimapTimer = 0; drawMinimap(); }
    });
  }

  boot().catch(function (err) {
    console.error('[M0] boot failed:', err);
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;background:#222;color:#fff;font-family:sans-serif;padding:40px;text-align:center;z-index:20';
    d.textContent = 'Không khởi động được game: ' + (err && err.message ? err.message : err);
    document.body.appendChild(d);
  });
})();
