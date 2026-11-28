/* Cuộc Sống Ảo — shared/roadnet.js
   Mạng đường dùng chung cho client và server: lòng đường, vỉa hè, vạch qua
   đường, đèn tín hiệu, người đi bộ, xe cộ. Không phụ thuộc PIXI hay Node.

   - Xe chỉ chạy theo đồ thị đường (SEGMENTS), bên phải, dừng trước vạch.
   - Người đi bộ chỉ đi theo đồ thị vỉa hè; muốn qua đường phải đi trên vạch
     và chờ pha đèn dành cho người đi bộ.
   - Đèn tính thuần từ thời gian (ms) nên client/server tự khớp nhau.
   - Quảng trường nằm trong đường vòng: không có đoạn đường nào cắt qua. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.RoadNet = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Seeded RNG (same algorithm as src/main.js) — the server creates its
  // traffic with a fixed seed so the sim is reproducible across restarts.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var MAP = 4800;
  var ROAD_W = 180, SIDEWALK_W = 60;
  var HALF = ROAD_W / 2;
  var LANE = 45;                       // tim làn cách tim đường
  var WALK_OFF = HALF + SIDEWALK_W / 2; // tim vỉa hè cách tim đường (120)
  var CROSS_W = 50;                    // bề rộng vạch qua đường
  var STOP_D = 155;                    // vạch dừng cách tâm giao lộ
  var BOX = 170;                       // xe rời làn thẳng, bắt đầu rẽ

  var CENTER = { x: 2430, y: 2430 };
  var RING = 480;                      // nửa cạnh đường vòng quanh quảng trường
  var PLAZA = { x: 2100, y: 2100, w: 660, h: 660 };

  // ---------- đồ thị đường ----------
  var NODES = {};
  var SEGMENTS = [];
  function node(id, x, y) { NODES[id] = { id: id, x: x, y: y, arms: {} }; }
  function dirOf(a, b) {
    if (b.x > a.x) return 'E';
    if (b.x < a.x) return 'W';
    return b.y > a.y ? 'S' : 'N';
  }
  function chain(ids) {
    for (var i = 0; i + 1 < ids.length; i++) {
      var a = NODES[ids[i]], b = NODES[ids[i + 1]];
      var seg = { a: a.id, b: b.id, axis: a.y === b.y ? 'h' : 'v' };
      SEGMENTS.push(seg);
      a.arms[dirOf(a, b)] = b.id;
      b.arms[dirOf(b, a)] = a.id;
    }
  }
  var G = [1230, 2430, 3630];
  var lo = CENTER.x - RING, hi = CENTER.x + RING; // 1950 / 2910
  [1230, 3630].forEach(function (x) { G.forEach(function (y) { node(x + ',' + y, x, y); }); });
  node('2430,1230', 2430, 1230); node('2430,3630', 2430, 3630);
  [[lo, lo], [2430, lo], [hi, lo], [hi, 2430], [hi, hi], [2430, hi], [lo, hi], [lo, 2430]]
    .forEach(function (p) { node(p[0] + ',' + p[1], p[0], p[1]); });
  G.forEach(function (v) {
    node('top' + v, v, 0); node('bot' + v, v, MAP);
    node('left' + v, 0, v); node('right' + v, MAP, v);
  });
  // 2 đại lộ ngoài mỗi chiều chạy suốt bản đồ
  [1230, 3630].forEach(function (x) {
    chain(['top' + x, x + ',1230', x + ',2430', x + ',3630', 'bot' + x]);
    chain(['left' + x, '1230,' + x, '2430,' + x, '3630,' + x, 'right' + x]);
  });
  // 2 trục giữa DỪNG ở đường vòng (không còn cắt quảng trường)
  chain(['top2430', '2430,1230', '2430,1950']);
  chain(['2430,2910', '2430,3630', 'bot2430']);
  chain(['left2430', '1230,2430', '1950,2430']);
  chain(['2910,2430', '3630,2430', 'right2430']);
  // đường vòng
  chain(['1950,1950', '2430,1950', '2910,1950']);
  chain(['2910,1950', '2910,2430', '2910,2910']);
  chain(['1950,2910', '2430,2910', '2910,2910']);
  chain(['1950,1950', '1950,2430', '1950,2910']);

  Object.keys(NODES).forEach(function (id) {
    var n = NODES[id];
    n.degree = Object.keys(n.arms).length;
    n.signal = n.degree >= 3;
  });
  var SIGNALS = Object.keys(NODES).filter(function (id) { return NODES[id].signal; });

  // Hình chữ nhật lòng đường / vỉa hè (để vẽ, va chạm, minimap)
  function bandRects(half) {
    return SEGMENTS.map(function (s) {
      var a = NODES[s.a], b = NODES[s.b];
      var x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
      var y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      var x = x0 - half, y = y0 - half, w = x1 - x0 + 2 * half, h = y1 - y0 + 2 * half;
      var cx = Math.max(0, x), cy = Math.max(0, y);
      return { x: cx, y: cy, w: Math.min(MAP, x + w) - cx, h: Math.min(MAP, y + h) - cy };
    });
  }
  var ROAD_RECTS = bandRects(HALF);
  var SIDEWALK_RECTS = bandRects(HALF + SIDEWALK_W);
  function inRects(list, x, y) {
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
    }
    return false;
  }
  function inRoad(x, y) { return inRects(ROAD_RECTS, x, y); }
  function inSidewalk(x, y) { return !inRoad(x, y) && inRects(SIDEWALK_RECTS, x, y); }

  // ---------- đèn tín hiệu ----------
  var G_T = 8000, Y_T = 2000, R_T = 2000, WALK_T = 6000; // vàng + đỏ chung = 4 s để xe thoát giao lộ
  var PHASES = [
    { ms: G_T, h: 'green', v: 'red', ped: false },
    { ms: Y_T, h: 'yellow', v: 'red', ped: false },
    { ms: R_T, h: 'red', v: 'red', ped: false },
    { ms: G_T, h: 'red', v: 'green', ped: false },
    { ms: Y_T, h: 'red', v: 'yellow', ped: false },
    { ms: R_T + 1500, h: 'red', v: 'red', ped: false }, // dọn giao lộ trước khi người đi bộ qua
    { ms: WALK_T, h: 'red', v: 'red', ped: true },  // mọi xe đỏ, người đi bộ xanh
    { ms: R_T, h: 'red', v: 'red', ped: false }
  ];
  var CYCLE = PHASES.reduce(function (s, p) { return s + p.ms; }, 0);
  function signalState(nodeId, now) {
    var n = NODES[nodeId];
    var offset = ((n.x + n.y) / 1200 % 4) * 3500; // lệch pha giữa các ngã tư
    var t = (((now + offset) % CYCLE) + CYCLE) % CYCLE;
    for (var i = 0; i < PHASES.length; i++) {
      var p = PHASES[i];
      if (t < p.ms) return { h: p.h, v: p.v, ped: p.ped, left: p.ms - t, phase: i };
      t -= p.ms;
    }
  }

  // ---------- đồ thị vỉa hè ----------
  var PED = [];      // {id,x,y,links:[{to,cross:null|nodeId}]}
  var pedIndex = {};
  function clampMap(v) { return Math.max(30, Math.min(MAP - 30, v)); }
  function ped(key, x, y) {
    if (pedIndex[key] === undefined) {
      pedIndex[key] = PED.length;
      PED.push({ id: PED.length, x: clampMap(x), y: clampMap(y), links: [] });
    }
    return pedIndex[key];
  }
  function corner(nodeId, qx, qy) {
    var n = NODES[nodeId];
    return ped(nodeId + ':' + qx + ',' + qy, n.x + qx * WALK_OFF, n.y + qy * WALK_OFF);
  }
  function link(i, j, cross) {
    if (i === j) return;
    PED[i].links.push({ to: j, cross: cross || null });
    PED[j].links.push({ to: i, cross: cross || null });
  }
  // vỉa hè hai bên mỗi đoạn đường
  SEGMENTS.forEach(function (s) {
    var a = NODES[s.a], b = NODES[s.b];
    [-1, 1].forEach(function (side) {
      if (s.axis === 'h') link(corner(a.id, 1, side), corner(b.id, -1, side));
      else link(corner(a.id, side, 1), corner(b.id, side, -1));
    });
  });
  // tại nút: cạnh không có đường -> nối liền vỉa hè; có đường -> vạch qua đường
  var SIDES = { N: [[-1, -1], [1, -1]], S: [[-1, 1], [1, 1]], W: [[-1, -1], [-1, 1]], E: [[1, -1], [1, 1]] };
  var CROSSWALKS = [];
  Object.keys(NODES).forEach(function (id) {
    var n = NODES[id];
    if (n.degree < 2) return; // đầu đường ở mép bản đồ
    Object.keys(SIDES).forEach(function (d) {
      var q = SIDES[d];
      var i = corner(id, q[0][0], q[0][1]), j = corner(id, q[1][0], q[1][1]);
      if (!n.arms[d]) link(i, j);
      else if (n.signal) {
        link(i, j, id);
        CROSSWALKS.push({ node: id, side: d, x1: PED[i].x, y1: PED[i].y, x2: PED[j].x, y2: PED[j].y });
      }
    });
  });
  // quảng trường: vòng đi bộ quanh đài phun nước + 4 lối vào từ vỉa hè trong
  var ring = [];
  for (var k = 0; k < 8; k++) {
    var ang = -Math.PI / 2 + k * Math.PI / 4;
    ring.push(ped('plaza' + k, CENTER.x + Math.cos(ang) * 200, CENTER.y + Math.sin(ang) * 200));
  }
  for (var m = 0; m < 8; m++) link(ring[m], ring[(m + 1) % 8]);
  [['2430,1950', 'S', 0], ['2910,2430', 'W', 2], ['2430,2910', 'N', 4], ['1950,2430', 'E', 6]]
    .forEach(function (e) {
      var q = SIDES[e[1]];
      var i = corner(e[0], q[0][0], q[0][1]), j = corner(e[0], q[1][0], q[1][1]);
      var mid = ped('entry' + e[2], (PED[i].x + PED[j].x) / 2, (PED[i].y + PED[j].y) / 2);
      // tách cạnh i-j thành i-mid-j
      PED[i].links = PED[i].links.filter(function (l) { return l.to !== j; });
      PED[j].links = PED[j].links.filter(function (l) { return l.to !== i; });
      link(i, mid); link(mid, j); link(mid, ring[e[2]]);
    });

  // ---------- người đi bộ ----------
  function nearestPed(x, y) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < PED.length; i++) {
      var d = Math.hypot(PED[i].x - x, PED[i].y - y);
      if (PED[i].links.length && d < bd) { bd = d; best = i; }
    }
    return best;
  }
  // opts: {speed, rnd, home:{x,y}, radius, pause:false}
  function createWalker(startId, opts) {
    opts = opts || {};
    var p = PED[startId];
    return {
      x: p.x, y: p.y, at: startId, to: null, prev: null, cross: null,
      speed: opts.speed || 90, rnd: opts.rnd || Math.random,
      home: opts.home || null, radius: opts.radius || 0,
      canPause: opts.pause !== false, pauseUntil: 0, waiting: false,
      offset: (opts.rnd || Math.random)() * 24 - 12 // không đi chồng khít lên nhau
    };
  }
  function pickLink(w) {
    var links = PED[w.at].links;
    var choices = links.filter(function (l) { return l.to !== w.prev; });
    if (!choices.length) choices = links;
    if (w.home && w.radius) {
      var here = PED[w.at];
      var d0 = Math.hypot(here.x - w.home.x, here.y - w.home.y);
      if (d0 > w.radius) { // đi quá xa: chọn hướng quay về
        choices = links.slice().sort(function (a, b) {
          return Math.hypot(PED[a.to].x - w.home.x, PED[a.to].y - w.home.y) -
                 Math.hypot(PED[b.to].x - w.home.x, PED[b.to].y - w.home.y);
        }).slice(0, 1);
      }
    }
    return choices[Math.floor(w.rnd() * choices.length)];
  }
  // lệch ngang trên vỉa hè (không áp dụng khi đang ở trên vạch)
  function laneShift(w, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len * w.offset, y: dx / len * w.offset };
  }
  function stepWalker(w, dt, now) {
    if (now < w.pauseUntil) return w;
    if (w.to === null) {
      var l = w.pending || pickLink(w);
      if (l.cross) {
        var s = signalState(l.cross, now);
        var a0 = PED[w.at], b0 = PED[l.to];
        var need = Math.hypot(b0.x - a0.x, b0.y - a0.y) / w.speed * 1000 + 300;
        if (!s.ped || s.left < need) { w.pending = l; w.waiting = true; return w; }
      }
      w.pending = null; w.waiting = false;
      w.to = l.to; w.cross = l.cross;
    }
    var a = PED[w.at], b = PED[w.to];
    var sh = w.cross ? { x: 0, y: 0 } : laneShift(w, a, b);
    var tx = b.x + sh.x, ty = b.y + sh.y;
    var dx = tx - w.x, dy = ty - w.y, d = Math.hypot(dx, dy);
    var step = w.speed * dt;
    if (d <= step) {
      w.x = tx; w.y = ty; w.prev = w.at; w.at = w.to; w.to = null; w.cross = null;
      if (w.canPause && w.rnd() < 0.15) w.pauseUntil = now + 2000 + w.rnd() * 4000;
    } else {
      w.x += dx / d * step; w.y += dy / d * step;
    }
    return w;
  }

  // ---------- xe cộ ----------
  var ACC = 220, DEC = 420, GAP = 28;
  // Traffic roster (shared by the client offline sim and the server
  // authoritative sim — keep CAR_COLORS / MOTORBIKE_TYPES in sync with the
  // same-named lists in src/main.js, which the client uses for its offline
  // sim and the bike-type cycler).
  var TRAFFIC_COUNT = 20;
  var TRAFFIC_SEED = 20261128; // fixed seed: the server sim and the client's
  // offline sim create the same traffic layout (same cars, same places).
  var CAR_COLORS = ['red', 'black', 'navy', 'taxi2', 'bus'];
  var MOTORBIKE_TYPES = [
    'cub_blue', 'cub_red', 'cub_white',
    'scooter_blue', 'scooter_red', 'scooter_white'
  ];
  var SIZE = { car: 100, motorbike: 56 };
  var APPROACH_AXIS = function (a, b) { return a.y === b.y ? 'h' : 'v'; };
  function lanePoint(fromId, toId, s) {
    var a = NODES[fromId], b = NODES[toId];
    var len = Math.hypot(b.x - a.x, b.y - a.y);
    var ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    return { x: a.x + ux * s - uy * LANE, y: a.y + uy * s + ux * LANE, ux: ux, uy: uy };
  }
  function segLen(fromId, toId) {
    var a = NODES[fromId], b = NODES[toId];
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  function startS(fromId) { return NODES[fromId].degree === 1 ? 0 : BOX; }
  function laneEnd(fromId, toId) { return segLen(fromId, toId) - BOX; }
  function pickNext(fromId, toId, rnd) {
    var arms = NODES[toId].arms;
    var opts = Object.keys(arms).map(function (d) { return arms[d]; })
      .filter(function (id) { return id !== fromId; });
    if (!opts.length) return fromId; // hết đường -> quay đầu
    return opts[Math.floor(rnd() * opts.length)];
  }
  function makeCurve(v) {
    var p0 = lanePoint(v.from, v.to, laneEnd(v.from, v.to));
    var p3 = lanePoint(v.to, v.next, BOX);
    var c1, c2;
    if (v.next === v.from) {            // quay đầu ở mép bản đồ
      c1 = { x: p0.x + p0.ux * 130, y: p0.y + p0.uy * 130 };
      c2 = { x: p3.x - p3.ux * 130, y: p3.y - p3.uy * 130 };
    } else {                            // đi thẳng / rẽ: bezier bậc 2 nâng bậc
      var q;
      if (Math.abs(p0.ux * p3.ux + p0.uy * p3.uy) > 0.5) q = { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
      else q = p0.ux !== 0 ? { x: p3.x, y: p0.y } : { x: p0.x, y: p3.y };
      c1 = { x: p0.x + (q.x - p0.x) * 2 / 3, y: p0.y + (q.y - p0.y) * 2 / 3 };
      c2 = { x: p3.x + (q.x - p3.x) * 2 / 3, y: p3.y + (q.y - p3.y) * 2 / 3 };
    }
    var pts = [p0, c1, c2, p3], len = 0, prev = p0;
    for (var i = 1; i <= 16; i++) { var pt = bez(pts, i / 16); len += Math.hypot(pt.x - prev.x, pt.y - prev.y); prev = pt; }
    return { pts: pts, len: len };
  }
  function bez(p, t) {
    var u = 1 - t;
    var a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return { x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x,
             y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y };
  }
  function placeVehicle(v) {
    if (!v.curve) {
      var p = lanePoint(v.from, v.to, v.s);
      v.x = p.x; v.y = p.y; v.heading = Math.atan2(p.uy, p.ux);
    } else {
      var t = Math.min(1, v.s / v.curve.len);
      var a = bez(v.curve.pts, t), b = bez(v.curve.pts, Math.min(1, t + 0.02));
      var c = t >= 0.98 ? bez(v.curve.pts, t - 0.02) : null;
      v.x = a.x; v.y = a.y;
      v.heading = c ? Math.atan2(a.y - c.y, a.x - c.x) : Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  function createTraffic(count, rnd) {
    rnd = rnd || Math.random;
    var lanes = [];
    SEGMENTS.forEach(function (s) { lanes.push([s.a, s.b], [s.b, s.a]); });
    var list = [], tries = 0;
    while (list.length < count && tries++ < 2000) {
      var l = lanes[Math.floor(rnd() * lanes.length)];
      var kind = list.length % 2 === 0 ? 'car' : 'motorbike';
      var s0 = startS(l[0]), s1 = segLen(l[0], l[1]) - STOP_D - SIZE[kind] / 2 - 5;
      if (s1 <= s0) continue;
      var s = s0 + rnd() * (s1 - s0);
      var clash = list.some(function (o) {
        return o.from === l[0] && o.to === l[1] && Math.abs(o.s - s) < 160;
      });
      if (clash) continue;
      var v = { id: list.length, kind: kind, len: SIZE[kind], from: l[0], to: l[1], s: s,
        speed: 0, vmax: 170 + rnd() * 80, curve: null, next: null, committed: false, rnd: rnd };
      v.next = pickNext(v.from, v.to, rnd);
      placeVehicle(v);
      list.push(v);
    }
    return list;
  }
  // chỗ trống đầu làn ra (đã trừ những xe đang rẽ vào cùng làn đó)
  function exitRoom(list, v) {
    var first = Infinity, booked = 0;
    list.forEach(function (o) {
      if (o === v) return;
      if (!o.curve && o.from === v.to && o.to === v.next) first = Math.min(first, o.s - o.len / 2);
      if ((o.curve || o.committed) && o.to === v.to && o.next === v.next) booked += o.len + GAP;
    });
    return first - BOX - booked >= v.len / 2 + GAP;
  }
  // giao lộ chỉ nhận xe từ MỘT hướng vào tại một thời điểm (rẽ trái không đâm nhau)
  function junctionFree(list, v) {
    return list.every(function (o) {
      return o === v || !(o.curve || o.committed) || o.to !== v.to || o.from === v.from;
    });
  }
  // obstacles: [{x,y}] người chơi / NPC; xe phanh nếu họ đứng trước mũi xe trên lòng đường
  function obstacleGap(v, obstacles) {
    var best = Infinity, ux = Math.cos(v.heading), uy = Math.sin(v.heading);
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i], dx = o.x - v.x, dy = o.y - v.y;
      var ahead = dx * ux + dy * uy, side = Math.abs(dx * -uy + dy * ux);
      if (ahead > 0 && ahead < 260 && side < 34 && inRoad(o.x, o.y)) {
        best = Math.min(best, ahead - v.len / 2 - 24);
      }
    }
    return best;
  }
  // Quãng đường phanh ở tốc độ hiện tại (vật lý: v² / 2·DEC). Xe chạy
  // 250 px/s cần 74px, 170 px/s cần 34px để dừng hẳn.
  function brakingDistance(speed) { return speed * speed / (2 * DEC); }
  // Người (hình tròn r) có đang bị thân xe đè lên không? Hộp xe: dài len,
  // rộng 48px (ô tô) / 28px (xe máy), cộng r của người mỗi phía.
  function hitVehicle(x, y, r, v) {
    var ux = Math.cos(v.heading), uy = Math.sin(v.heading);
    var dx = x - v.x, dy = y - v.y;
    var along = dx * ux + dy * uy, side = Math.abs(dx * -uy + dy * ux);
    var halfW = v.kind === 'motorbike' ? 14 : 24;
    return along > -(v.len / 2 + r) && along < (v.len / 2 + r) && side < halfW + r;
  }
  function stepTraffic(list, dt, now, obstacles) {
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      var room = Infinity; // quãng đường được phép đi tiếp
      if (!v.curve) {
        for (var j = 0; j < list.length; j++) {
          var o = list[j];
          if (o === v || o.from !== v.from) continue;
          if (o.to !== v.to) continue;
          // xe trước cùng làn, kể cả khi nó đã vào giao lộ
          var os = o.curve ? laneEnd(v.from, v.to) + o.s : o.s;
          if (os > v.s) room = Math.min(room, os - v.s - (o.len + v.len) / 2 - GAP);
        }
        if (NODES[v.to].signal && !v.committed) {
          var stopS = segLen(v.from, v.to) - STOP_D - v.len / 2; // mũi xe chạm vạch dừng
          if (v.s <= stopS + 1) {
            var axis = APPROACH_AXIS(NODES[v.from], NODES[v.to]);
            var light = signalState(v.to, now)[axis];
            var toStop = stopS - v.s;
            var tooClose = light === 'yellow' && toStop < v.speed * v.speed / (2 * DEC);
            var go = (light === 'green' || tooClose) && junctionFree(list, v) && exitRoom(list, v);
            if (!go) room = Math.min(room, toStop);
            // đã được phép và sắp qua vạch -> giữ chỗ trong giao lộ
            else if (toStop <= v.vmax * dt + 2) v.committed = true;
          }
        }
      } else {
        for (var k = 0; k < list.length; k++) {
          var p = list[k];
          if (p === v) continue;
          if (p.curve && p.from === v.from && p.to === v.to && p.s > v.s) {
            room = Math.min(room, p.s - v.s - (p.len + v.len) / 2 - GAP);
          }
          if (!p.curve && p.from === v.to && p.to === v.next) {
            room = Math.min(room, (v.curve.len - v.s) + (p.s - BOX) - (p.len + v.len) / 2 - GAP);
          }
        }
      }
      // Người đi bộ là "mềm": họ chỉ đặt tốc độ mục tiêu, KHÔNG kẹp cứng
      // quãng đường xe được đi. Xe chỉ phanh tối đa DEC (420 px/s², vật
      // lý thật) — nếu người bước ra quá gần (gần hơn quãng phanh
      // v²/(2·DEC)), xe không kịp dừng và sẽ đâm (xem hitVehicle).
      // Xe trước / đèn đỏ / giao lộ vẫn kẹp cứng qua `room` như cũ.
      var pedGap = (obstacles && obstacles.length) ? obstacleGap(v, obstacles) : Infinity;
      pedGap = Math.max(0, pedGap); // người đã ở trong khoảng dừng: mục tiêu 0
      room = Math.max(0, room);
      var target = Math.min(v.vmax, Math.sqrt(2 * DEC * 0.7 * Math.min(room, pedGap)));
      if (v.curve) target = Math.min(target, 160);
      // Giới hạn phanh vật lý: không giảm tốc nhanh hơn DEC mỗi giây.
      // (Tăng tốc vẫn tối đa ACC như cũ.)
      v.speed = target > v.speed ? Math.min(target, v.speed + ACC * dt) : Math.max(target, v.speed - DEC * dt);
      v.s += Math.min(v.speed * dt, room);
      if (!v.curve) {
        var end = laneEnd(v.from, v.to);
        if (v.s >= end) { var over = v.s - end; v.curve = makeCurve(v); v.s = over; }
      } else if (v.s >= v.curve.len) {
        var extra = v.s - v.curve.len;
        v.from = v.to; v.to = v.next; v.s = BOX + extra; v.curve = null;
        v.committed = false;
        v.next = pickNext(v.from, v.to, v.rnd);
      }
      placeVehicle(v);
    }
    return list;
  }

  return {
    MAP: MAP, ROAD_W: ROAD_W, SIDEWALK_W: SIDEWALK_W, LANE: LANE, CROSS_W: CROSS_W, STOP_D: STOP_D,
    CENTER: CENTER, PLAZA: PLAZA, NODES: NODES, SEGMENTS: SEGMENTS, SIGNALS: SIGNALS,
    ROAD_RECTS: ROAD_RECTS, SIDEWALK_RECTS: SIDEWALK_RECTS, CROSSWALKS: CROSSWALKS, PED: PED,
    CYCLE: CYCLE, inRoad: inRoad, inSidewalk: inSidewalk, signalState: signalState,
    nearestPed: nearestPed, createWalker: createWalker, stepWalker: stepWalker,
    createTraffic: createTraffic, stepTraffic: stepTraffic, mulberry32: mulberry32,
    DEC: DEC, ACC: ACC, brakingDistance: brakingDistance, hitVehicle: hitVehicle,
    TRAFFIC_COUNT: TRAFFIC_COUNT, TRAFFIC_SEED: TRAFFIC_SEED, CAR_COLORS: CAR_COLORS, MOTORBIKE_TYPES: MOTORBIKE_TYPES,
    SIZE: SIZE
  };
});
