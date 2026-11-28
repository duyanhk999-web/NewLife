/* Cuộc Sống Ảo — src/roadrender.js
   Vẽ đường, vỉa hè, vạch kẻ, quảng trường và đèn tín hiệu bằng PIXI Graphics
   (không cần ảnh). Dữ liệu lấy từ shared/roadnet.js. */
(function () {
  'use strict';
  var R = window.RoadNet;
  var HALF = R.ROAD_W / 2;
  var VEC = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };

  function drawRoads(world, tex) {
    tex = tex || (typeof TEX !== 'undefined' ? TEX : (window.TEX || null));
    var g = new PIXI.Graphics();
    
    // 1) Toàn bộ vỉa hè: lát đá terrazzo hoa văn mắt nai (hoặc nền gạch chuẩn)
    if (tex && tex.sidewalkTile) {
      var swContainer = new PIXI.Container();
      R.SIDEWALK_RECTS.forEach(function (q) {
        var ts = new PIXI.TilingSprite({
          texture: tex.sidewalkTile,
          width: q.w,
          height: q.h
        });
        ts.position.set(q.x, q.y);
        ts.tileScale.set(0.075, 0.075); // Thu nhỏ kích thước gạch còn 30%
        swContainer.addChild(ts);
      });
      world.addChild(swContainer);
    } else {
      R.SIDEWALK_RECTS.forEach(function (q) { g.rect(q.x, q.y, q.w, q.h).fill(0xd8cfae); });
    }

    // 2) Bó vỉa bê tông & 3) Lòng đường nhựa
    R.ROAD_RECTS.forEach(function (q) { g.rect(q.x - 5, q.y - 5, q.w + 10, q.h + 10).fill(0x9a9482); });
    R.ROAD_RECTS.forEach(function (q) { g.rect(q.x, q.y, q.w, q.h).fill(0x44474b); });

    // vạch giữa (vàng đôi) + vạch mép (trắng), chỉ giữa hai giao lộ
    R.SEGMENTS.forEach(function (s) {
      var a = R.NODES[s.a], b = R.NODES[s.b];
      var len = Math.hypot(b.x - a.x, b.y - a.y);
      var ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      var from = a.degree >= 3 ? R.STOP_D : (a.degree === 2 ? HALF : 0);
      var to = len - (b.degree >= 3 ? R.STOP_D : (b.degree === 2 ? HALF : 0));
      function line(off, color, width) {
        g.moveTo(a.x + ux * from - uy * off, a.y + uy * from + ux * off)
         .lineTo(a.x + ux * to - uy * off, a.y + uy * to + ux * off)
         .stroke({ width: width, color: color });
      }
      line(-4, 0xf2c53d, 3); line(4, 0xf2c53d, 3);
      line(-(HALF - 9), 0xe8e8e8, 3); line(HALF - 9, 0xe8e8e8, 3);
    });
    // khúc cua: nối vạch giữa
    Object.keys(R.NODES).forEach(function (id) {
      var n = R.NODES[id];
      if (n.degree !== 2) return;
      var arms = Object.keys(n.arms);
      if ((arms.indexOf('N') >= 0 && arms.indexOf('S') >= 0) || (arms.indexOf('E') >= 0 && arms.indexOf('W') >= 0)) return;
      [-4, 4].forEach(function (off) {
        var p = VEC[arms[0]], q = VEC[arms[1]];
        var cx = n.x + (p[0] + q[0]) * off, cy = n.y + (p[1] + q[1]) * off;
        g.moveTo(n.x + p[0] * HALF + q[0] * off, n.y + p[1] * HALF + q[1] * off)
         .lineTo(cx, cy)
         .lineTo(n.x + q[0] * HALF + p[0] * off, n.y + q[1] * HALF + p[1] * off)
         .stroke({ width: 3, color: 0xf2c53d });
      });
    });
    // vạch qua đường (ngựa vằn) + vạch dừng trên làn đi VÀO giao lộ
    R.CROSSWALKS.forEach(function (c) {
      var n = R.NODES[c.node], d = VEC[c.side];
      var vertical = d[0] === 0; // nhánh đường dọc
      var cx = (c.x1 + c.x2) / 2, cy = (c.y1 + c.y2) / 2;
      for (var o = -HALF + 8; o < HALF - 8; o += 28) {
        if (vertical) g.rect(cx + o, cy - R.CROSS_W / 2, 15, R.CROSS_W).fill(0xf5f5f5);
        else g.rect(cx - R.CROSS_W / 2, cy + o, R.CROSS_W, 15).fill(0xf5f5f5);
      }
      // xe vào giao lộ đi theo hướng -d, giữ bên phải
      var rx = d[1], ry = -d[0];
      var sx = n.x + d[0] * R.STOP_D, sy = n.y + d[1] * R.STOP_D;
      g.moveTo(sx + rx * 6, sy + ry * 6).lineTo(sx + rx * (HALF - 6), sy + ry * (HALF - 6))
       .stroke({ width: 8, color: 0xf5f5f5 });
    });
    world.addChild(g);
    return g;
  }

  function drawPlaza(world, tex) {
    tex = tex || (typeof TEX !== 'undefined' ? TEX : (window.TEX || null));
    var c = R.CENTER, g = new PIXI.Graphics();
    
    // Toàn bộ khuôn viên đi bộ & vỉa hè bao quanh quảng trường trung tâm:
    // Từ mép đường nhựa x = 2040..2820, y = 2040..2820 (Kích thước 780 x 780 px)
    var W_PLAZA = 780, H_PLAZA = 780;
    var X_PLAZA = 2040, Y_PLAZA = 2040;
    var R_CORNER = 36; // Bán kính bo tròn góc vỉa hè tiếp giáp đường cua

    // 1) Lát đá vỉa hè hoa văn mắt nai phủ toàn bộ khuôn viên quảng trường
    if (tex && tex.sidewalkTile) {
      var tileSprite = new PIXI.TilingSprite({
        texture: tex.sidewalkTile,
        width: W_PLAZA,
        height: H_PLAZA
      });
      tileSprite.position.set(X_PLAZA, Y_PLAZA);
      tileSprite.tileScale.set(0.075, 0.075); // Thu nhỏ kích thước gạch còn 30%

      // Mask bo góc tròn khớp hoàn hảo với đá bó vỉa bo tròn
      var maskG = new PIXI.Graphics();
      maskG.roundRect(X_PLAZA, Y_PLAZA, W_PLAZA, H_PLAZA, R_CORNER).fill(0xffffff);
      tileSprite.mask = maskG;
      world.addChild(maskG);
      world.addChild(tileSprite);
    } else {
      g.roundRect(X_PLAZA, Y_PLAZA, W_PLAZA, H_PLAZA, R_CORNER).fill(0xd8cfae);
      for (var i = 60; i < W_PLAZA; i += 60) {
        g.moveTo(X_PLAZA + i, Y_PLAZA).lineTo(X_PLAZA + i, Y_PLAZA + H_PLAZA);
        g.moveTo(X_PLAZA, Y_PLAZA + i).lineTo(X_PLAZA + W_PLAZA, Y_PLAZA + i);
      }
      g.stroke({ width: 1, color: 0xcdbd94 });
    }

    // 2) Bo viền vỉa hè tiếp giáp lòng đường (Đá bó vỉa granite + rãnh mép nhựa + vạch kẻ mép đường)
    // Rãnh thoát nước mép nhựa đường
    g.roundRect(X_PLAZA - 4, Y_PLAZA - 4, W_PLAZA + 8, H_PLAZA + 8, R_CORNER + 4).stroke({ width: 4, color: 0x2e3033 });
    // Vạch sơn trắng mép đường bọc ngoài mép vỉa hè
    g.roundRect(X_PLAZA - 2, Y_PLAZA - 2, W_PLAZA + 4, H_PLAZA + 4, R_CORNER + 2).stroke({ width: 3, color: 0xeeeeee });
    // Thân đá bó vỉa hè xám granite chính (dày 8px) bo tròn 4 góc
    g.roundRect(X_PLAZA, Y_PLAZA, W_PLAZA, H_PLAZA, R_CORNER).stroke({ width: 8, color: 0x827c6f });
    // Vát cạnh trên đá bó vỉa (bevel sáng)
    g.roundRect(X_PLAZA + 3, Y_PLAZA + 3, W_PLAZA - 6, H_PLAZA - 6, R_CORNER - 3).stroke({ width: 2, color: 0xcdc4b0 });

    // 3) Chỉ đá viền ngăn cách nhẹ giữa dải đi bộ sát đường và sân quảng trường trung tâm (660 x 660 px)
    var P = R.PLAZA;
    g.roundRect(P.x, P.y, P.w, P.h, 20).stroke({ width: 4, color: 0xb5ab93 });
    g.roundRect(P.x + 2, P.y + 2, P.w - 4, P.h - 4, 18).stroke({ width: 2, color: 0xe0d7c2 });

    // 4) 4 lối hạ vỉa hè cho người đi bộ tại các vị trí tiếp giáp vạch qua đường
    g.rect(c.x - 30, Y_PLAZA - 3, 60, 8).fill(0xaba392);
    g.rect(c.x - 30, Y_PLAZA + H_PLAZA - 5, 60, 8).fill(0xaba392);
    g.rect(X_PLAZA - 3, c.y - 30, 8, 60).fill(0xaba392);
    g.rect(X_PLAZA + W_PLAZA - 5, c.y - 30, 8, 60).fill(0xaba392);

    // 5) 4 thảm cỏ góc
    [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (k) {
      var x = P.x + 24 + k[0] * (P.w - 168), y = P.y + 24 + k[1] * (P.h - 168);
      g.roundRect(x, y, 120, 120, 18).fill(0x6fb356).stroke({ width: 6, color: 0xb9a77c });
      for (var f = 0; f < 14; f++) {
        g.circle(x + 18 + (f * 37) % 88, y + 18 + (f * 53) % 88, 5).fill(f % 2 ? 0xf06292 : 0xffd54f);
      }
    });

    // 6) Đài phun nước trung tâm
    g.circle(c.x, c.y, 200).stroke({ width: 10, color: 0xc9a66b });
    g.circle(c.x, c.y, 108).fill(0xbfb4a0);
    g.circle(c.x, c.y, 90).fill(0x5dade2).stroke({ width: 8, color: 0x8d8577 });
    g.circle(c.x, c.y, 56).stroke({ width: 3, color: 0xaed6f1 });
    g.circle(c.x, c.y, 28).fill(0xd6d0c2);
    g.circle(c.x, c.y, 14).fill(0xeaf6ff);
    world.addChild(g);
    return g;
  }

  // Cột đèn: một cho xe (3 màu) ở mỗi hướng vào, đèn người đi bộ ở 2 đầu vạch.
  function createSignals(world) {
    var items = R.CROSSWALKS.map(function (c) {
      var n = R.NODES[c.node], d = VEC[c.side];
      var rx = d[1], ry = -d[0];
      var car = new PIXI.Graphics();
      car.position.set(n.x + d[0] * (R.STOP_D + 22) + rx * (HALF + 16), n.y + d[1] * (R.STOP_D + 22) + ry * (HALF + 16));
      car.zIndex = car.position.y;
      world.addChild(car);
      var walks = [[c.x1, c.y1], [c.x2, c.y2]].map(function (p) {
        var w = new PIXI.Graphics();
        w.position.set(p[0] + d[0] * 36, p[1] + d[1] * 36);
        w.zIndex = w.position.y;
        world.addChild(w);
        return w;
      });
      return { node: c.node, axis: d[0] === 0 ? 'v' : 'h', car: car, walks: walks };
    });
    return { items: items, key: '' };
  }
  function updateSignals(layer, now) {
    if (!layer) return;
    var blink = Math.floor(now / 300) % 2;
    var states = {};
    R.SIGNALS.forEach(function (id) { states[id] = R.signalState(id, now); });
    var key = R.SIGNALS.map(function (id) {
      var s = states[id];
      return s.phase + (s.ped && s.left < 2500 ? 'b' + blink : '');
    }).join();
    if (key === layer.key) return; // chỉ vẽ lại khi đổi pha
    layer.key = key;
    layer.items.forEach(function (it) {
      var s = states[it.node];
      var color = s[it.axis];
      it.car.clear();
      it.car.roundRect(-9, -52, 18, 46, 4).fill(0x1e1e1e);
      it.car.rect(-2, -6, 4, 12).fill(0x555555);
      [['red', 0xff3b30], ['yellow', 0xffcc00], ['green', 0x2ee66b]].forEach(function (l, i) {
        it.car.circle(0, -44 + i * 15, 5.5).fill(color === l[0] ? l[1] : 0x3a3a3a);
      });
      var walkOn = s.ped && !(s.left < 2500 && blink);
      it.walks.forEach(function (w) {
        w.clear();
        w.rect(-1.5, -10, 3, 14).fill(0x555555);
        w.roundRect(-8, -26, 16, 16, 3).fill(0x1e1e1e);
        w.circle(0, -18, 5).fill(walkOn ? 0x2ee66b : (s.ped ? 0x3a3a3a : 0xff3b30));
      });
    });
  }

  function treeSpots(count, rnd) {
    var out = [], C = window.Colliders;
    function near(x, y) {
      var m = 55;
      var boxes = C.BUILDINGS.concat(C.GARDENS, [R.PLAZA], R.SIDEWALK_RECTS);
      return boxes.some(function (b) { return x > b.x - m && x < b.x + b.w + m && y > b.y - m && y < b.y + b.h + m; });
    }
    for (var i = 0; i < 3000 && out.length < count; i++) {
      var x = 70 + rnd() * (R.MAP - 140), y = 70 + rnd() * (R.MAP - 140);
      if (near(x, y)) continue;
      if (out.some(function (t) { return Math.hypot(t.x - x, t.y - y) < 90; })) continue;
      out.push({ x: x, y: y });
    }
    return out;
  }
  // đèn đường: mép ngoài vỉa hè, cách nhau ~400px, tránh giao lộ.
  // Moved to shared/props.js (2026-11-28) so the server collides with the
  // same lamp positions — this is now a delegate, one implementation.
  function lampSpots() {
    return (typeof Props !== 'undefined' && Props.lampSpots) ? Props.lampSpots() : [];
  }

  window.RoadRender = { drawRoads: drawRoads, drawPlaza: drawPlaza, createSignals: createSignals,
    updateSignals: updateSignals, treeSpots: treeSpots, lampSpots: lampSpots };
})();
