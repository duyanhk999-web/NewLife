/* Cuộc Sống Ảo — shared/props.js
   Solid street props: every non-building object the player can bump into
   (trees, lamps, bushes, benches, parked cars/bikes, tables, stools,
   food carts, market stalls, bins, bags, power poles, boxes).
   Single source of truth for client (browser) and server (Node): both sides
   call hitProp() with the same data, so the client never predicts through
   an object the server blocks (and vice versa).
   - TREES: baked 2026-11-28 from the EXACT client rand sequence
     (mulberry32(20261124) -> 500 grass iterations -> treeSpots(60, rand)),
     so they match the trees src/main.js buildWorld() draws pixel for
     pixel. If buildWorld ever changes the rand consumption before
     treeSpots(), re-bake with the generator script (kept in the agent
     scratch dir, method: same seed + grass loop + treeSpots from
     src/roadrender.js). Verified at bake time: 60 spots, 0 violating map
     constraints, min pairwise distance 92px.
   - STATIC_PROPS: transcribed from the fixed propSprite() calls in
     src/main.js buildWorld() — same coordinates the client draws.
   - lampSpots(): moved here from src/roadrender.js (pure function of the
     road graph, no randomness) — roadrender.js delegates to it so there is
     exactly one implementation.
   Entries are {x, y, r} circles or {x, y, w, h} axis-aligned rects
   (centred). Radii/sizes match the drawn sprite sizes.
   NO Node-only code: loads via <script> and via require(). */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./roadnet'));
  else root.Props = factory(root.RoadNet);
})(typeof self !== 'undefined' ? self : this, function (RoadNet) {
  'use strict';

  // Trees (baked — see header). Trunk collision radius 12px regardless of
  // the drawn canopy width (56-90px): the trunk is what blocks walking.
  var TREE_R = 12;
  var TREES = [
    [1017, 127], [393, 978], [2175, 4477], [653, 120], [4418, 266],
    [2913, 4699], [4713, 306], [774, 1698], [1019, 2030], [3379, 89],
    [766, 4044], [1769, 4690], [2183, 4377], [1589, 2943], [863, 1993],
    [1442, 862], [755, 293], [1773, 776], [895, 4355], [3191, 2986],
    [583, 745], [3361, 233], [4013, 2174], [2074, 913], [3927, 3224],
    [4480, 182], [1523, 4719], [4556, 2019], [3088, 4470], [555, 2007],
    [4643, 1960], [85, 2182], [2030, 597], [3947, 1963], [535, 2166],
    [227, 1834], [953, 941], [4678, 4104], [1557, 2173], [704, 2988],
    [1604, 1933], [428, 1814], [2057, 3977], [810, 1002], [223, 1963],
    [3171, 2162], [909, 4110], [3151, 2903], [850, 308], [3215, 1803],
    [850, 618], [4557, 2218], [1966, 1673], [876, 849], [4648, 1858],
    [2930, 3304], [1011, 4647], [2160, 1686], [737, 2824], [4222, 4717]
  ];

  // Lamp posts (thin poles, base at the lampSpots point).
  var LAMP_R = 8;
  // đèn đường: mép ngoài vỉa hè, cách nhau ~400px, tránh giao lộ
  // (moved from src/roadrender.js — pure function of the road graph).
  function lampSpots() {
    var out = [];
    var HALF = RoadNet.ROAD_W / 2;
    RoadNet.SEGMENTS.forEach(function (s) {
      var a = RoadNet.NODES[s.a], b = RoadNet.NODES[s.b];
      var len = Math.hypot(b.x - a.x, b.y - a.y);
      var ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      var off = HALF + RoadNet.SIDEWALK_W - 6;
      for (var d = 300, i = 0; d < len - 260; d += 400, i++) {
        var side = i % 2 ? 1 : -1;
        out.push({ x: a.x + ux * d - uy * off * side, y: a.y + uy * d + ux * off * side });
      }
    });
    return out;
  }

  // Fixed props transcribed from src/main.js buildWorld() propSprite calls.
  // {x, y, r} = circle, {x, y, w, h} = axis-aligned rect (centred).
  // A few sit inside building rects already blocked by hitBuilding
  // (e.g. market stalls, ambulance) — listed anyway so the table mirrors
  // what is drawn; the check is the same either way.
  var STATIC_PROPS = [
    // bushes in the flower gardens (w56)
    { kind: 'bush', x: 590, y: 3200, r: 22 }, { kind: 'bush', x: 890, y: 3350, r: 22 },
    { kind: 'bush', x: 740, y: 3300, r: 22 }, { kind: 'bush', x: 3010, y: 750, r: 22 },
    { kind: 'bush', x: 3310, y: 900, r: 22 },
    // benches: plaza x4 + gardens (w56)
    { kind: 'bench', x: 2160, y: 2330, w: 56, h: 22 }, { kind: 'bench', x: 2700, y: 2330, w: 56, h: 22 },
    { kind: 'bench', x: 2160, y: 2540, w: 56, h: 22 }, { kind: 'bench', x: 2700, y: 2540, w: 56, h: 22 },
    { kind: 'bench', x: 540, y: 3400, w: 56, h: 22 }, { kind: 'bench', x: 940, y: 3130, w: 56, h: 22 },
    { kind: 'bench', x: 3060, y: 950, w: 56, h: 22 },
    // parked cars (decorative, w90) + specialty vehicles at POIs
    { kind: 'car', x: 4000, y: 1920, w: 90, h: 40 }, { kind: 'car', x: 3900, y: 1010, w: 90, h: 40 },
    { kind: 'car', x: 2750, y: 3300, w: 90, h: 40 },
    { kind: 'carPolice', x: 4000, y: 840, w: 60, h: 30 },
    { kind: 'carAmbulance', x: 4125, y: 1710, w: 65, h: 32 },
    { kind: 'carTruck', x: 4100, y: 2980, w: 70, h: 34 },
    { kind: 'carTaxi', x: 2750, y: 4320, w: 55, h: 28 },
    // showroom decorative motorbikes (w44)
    { kind: 'bike', x: 1960, y: 3140, w: 44, h: 20 }, { kind: 'bike', x: 1960, y: 3200, w: 44, h: 20 },
    { kind: 'bike', x: 1960, y: 3260, w: 44, h: 20 },
    // sidewalk tea tables + plastic stools (w32 / w16)
    { kind: 'teaTable', x: 2700, y: 4420, r: 14 }, { kind: 'teaTable', x: 2760, y: 2760, r: 14 },
    { kind: 'stool', x: 2685, y: 4420, r: 8 }, { kind: 'stool', x: 2715, y: 4420, r: 8 },
    { kind: 'stool', x: 2700, y: 4405, r: 8 }, { kind: 'stool', x: 2700, y: 4435, r: 8 },
    { kind: 'stool', x: 2745, y: 2760, r: 8 }, { kind: 'stool', x: 2775, y: 2760, r: 8 },
    { kind: 'stool', x: 2760, y: 2745, r: 8 },
    // street-food carts (w44) + market stalls (w52)
    { kind: 'banhMiCart', x: 2160, y: 2760, w: 44, h: 26 }, { kind: 'banhMiCart', x: 4080, y: 4120, w: 44, h: 26 },
    { kind: 'marketStall', x: 4160, y: 4120, w: 52, h: 30 }, { kind: 'marketStall', x: 4220, y: 4120, w: 52, h: 30 },
    // trash bins (w22/w30) + trash bags (w18)
    { kind: 'trashBin', x: 2110, y: 2760, r: 10 }, { kind: 'trashBin', x: 3200, y: 1600, r: 10 },
    { kind: 'bin', x: 3250, y: 1770, r: 12 }, { kind: 'bin', x: 4100, y: 3815, r: 12 },
    { kind: 'bin', x: 2700, y: 2260, r: 12 }, { kind: 'bin', x: 900, y: 3000, r: 12 },
    { kind: 'bin', x: 3250, y: 560, r: 12 },
    { kind: 'trashBag', x: 2125, y: 2765, r: 8 }, { kind: 'trashBag', x: 3215, y: 1605, r: 8 },
    // power poles (w32, thin pole) — on the OUTER sidewalk corners of the
    // ring-road intersections (120px off each centerline), clear of the road
    { kind: 'powerPole', x: 1830, y: 1830, r: 8 }, { kind: 'powerPole', x: 3030, y: 1830, r: 8 },
    { kind: 'powerPole', x: 1830, y: 3030, r: 8 }, { kind: 'powerPole', x: 3030, y: 3030, r: 8 },
    // delivery boxes at the warehouse dock (w40)
    { kind: 'box', x: 3900, y: 3200, w: 36, h: 36 }, { kind: 'box', x: 3980, y: 3200, w: 36, h: 36 }
  ];

  // Flat list (built once): static props + trees + lamps, all as circles
  // or rects. Callers use hitProp(); the list is exported for tests.
  var ALL = null;
  function allProps() {
    if (ALL) return ALL;
    ALL = STATIC_PROPS.slice();
    for (var i = 0; i < TREES.length; i++) ALL.push({ kind: 'tree', x: TREES[i][0], y: TREES[i][1], r: TREE_R });
    var lamps = lampSpots();
    for (var j = 0; j < lamps.length; j++) ALL.push({ kind: 'lamp', x: lamps[j].x, y: lamps[j].y, r: LAMP_R });
    return ALL;
  }

  // Circle (x, y, r) vs one prop entry. Rects are axis-aligned + centred.
  function hitOne(x, y, r, p) {
    if (p.r !== undefined) {
      var dx = x - p.x, dy = y - p.y, rr = r + p.r;
      return dx * dx + dy * dy < rr * rr;
    }
    var cx = Math.max(p.x - p.w / 2, Math.min(x, p.x + p.w / 2));
    var cy = Math.max(p.y - p.h / 2, Math.min(y, p.y + p.h / 2));
    var ddx = x - cx, ddy = y - cy;
    return ddx * ddx + ddy * ddy < r * r;
  }

  // True when the circle (x, y, r) overlaps any solid prop.
  function hitProp(x, y, r) {
    var list = allProps();
    for (var i = 0; i < list.length; i++) {
      if (hitOne(x, y, r, list[i])) return true;
    }
    return false;
  }

  return {
    TREES: TREES, TREE_R: TREE_R, LAMP_R: LAMP_R,
    STATIC_PROPS: STATIC_PROPS, allProps: allProps,
    lampSpots: lampSpots, hitProp: hitProp
  };
});
