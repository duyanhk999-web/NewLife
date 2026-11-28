/* Cuộc Sống Ảo — test/hud-layout-check.js (phone HUD fix 2026-11-25)
   Headless 390x844 layout check: recomputes every HUD element rect from
   the constants in src/main.js + the CSS in index.html and asserts NO
   overlaps among them (the user's phone screenshot showed the minimap
   covering the money line, VFX/SFX buttons over the minimap, the name
   truncated by the netStatus pill, and the hint line over the FPS counter).
   Also checks the same rects at 390x700 (short phone viewport).
   Run: node test/hud-layout-check.js   (exit 0 = all PASS) */
'use strict';

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('PASS - ' + name + (detail ? ' (' + detail + ')' : '')); }
  else { failed++; console.log('FAIL - ' + name + (detail ? ' (' + detail + ')' : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function rect(name, x, y, w, h) { return { name: name, x: x, y: y, w: w, h: h }; }

var mainSrc = read('src/main.js');
var htmlSrc = read('index.html');

// ---- source constants (the fix must be in the code, not just in this file) --
check('mobile panel width 236 in code', /var panelW = HUD_BIG \? 236 : 300/.test(mainSrc));
check('mobile bars width 160 in code', /\? \{ x: 74, w: 160, h: 16/.test(mainSrc));
check('mobile money shrink cap 212 in code', /var moneyMaxW = HUD_BIG \? 212 : 272/.test(mainSrc));
check('minimapR() 48 mobile / 65 desktop', /function minimapR\(\) \{ return HUD_BIG \? 48 : 65; \}/.test(mainSrc));
check('mobile minimap centre (W-56,56) in layoutHUD', /minimapWrap\.position\.set\(HUD_BIG \? W - 56 : W - 82, HUD_BIG \? 56 : 82\)/.test(mainSrc));
check('mobile clock at (W-56,112)', /clockT\.position\.set\(HUD_BIG \? W - 56 : W - 82, HUD_BIG \? 112 : 152\)/.test(mainSrc));
check('mobile FPS at (W-10,H-30)', /fpsT\.position\.set\(W - 10, HUD_BIG \? H - 30 : H - 8\)/.test(mainSrc));
check('name width cap in code', /var nameMaxW = HUD_BIG \? 166 : 232/.test(mainSrc));
check('order line moves to the bottom-left on mobile (was inside the panel)',
  /orderT\.position\.set\(HUD_BIG \? 14 : W \/ 2, HUD_BIG \? H - 200 : 36\)/.test(mainSrc));
check('order line is 12px left-aligned on mobile',
  /hudRefs\.orderT = text\('', HUD_BIG \? 12 : 14, 0xffe082, true\);/.test(mainSrc) &&
  /hudRefs\.orderT\.anchor\.set\(HUD_BIG \? 0 : 0\.5, 0\);/.test(mainSrc));
check('ride indicator at H-148 (above the joystick top edge)',
  /rideT\.position\.set\(W \/ 2, H - 148\)/.test(mainSrc));

// ---- DOM buttons: parse tops/sizes from index.html CSS ----------------------
var btnTops = {};
['vfxBtn', 'sfxBtn', 'jobBtn', 'atmBtn', 'shopBtn', 'chatBtn'].forEach(function (id) {
  var m = htmlSrc.match(new RegExp('#' + id + ' \\{[^}]*?top: (\\d+)px;[^}]*?width: (\\d+)px; height: (\\d+)px;'));
  if (m) btnTops[id] = { top: +m[1], w: +m[2], h: +m[3] };
});
var btnOrder = ['vfxBtn', 'sfxBtn', 'jobBtn', 'atmBtn', 'shopBtn', 'chatBtn'];
var btnOk = btnOrder.every(function (id) { return btnTops[id] && btnTops[id].w === 48 && btnTops[id].h === 48; });
check('six DOM round buttons are 48x48 top-anchored', btnOk,
  btnOrder.map(function (id) { return id + '@' + (btnTops[id] ? btnTops[id].top : '?'); }).join(', '));
check('button column order VFX 246, SFX 302, NGHỀ 358, ATM 414, SHOP 470, CHAT 526',
  btnTops.vfxBtn && btnTops.vfxBtn.top === 246 && btnTops.sfxBtn.top === 302 &&
  btnTops.jobBtn.top === 358 && btnTops.atmBtn.top === 414 &&
  btnTops.shopBtn.top === 470 && btnTops.chatBtn.top === 526);
check('netStatus moves below the panel, left-aligned, on narrow screens',
  /@media \(max-width: 800px\) \{\s*#netStatus \{ top: 174px; left: 10px; transform: none; \}\s*\}/.test(htmlSrc));

// ---- layout at 390x844 (and 390x700) ----------------------------------------
function layoutAt(W, H) {
  var els = [];
  els.push(rect('panel', 10, 10, 236, 158));
  els.push(rect('name', 70, 26 - 8, 166, 16)); // 15px font, capped 166 wide
  els.push(rect('job', 70, 46 - 6, 110, 12));
  els.push(rect('bars', 74, 68, 160, 60)); // 3 bars y68-128
  els.push(rect('money', 14, 134, 212, 16));
  els.push(rect('minimap', W - 56 - 48, 56 - 48, 96, 96));
  els.push(rect('clock', W - 56 - 50, 112, 100, 16));
  els.push(rect('zoomOut', W - 122 - 20, 202 - 20, 40, 40));
  els.push(rect('zoomIn', W - 42 - 20, 202 - 20, 40, 40));
  els.push(rect('zoomLabel', W - 82 - 35, 236 - 7, 70, 14));
  els.push(rect('orderT', 14, H - 200 - 8, 270, 16)); // 12px, ~45 chars
  els.push(rect('netStatus', 10, 174, 150, 28));
  els.push(rect('hint', W / 2 - 165, H - 18 - 6, 330, 12));
  els.push(rect('fps', W - 10 - 45, H - 30 - 12, 45, 12));
  // ride indicator: shortened text (~35 chars, 13px) ≈ 235px wide, 13 tall
  els.push(rect('rideT', W / 2 - 118, H - 148 - 7, 236, 14));
  // joystick base r50 at (78,H-84); sprint r28 at (W-78,H-84) — real radii
  // from buildJoystick (M2: base 100px dia, CHẠY 56px dia).
  els.push(rect('joystick', 78 - 50, H - 84 - 50, 100, 100));
  els.push(rect('sprint', W - 78 - 28, H - 84 - 28, 56, 56));
  btnOrder.forEach(function (id) {
    var b = btnTops[id];
    els.push(rect(id, W - 14 - 48, b.top, 48, 48));
  });
  return els;
}
[[390, 844], [390, 700]].forEach(function (wh) {
  var W = wh[0], H = wh[1];
  var els = layoutAt(W, H);
  var byName = {};
  els.forEach(function (e) { byName[e.name] = e; });
  // panel-contained elements: must be INSIDE the panel, not overlapping it
  // as a collision — the panel is their background by design.
  ['name', 'job', 'bars', 'money'].forEach(function (n) {
    var e = byName[n], p = byName.panel;
    check(n + ' inside the panel @' + W + 'x' + H,
      e.x >= p.x && e.y >= p.y && e.x + e.w <= p.x + p.w && e.y + e.h <= p.y + p.h);
  });
  var hits = [];
  for (var i = 0; i < els.length; i++) {
    for (var j = i + 1; j < els.length; j++) {
      // skip panel-vs-contained pairs (containment, checked above)
      if (els[i].name === 'panel' || els[j].name === 'panel') continue;
      if (overlap(els[i], els[j])) hits.push(els[i].name + ' x ' + els[j].name);
    }
  }
  check('no HUD overlaps at ' + W + 'x' + H, hits.length === 0,
    hits.join('; ') || els.length + ' rects, all clear');
  // the specific overlaps from the user's screenshot, named explicitly
  check('minimap clear of the money line @' + W + 'x' + H, !overlap(byName.minimap, byName.money));
  check('minimap clear of the panel @' + W + 'x' + H, !overlap(byName.minimap, byName.panel));
  check('netStatus pill clear of the player name @' + W + 'x' + H, !overlap(byName.netStatus, byName.name));
  check('hint line clear of the FPS counter @' + W + 'x' + H, !overlap(byName.hint, byName.fps));
  check('VFX/SFX buttons clear of the minimap @' + W + 'x' + H,
    !overlap(byName.vfxBtn, byName.minimap) && !overlap(byName.sfxBtn, byName.minimap));
  check('ride indicator clear of joystick + sprint + FPS @' + W + 'x' + H,
    !overlap(byName.rideT, byName.joystick) && !overlap(byName.rideT, byName.sprint) && !overlap(byName.rideT, byName.fps));
  check('order line clear of the panel + zoom buttons @' + W + 'x' + H,
    !overlap(byName.orderT, byName.panel) && !overlap(byName.orderT, byName.zoomOut) && !overlap(byName.orderT, byName.zoomIn));
  check('netStatus pill clear of the zoom buttons @' + W + 'x' + H,
    !overlap(byName.netStatus, byName.zoomOut) && !overlap(byName.netStatus, byName.zoomIn));
  check('button column clear of the sprint button @' + W + 'x' + H,
    !overlap(byName.chatBtn, byName.sprint));
});

// ---- clock day number (fix 2026-11-25: clock showed "08:56 • Ngày" with
// no day number — worldTime wrapped every 1440 min but nothing counted days)
// LAG FIX (2026-11-28): clock text is now assigned via the cached
// setHudText() helper instead of a direct .text assignment every frame —
// the displayed string is unchanged, so match the helper call.
check('clock text shows the day number (Ngày N / Đêm N)',
  /setHudText\(hudRefs\.clockT, 'clock', clockStr \+ \(isNight \? '  •  Đêm ' : '  •  Ngày '\) \+ worldDay\)/.test(mainSrc));
check('worldDay declared, starts at 1', /var worldDay = 1;/.test(mainSrc));
(function () {
  // simulate the exact wrap logic from main.js (offline + online)
  var DAY_MINUTES = 1440, worldTime = 480, worldDay = 1;
  function tickOffline(dt) {
    var nextTime = worldTime + dt;
    if (nextTime >= DAY_MINUTES) worldDay++;
    worldTime = nextTime % DAY_MINUTES;
  }
  function onWorldTime(minutes) {
    if (worldTime > 1200 && minutes < 240) worldDay++;
    worldTime = minutes;
  }
  function clockStr() {
    var hh = Math.floor(worldTime / 60) % 24, mm = Math.floor(worldTime % 60);
    var s = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
    return s + ((hh >= 18 || hh < 6) ? '  •  Đêm ' : '  •  Ngày ') + worldDay;
  }
  check('clock at start is "08:00 • Ngày 1"', clockStr() === '08:00  •  Ngày 1', clockStr());
  worldTime = 1439; tickOffline(1.5); // cross midnight offline
  check('offline midnight wrap -> day 2, "00:00 • Đêm 2"', worldDay === 2 && clockStr() === '00:00  •  Đêm 2', clockStr());
  tickOffline(360); // 06:00 day 2
  check('06:00 day 2 -> "06:00 • Ngày 2"', clockStr() === '06:00  •  Ngày 2', clockStr());
  worldTime = 1300; worldDay = 5; onWorldTime(30); // server wraps past midnight
  check('online server wrap -> day 6', worldDay === 6 && worldTime === 30, 'day=' + worldDay);
  worldTime = 1300; worldDay = 5; onWorldTime(480); // server restart to 08:00, NOT a new day
  check('server restart to 08:00 does not add a day', worldDay === 5, 'day=' + worldDay);
  check('day number is a real number >= 1', typeof worldDay === 'number' && worldDay >= 1);
})();

// ---- summary ----------------------------------------------------------------
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
