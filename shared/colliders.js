/* Cuộc Sống Ảo — shared/colliders.js
   Single source of truth for map collision data, shared by client (browser)
   and server (Node). Map v2 (2026-11-25, assets/v3/MAP_V3_DESIGN.md):
   4800x4800, roads 180px wide at 1140/2340/3540 with 40px sidewalks,
   22 buildings, central plaza (2070,2070,660,660) with a blocking fountain
   circle r=90, spawn (2400,2625), and 2 fenced flower gardens whose
   perimeters block movement EXCEPT at the listed corner gaps (future
   Shipper / thief missions use the gaps — never fence them shut).
   NO Node-only code in this file: it must load via <script> in the browser
   and via require() in Node. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./roadnet'));
  else root.Colliders = factory(root.RoadNet);
})(typeof self !== 'undefined' ? self : this, function (RoadNet) {
  'use strict';

  var MAP_W = 4800, MAP_H = 4800;
  var ROAD_W = RoadNet.ROAD_W, SIDEWALK_W = RoadNet.SIDEWALK_W;

  var PLAZA = RoadNet.PLAZA;                                   // Quảng Trường (trong đường vòng)
  var FOUNTAIN = { x: RoadNet.CENTER.x, y: RoadNet.CENTER.y, r: 90 }; // blocking circle
  var SPAWN = { x: 2430, y: 2650 };                            // plaza south edge
  var GUIDE_POS = { x: 2430, y: 2545 };                        // NPC Hướng Dẫn
  var inRoad = RoadNet.inRoad;

  // Map v2 §3: 7 original POIs kept (v2.1 coords x1.5) + police / school /
  // cafe / pavilion / market / 3 extra houses. Sprite column is in
  // src/main.js BUILDING_TEX (roof crops for bank/shop/showroom/house-b/c).
  var BUILDINGS = [
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
    // Render fix 2026-11-25: school was (900,4200) — overlapped the vertical
    // road band [1140,1320] by 180px; pavilion was (3600,600) — overlapped
    // the vertical road band [3540,3720] by 120px. Both moved clear of roads.
    { id: 'school',    name: 'Trường Học',             x: 180,  y: 4240, w: 600, h: 420, color: 0xf5b7b1, roof: 0xec7063 },
    { id: 'cafe',      name: 'Quán Cà Phê',            x: 2580, y: 4230, w: 360, h: 300, color: 0xa67c52, roof: 0x6e4b2a },
    { id: 'pavilion',  name: 'Nhà Vọng Cảnh',          x: 4390, y: 600,  w: 300, h: 300, color: 0x7dcea0, roof: 0x2e86c1 },
    // Render fix 2026-11-25: house10/house11 were (4200,1425)/(4200,2670) —
    // overlapping the hospital (ends x4410) and warehouse (ends x4470) by
    // 210/270px; house12/cafe overlapped house8/house9 by a 30px strip at
    // y4200-4230. Moved to the free south-east block / +30px south.
    { id: 'house10',   name: 'Nhà Dân',                x: 3840, y: 4320, w: 390, h: 300, color: 0xf1c40f, roof: 0xd4ac0d },
    { id: 'house11',   name: 'Nhà Dân',                x: 4290, y: 4320, w: 390, h: 300, color: 0x82e0aa, roof: 0x229954 },
    { id: 'house12',   name: 'Chung Cư',               x: 1500, y: 4230, w: 480, h: 360, color: 0xaed6f1, roof: 0x5dade2 }
  ];

  // Map v2 §4: garden fences, 12px thick, blocking EXCEPT at the corner
  // gaps. Garden A (600,2400,600,420): gaps NW (600-680, 2400-2480) and SE
  // (1120-1200, 2740-2820). Garden B (3000,600,600,420): gaps NE
  // (3420-3600, 600-680) and SW (3000-3080, 940-1020). The gaps are the
  // shortcuts for future missions — the rects below deliberately STOP
  // short of them; do not "complete" the perimeter.
  var FENCES = [
    // Garden A (440,3050,600,420): cửa NW và SE
    { id: 'A-north', x: 520,  y: 3050, w: 520, h: 12 },
    { id: 'A-south', x: 440,  y: 3458, w: 520, h: 12 },
    { id: 'A-west',  x: 440,  y: 3130, w: 12,  h: 340 },
    { id: 'A-east',  x: 1028, y: 3050, w: 12,  h: 340 },
    // Garden B (2860,600,600,420): cửa NE và SW
    { id: 'B-north', x: 2860, y: 600,  w: 420, h: 12 },
    { id: 'B-south', x: 2940, y: 1008, w: 520, h: 12 },
    { id: 'B-west',  x: 2860, y: 600,  w: 12,  h: 340 },
    { id: 'B-east',  x: 3448, y: 680,  w: 12,  h: 340 }
  ];
  var GARDENS = [
    { id: 'A', x: 440, y: 3050, w: 600, h: 420,
      entries: [{ x: 440, y: 3050, w: 80, h: 80 }, { x: 960, y: 3390, w: 80, h: 80 }] },
    { id: 'B', x: 2860, y: 600, w: 600, h: 420,
      entries: [{ x: 3280, y: 600, w: 180, h: 80 }, { x: 2860, y: 940, w: 80, h: 80 }] }
  ];
  // Map v2 §7: animal spawns (visual only for now — no gameplay yet).
  var ANIMALS = {
    dogs: [{ x: 750, y: 2900 }, { x: 3250, y: 1920 }],
    cats: [{ x: 750, y: 900 }, { x: 4100, y: 3350 }]
  };

  // Player hitbox is 32x32 (SRS §7.3); r = half-size used by callers (16).
  function hitBuilding(x, y, r) {
    for (var i = 0; i < BUILDINGS.length; i++) {
      var b = BUILDINGS[i];
      if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return true;
    }
    return false;
  }

  function hitFence(x, y, r) {
    for (var i = 0; i < FENCES.length; i++) {
      var f = FENCES[i];
      if (x + r > f.x && x - r < f.x + f.w && y + r > f.y && y - r < f.y + f.h) return true;
    }
    return false;
  }

  function inFountain(x, y, r) {
    var dx = x - FOUNTAIN.x, dy = y - FOUNTAIN.y;
    return dx * dx + dy * dy < (FOUNTAIN.r + (r || 0)) * (FOUNTAIN.r + (r || 0));
  }

  function inPlaza(x, y) {
    return x >= PLAZA.x && x <= PLAZA.x + PLAZA.w && y >= PLAZA.y && y <= PLAZA.y + PLAZA.h;
  }

  // Điểm đi bộ hợp lệ (giao hàng / spawn): không phải lòng đường, không nằm
  // trong nhà, hàng rào hay đài phun nước.
  function isOpenPoint(x, y) {
    if (x < 40 || y < 40 || x > MAP_W - 40 || y > MAP_H - 40) return false;
    if (inFountain(x, y, 24)) return false;
    if (inRoad(x, y)) return false;
    if (hitBuilding(x, y, 24)) return false;
    if (hitFence(x, y, 24)) return false;
    return true;
  }

  // randFn: () => [0,1). Defaults to Math.random. Tries 60 points, falls back
  // to the spawn plaza so callers always get a usable point.
  function randomOpenPoint(randFn) {
    var rnd = randFn || Math.random;
    for (var i = 0; i < 60; i++) {
      var x = 60 + rnd() * (MAP_W - 120), y = 60 + rnd() * (MAP_H - 120);
      if (isOpenPoint(x, y)) return { x: x, y: y };
    }
    return { x: SPAWN.x, y: SPAWN.y };
  }

  return {
    MAP_W: MAP_W, MAP_H: MAP_H, ROAD_W: ROAD_W,
    SIDEWALK_W: SIDEWALK_W, BUILDINGS: BUILDINGS, FENCES: FENCES,
    GARDENS: GARDENS, PLAZA: PLAZA, FOUNTAIN: FOUNTAIN, SPAWN: SPAWN,
    GUIDE_POS: GUIDE_POS, ANIMALS: ANIMALS,
    inRoad: inRoad, hitBuilding: hitBuilding, hitFence: hitFence,
    inFountain: inFountain, inPlaza: inPlaza,
    isOpenPoint: isOpenPoint, randomOpenPoint: randomOpenPoint
  };
});
