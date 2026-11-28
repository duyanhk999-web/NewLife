/* test/roadnet-check.js — kiểm tra luật giao thông của shared/roadnet.js
   Chạy: node test/roadnet-check.js */
'use strict';
var path = require('path');
var R = require(path.join(__dirname, '../shared/roadnet.js'));
var C = require(path.join(__dirname, '../shared/colliders.js'));
var failed = 0, passed = 0;
function check(name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (detail !== undefined ? ' (' + detail + ')' : ''));
}
function rng(seed) { return function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }
function overlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

// ---- bản đồ ----
var solids = C.BUILDINGS.concat(C.GARDENS);
var bad = [];
solids.forEach(function (o) {
  if (R.SIDEWALK_RECTS.some(function (r) { return overlap(o, r); })) bad.push(o.id);
});
check('nhà và vườn hoa không lấn đường / vỉa hè', !bad.length, bad.join(',') || 'sạch');
check('quảng trường không có đường cắt qua', !R.SIDEWALK_RECTS.some(function (r) { return overlap(C.PLAZA, r); }));
var pairs = [];
var all = solids.concat([Object.assign({ id: 'plaza' }, C.PLAZA)]);
for (var i = 0; i < all.length; i++) for (var j = i + 1; j < all.length; j++)
  if (overlap(all[i], all[j])) pairs.push(all[i].id + '×' + all[j].id);
check('nhà / vườn / quảng trường không đè nhau', !pairs.length, pairs.join(',') || 'sạch');

// ---- đồ thị vỉa hè ----
var seen = { 0: true }, q = [0];
while (q.length) R.PED[q.pop()].links.forEach(function (l) { if (!seen[l.to]) { seen[l.to] = true; q.push(l.to); } });
check('đồ thị vỉa hè liền một khối', Object.keys(seen).length === R.PED.length, Object.keys(seen).length + '/' + R.PED.length);
var jay = 0, hit = 0;
R.PED.forEach(function (a) {
  a.links.forEach(function (l) {
    var b = R.PED[l.to];
    for (var t = 0; t <= 100; t++) {
      var x = a.x + (b.x - a.x) * t / 100, y = a.y + (b.y - a.y) * t / 100;
      if (!l.cross && R.inRoad(x, y)) { jay++; break; }
      if (C.hitBuilding(x, y, 14) || C.hitFence(x, y, 14) || C.inFountain(x, y, 14)) { hit++; break; }
    }
  });
});
check('không cạnh đi bộ nào xuống lòng đường ngoài vạch', jay === 0, jay);
check('không cạnh đi bộ nào xuyên nhà / rào / đài phun', hit === 0, hit);

// ---- người đi bộ: 60 người, 20 phút giả lập ----
var rnd = rng(7), walkers = [];
for (var w = 0; w < 60; w++) walkers.push(R.createWalker(Math.floor(rnd() * R.PED.length), { rnd: rnd }));
var offRoad = 0, redCross = 0, crossings = 0, now = 0, dt = 0.05;
for (var step = 0; step < 24000; step++) {
  now += 50;
  walkers.forEach(function (p) {
    var before = p.to;
    R.stepWalker(p, dt, now);
    if (p.cross && before === null) crossings++;
    if (R.inRoad(p.x, p.y)) {
      // chỉ được ở lòng đường khi đang qua vạch, trong pha đi bộ
      if (!p.cross) offRoad++;
      else if (!R.signalState(p.cross, now).ped) redCross++;
    }
  });
}
check('người đi bộ không bao giờ ra đường ngoài vạch', offRoad === 0, offRoad);
check('người đi bộ không ở trên đường khi hết pha đi bộ', redCross === 0, redCross);
check('người đi bộ vẫn qua đường được', crossings > 100, crossings + ' lượt');

// ---- xe: 24 xe, 30 phút giả lập, nhiều seed ----
[1, 2, 3, 4, 5].forEach(function (seed) {
  var cars = R.createTraffic(24, rng(seed * 991)), t = 0;
  var off = 0, ran = 0, pedClash = 0, crash = 0, plaza = 0;
  var idle = cars.map(function () { return 0; }), maxIdle = 0;
  for (var s = 0; s < 36000; s++) {
    t += 50;
    var prev = cars.map(function (v) { return { curve: !!v.curve, x: v.x, y: v.y }; });
    R.stepTraffic(cars, dt, t, []);
    cars.forEach(function (v, k) {
      if (!R.inRoad(v.x, v.y)) off++;
      if (v.x > C.PLAZA.x && v.x < C.PLAZA.x + C.PLAZA.w && v.y > C.PLAZA.y && v.y < C.PLAZA.y + C.PLAZA.h) plaza++;
      if (v.curve && !prev[k].curve && R.NODES[v.to].signal) {
        var st = R.signalState(v.to, t);
        var axis = R.NODES[v.from].y === R.NODES[v.to].y ? 'h' : 'v';
        if (st.ped) pedClash++;
        // cho phép trễ tối đa 1 s sau đèn vàng (xe không kịp dừng)
        if (st[axis] === 'red' && R.signalState(v.to, t - 1000)[axis] === 'red') ran++;
      }
      // xe còn trong giao lộ khi pha đi bộ đã bật
      if (v.curve && R.NODES[v.to].signal && R.signalState(v.to, t).ped) pedClash++;
      var moved = Math.hypot(v.x - prev[k].x, v.y - prev[k].y);
      idle[k] = moved < 0.05 ? idle[k] + 50 : 0;
      maxIdle = Math.max(maxIdle, idle[k]);
    });
    if (s % 4 === 0) for (var a = 0; a < cars.length; a++) for (var b = a + 1; b < cars.length; b++) {
      if (Math.hypot(cars[a].x - cars[b].x, cars[a].y - cars[b].y) < 30) crash++;
    }
  }
  check('seed ' + seed + ': xe luôn ở dưới lòng đường', off === 0, off);
  check('seed ' + seed + ': không xe nào vào quảng trường', plaza === 0, plaza);
  check('seed ' + seed + ': không vượt đèn đỏ', ran === 0, ran);
  check('seed ' + seed + ': xe không còn trong giao lộ lúc người đi bộ qua', pedClash === 0, pedClash);
  check('seed ' + seed + ': không đâm chồng lên nhau', crash === 0, crash);
  check('seed ' + seed + ': không kẹt xe vĩnh viễn', maxIdle < 90000, 'dừng lâu nhất ' + (maxIdle / 1000).toFixed(0) + 's');
});

// ---- xe nhường người đứng giữa đường ----
var one = R.createTraffic(1, rng(5))[0];
var ped = { x: one.x + Math.cos(one.heading) * 150, y: one.y + Math.sin(one.heading) * 150 };
for (var z = 0; z < 100; z++) R.stepTraffic([one], 0.05, 1000, [ped]);
check('xe phanh trước người trên lòng đường', Math.hypot(ped.x - one.x, ped.y - one.y) >= one.len / 2,
  Math.hypot(ped.x - one.x, ped.y - one.y).toFixed(0) + 'px');

// ---- xe không kịp phanh khi người bước ra quá gần ----
// Xe đang chạy 250 px/s; người xuất hiện cách tâm xe 60px (mũi xe chỉ còn
// 10px tới người — nhỏ hơn quãng phanh 250²/(2·420) ≈ 74px): xe không dừng
// kịp -> đâm. Người ở 200px (xa hơn 74+50+24=148px) thì xe dừng kịp.
var fast = R.createTraffic(1, rng(11))[0];
fast.speed = 250;
var pedNear = { x: fast.x + Math.cos(fast.heading) * 60, y: fast.y + Math.sin(fast.heading) * 60 };
var hitNear = false, movedNear = 0, fx0 = fast.x, fy0 = fast.y;
for (var z = 0; z < 60; z++) {
  R.stepTraffic([fast], 0.05, 1000, [pedNear]);
  if (R.hitVehicle(pedNear.x, pedNear.y, 16, fast)) hitNear = true;
}
movedNear = Math.hypot(fast.x - fx0, fast.y - fy0);
check('xe 250px/s không kịp phanh khi người ở 60px phía trước (quãng phanh ~74px)',
  hitNear && movedNear > 5, 'đâm=' + hitNear + ', xe đi được ' + movedNear.toFixed(0) + 'px');
var slow = R.createTraffic(1, rng(23))[0];
slow.speed = 250;
var pedFar = { x: slow.x + Math.cos(slow.heading) * 200, y: slow.y + Math.sin(slow.heading) * 200 };
var hitFar = false;
for (var z = 0; z < 100; z++) {
  R.stepTraffic([slow], 0.05, 1000, [pedFar]);
  if (R.hitVehicle(pedFar.x, pedFar.y, 16, slow)) hitFar = true;
}
check('xe 250px/s dừng kịp khi người ở 200px phía trước', !hitFar,
  'khoảng cách cuối ' + Math.hypot(pedFar.x - slow.x, pedFar.y - slow.y).toFixed(0) + 'px');
check('quãng phanh 250px/s ≈ 74px, 170px/s ≈ 34px',
  Math.abs(R.brakingDistance(250) - 74.4) < 1 && Math.abs(R.brakingDistance(170) - 34.4) < 1,
  R.brakingDistance(250).toFixed(1) + ' / ' + R.brakingDistance(170).toFixed(1) + 'px');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
