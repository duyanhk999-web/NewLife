/* Cuộc Sống Ảo — test/map-render-check.js (render fix 2026-11-25)
   Headless check of the map rendering: no real browser, no PIXI.
   - Loads shared/colliders.js (UMD) for the ground-truth rects.
   - Parses src/main.js source for ASSET_FILES / POI_TEX / HOUSE_TEX and for
     the draw-order / draw-call shapes (contain-fit, plaza texture).
   - Reads PNG IHDR dims (no decode) + opaque-alpha bbox for the animals.
   - Simulates fitRect() with the real texture dims and asserts every fitted
     building rect sits inside its collider rect with aspect preserved.
   - Asserts road continuity (no building covers a road-centre sample),
     the M4 subtitle, and the 80.000đ starter grant (NOT a bug — locked).
   Run: node test/map-render-check.js   (exit 0 = all PASS) */
'use strict';

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var Colliders = require(path.join(ROOT, 'shared/colliders.js'));

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('PASS - ' + name + (detail ? ' (' + detail + ')' : '')); }
  else { failed++; console.log('FAIL - ' + name + (detail ? ' (' + detail + ')' : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function pngDims(p) {
  var b = fs.readFileSync(path.join(ROOT, p));
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function containsPoint(r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
// Same math as fitRect() in src/main.js — contain-fit, centred, no stretch.
function fitRect(tw, th, x, y, w, h) {
  var s = Math.min(w / tw, h / th);
  var fw = tw * s, fh = th * s;
  return { x: x + (w - fw) / 2, y: y + (h - fh) / 2, w: fw, h: fh };
}

var mainSrc = read('src/main.js');
var econSrc = read('src/economy.js');
var citySrc = read('server/rooms/CityRoom.js');

// ---- 1. collider rects are inside the map ---------------------------------
var badBounds = Colliders.BUILDINGS.filter(function (b) {
  return b.x < 0 || b.y < 0 || b.x + b.w > Colliders.MAP_W || b.y + b.h > Colliders.MAP_H;
});
check('buildings inside 4800x4800', badBounds.length === 0,
  Colliders.BUILDINGS.length + ' buildings');

// ---- 1b. the main.js fallback BUILDINGS list must match colliders.js -----
// (the comment in main.js claims "verified identical" — enforce it, since
// both files are edited by hand; the server is authoritative).
var fallbackBlock = mainSrc.match(/\? Colliders\.BUILDINGS : \[([\s\S]*?)\n  \];/);
var fbBad = [];
if (!fallbackBlock) fbBad.push('fallback BUILDINGS block not found');
else {
  var fb = {};
  fallbackBlock[1].replace(/id: '(\w+)'[^}]*?x: (\d+),\s*y: (\d+),\s*w: (\d+),\s*h: (\d+)/g,
    function (_, id, x, y, w, h) { fb[id] = { x: +x, y: +y, w: +w, h: +h }; });
  Colliders.BUILDINGS.forEach(function (b) {
    var f = fb[b.id];
    if (!f) fbBad.push(b.id + ': missing from fallback');
    else if (f.x !== b.x || f.y !== b.y || f.w !== b.w || f.h !== b.h) {
      fbBad.push(b.id + ': fallback (' + f.x + ',' + f.y + ',' + f.w + ',' + f.h +
        ') != colliders (' + b.x + ',' + b.y + ',' + b.w + ',' + b.h + ')');
    }
  });
  Object.keys(fb).forEach(function (id) {
    if (!Colliders.BUILDINGS.some(function (b) { return b.id === id; })) fbBad.push(id + ': extra in fallback');
  });
}
check('main.js fallback BUILDINGS identical to shared/colliders.js', fbBad.length === 0,
  fbBad.join('; ') || Colliders.BUILDINGS.length + ' rects match');

// ---- 2. road overlap: kiểm tra trong test/roadnet-check.js ----------------

// ---- 3. no building-vs-building overlap ------------------------------------
var bbHits = [];
for (var i = 0; i < Colliders.BUILDINGS.length; i++) {
  for (var j = i + 1; j < Colliders.BUILDINGS.length; j++) {
    if (rectsOverlap(Colliders.BUILDINGS[i], Colliders.BUILDINGS[j])) {
      bbHits.push(Colliders.BUILDINGS[i].id + ' x ' + Colliders.BUILDINGS[j].id);
    }
  }
}
check('no building-vs-building overlap', bbHits.length === 0, bbHits.join(', ') || 'clean');

// ---- 6. tight crops exist with the recorded dims ---------------------------
var tight = {
  'building-hospital-tight.png': [580, 570], 'building-warehouse-tight.png': [871, 697], // Polyfork render 2026-11-25 (was FLUX 690x620)
  'building-motel-tight.png': [900, 680], 'building-market-tight.png': [480, 440],
  'building-police-tight.png': [680, 550], 'building-school-tight.png': [680, 330],
  'building-cafe-tight.png': [670, 710], 'building-pavilion-tight.png': [600, 690],
  'house-a-tight.png': [660, 860]
};
var tightOk = true, tightBad = [];
Object.keys(tight).forEach(function (f) {
  var d = pngDims('assets/v3/' + f);
  if (!d || d.w !== tight[f][0] || d.h !== tight[f][1]) { tightOk = false; tightBad.push(f); }
});
check('9 tight building crops exist with recorded dims', tightOk, tightBad.join(', ') || 'all 9 match');

// ---- 7. building draw: contain-fit, never stretch --------------------------
check('building loop uses fitRect (contain-fit)', mainSrc.indexOf('var fit = fitRect(bTex.width, bTex.height, b.x, b.y, b.w, b.h);') >= 0);
check('old stretch draw is gone', mainSrc.indexOf('bspr.width = b.w; bspr.height = b.h;') < 0);
check('fitRect helper exists', /function fitRect\(tw, th, x, y, w, h\)/.test(mainSrc));
// simulate contain-fit for every building with its real texture dims
function blockMap(src, name) {
  var m = src.match(new RegExp('var ' + name + ' = \\{([^}]*)\\};'));
  var out = {};
  if (!m) return out;
  m[1].split(',').forEach(function (kv) {
    var p = kv.split(':');
    if (p.length === 2) out[p[0].trim()] = p[1].trim().replace(/^'|'$/g, '');
  });
  return out;
}
function assetMap(src) {
  var m = src.match(/var ASSET_FILES = \{([\s\S]*?)\n  \};/);
  var out = {};
  if (!m) return out;
  m[1].replace(/(\w+):\s*'([^']+)'/g, function (_, k, v) { out[k] = v; });
  return out;
}
var assets = assetMap(mainSrc);
var poiTex = blockMap(mainSrc, 'POI_TEX');
var houseTex = blockMap(mainSrc, 'HOUSE_TEX');
var fitBad = [], fitCount = 0;
Colliders.BUILDINGS.forEach(function (b) {
  var key = poiTex[b.id] || houseTex[b.id];
  if (!key || !assets[key]) return;
  var d = pngDims(assets[key]);
  if (!d) { fitBad.push(b.id + ': missing ' + assets[key]); return; }
  var f = fitRect(d.w, d.h, b.x, b.y, b.w, b.h);
  fitCount++;
  var inside = f.x >= b.x - 0.01 && f.y >= b.y - 0.01 &&
    f.x + f.w <= b.x + b.w + 0.01 && f.y + f.h <= b.y + b.h + 0.01;
  var aspectKept = Math.abs((f.w / f.h) - (d.w / d.h)) < 1e-9;
  var centred = Math.abs((f.x - b.x) - ((b.w - f.w) / 2)) < 0.01 &&
    Math.abs((f.y - b.y) - ((b.h - f.h) / 2)) < 0.01;
  var areaOk = (f.w * f.h) >= 0.35 * b.w * b.h; // roof crops are wide by
  // nature (showroom roof 705x210 -> 40% of its rect): they fill the width
  // and the flat backing reads as the building body — undistorted is what
  // matters, not the fill ratio.
  if (!inside || !aspectKept || !centred || !areaOk) {
    fitBad.push(b.id + ': inside=' + inside + ' aspect=' + aspectKept + ' centred=' + centred + ' area=' + ((f.w * f.h / (b.w * b.h)) * 100).toFixed(0) + '%');
  }
});
check('contain-fit: every building sprite inside its rect, aspect kept, centred', fitBad.length === 0,
  fitCount + ' buildings fitted' + (fitBad.length ? ' — ' + fitBad.join('; ') : ''));

// ---- 8. draw order: garden beds BEFORE roads -------------------------------
var buildWorld = mainSrc.slice(mainSrc.indexOf('function buildWorld()'));
var bedIdx = buildWorld.indexOf('bed.rect(gd.x, gd.y, gd.w, gd.h)');
var roadsIdx = buildWorld.indexOf('RoadRender.drawRoads(world)');
var plazaIdx = buildWorld.indexOf('RoadRender.drawPlaza(world)');
check('garden beds drawn before roads (roads paint over the overlap)',
  bedIdx >= 0 && roadsIdx >= 0 && bedIdx < roadsIdx, 'bed@' + bedIdx + ' roads@' + roadsIdx);
check('plaza sprite drawn after roads', plazaIdx > roadsIdx, 'plaza@' + plazaIdx);

// ---- 9. animals / props: real aspect, no smear band ------------------------
var propDraws = [
  { id: 'dog', file: 'assets/v3/prop-dog-full.png', w: 30 },
  { id: 'cat', file: 'assets/v3/prop-cat-full.png', w: 22 },
  { id: 'motorbike', file: 'assets/v3/prop-motorbike-full.png', w: 34 },
  { id: 'bicycle', file: 'assets/v3/prop-bicycle-full.png', w: 56 },
];
var propBad = [];
propDraws.forEach(function (pd) {
  var d = pngDims(pd.file);
  if (!d) { propBad.push(pd.id + ': missing'); return; }
  var aspect = d.w / d.h;
  if (aspect < 0.2 || aspect > 5) propBad.push(pd.id + ': aspect ' + aspect.toFixed(2));
  var drawnH = pd.w * d.h / d.w;
  if (drawnH < 15 || drawnH > 90) propBad.push(pd.id + ': drawn height ' + drawnH.toFixed(0));
});
check('animal/prop PNGs: sane aspect, sane drawn size', propBad.length === 0,
  propDraws.map(function (pd) {
    var d = pngDims(pd.file);
    return pd.id + ' ' + d.w + 'x' + d.h + ' -> ' + pd.w + 'x' + Math.round(pd.w * d.h / d.w);
  }).join(', ') + (propBad.length ? ' — ' + propBad.join('; ') : ''));
check('spawnAnimal preserves aspect in code',
  mainSrc.indexOf('spr.height = w * tex.height / tex.width;') >= 0);
check('propSprite preserves aspect in code',
  /function propSprite[\s\S]*?spr\.height = w \* tex\.height \/ tex\.width;/.test(mainSrc));

// ---- 10. subtitle + starter grant (locked findings) -------------------------
check('start-screen subtitle is M4', mainSrc.indexOf("text('M4  •  PixiJS v8") >= 0);
check('no stale M3 subtitle left', mainSrc.indexOf("text('M3  •  PixiJS v8") < 0);
check('starter grant is 80.000đ (client)', /var STARTER_GRANT = 80000;/.test(econSrc));
check('starter grant is 80.000đ (server)', /STARTER_GRANT = 80000/.test(citySrc));
check('no 50.000đ grant on the fresh-player path', !/STARTER_GRANT = 50000/.test(econSrc) && !/STARTER_GRANT = 50000/.test(citySrc));
check('starterGrant() runs at Economy.init', /starterGrant\(\)/.test(econSrc));

// ---- summary ----------------------------------------------------------------
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
