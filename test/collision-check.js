/* Cuộc Sống Ảo — test/collision-check.js (overlap escape 2026-11-28)
   The user reported "Bị đâm xong về bệnh viện là dính luôn, ko đi đâu đc"
   (after an accident, stuck at the hospital, cannot move anywhere).
   Root cause: the accident teleport put the victim EXACTLY on top of
   another player standing at HOSPITAL_SPAWN, and both _blockedFor (server)
   and blockedFull (client) blocked ANY target within 32px of another
   player/NPC/animal with no already-overlapping exception — from distance
   0 every step stays inside the circle, so all moves were blocked on
   both sides forever.
   Fix: for the CIRCLE checks only, a circle the mover ALREADY overlaps
   (current distance < r + 16) does not block — the mover can walk out.
   Walking INTO a circle from outside is still blocked as before. The
   rule is identical in server/rooms/CityRoom.js _blockedFor and
   src/main.js blockedFull (same cx, cy current-position params); this
   check locks both sides in and guards against the twins drifting apart.
   This check unit-tests the CLIENT twin headless (no browser, no PIXI):
   blockedFull is extracted from src/main.js by brace matching and run
   with stubbed map/traffic (false — the hospital spawn is clear of all
   of them) and controlled NPC/animal/remote-player circles.
   Run: node test/collision-check.js   (exit 0 = all PASS) */
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
var mainSrc = read('src/main.js');
var citySrc = read('server/rooms/CityRoom.js');

// ---- extract blockedFull from src/main.js (IIFE, not exported) --------
function extractFn(src, sig) {
  var start = src.indexOf(sig);
  if (start < 0) return null;
  var brace = src.indexOf('{', start);
  var depth = 0;
  for (var i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}
var fnSrc = extractFn(mainSrc, 'function blockedFull(x, y, r, self, cx, cy)');
check('client blockedFull takes current position (cx, cy)', !!fnSrc);
check('server _blockedFor takes current position (cx, cy)',
  /_blockedFor\(x, y, r, selfId, cx, cy\)/.test(citySrc));
check('client updatePlayer passes current position to tryMove',
  /tryMove\(nx, playerState\.y, 16, playerState\.x, playerState\.y\)/.test(mainSrc)
  && /tryMove\(playerState\.x, ny, 16, playerState\.x, playerState\.y\)/.test(mainSrc));
check('server _onMove passes current position to _blockedFor',
  /this\._blockedFor\(nx, ny, r, client\.sessionId, player\.x, player\.y\)/.test(citySrc));

function makeBlockedFull(state) {
  var factory = new Function('blocked', 'Props', 'RoadNet', 'traffic',
    'npcs', 'tutorialNpc', 'animals', 'remotePlayers',
    fnSrc + '\nreturn blockedFull;');
  return factory(
    function () { return false; }, // map: stubbed clear (hospital spawn is)
    { hitProp: function () { return false; } }, // props: stubbed clear
    { hitVehicle: function () { return false; } }, // traffic: stubbed clear
    [], state.npcs, null, state.animals, state.remotePlayers);
}
var R = 16, LIM = R + 16; // 32px circle
function dist(x1, y1, x2, y2) { return Math.hypot(x1 - x2, y1 - y2); }

// ---- remote player circle ----------------------------------------------
var other = { x: 4125, y: 1890 }; // the player already standing at the spawn
var st = { npcs: [], animals: [], remotePlayers: { other: { playerState: other } } };
var bf = makeBlockedFull(st);
// From outside (60px west): stepping to 23px away (inside the circle) is blocked.
check('remote player: walking INTO the circle from outside is blocked',
  bf(4125 - 23, 1890, R, null, 4125 - 60, 1890) === true);
// From outside: stepping to exactly 32px stays free (boundary, same as before).
check('remote player: stopping exactly at 32px is still allowed',
  bf(4125 - 32, 1890, R, null, 4125 - 60, 1890) === false);
// Stacked on the exact same spot: a step out in ANY cardinal direction is free.
var dirs = [[9, 0, 'east'], [-9, 0, 'west'], [0, 9, 'south'], [0, -9, 'north']];
dirs.forEach(function (d) {
  var ok = bf(4125 + d[0], 1890 + d[1], R, null, 4125, 1890) === false;
  check('remote player: stacked players can walk ' + d[2] + ' out of each other', ok,
    'target dist=' + dist(4125 + d[0], 1890 + d[1], 4125, 1890).toFixed(0) + 'px');
  // Without the current position (old call shape) the target is still
  // blocked — the escape only applies when the caller passes cx, cy.
  var oldShape = bf(4125 + d[0], 1890 + d[1], R, null) === true;
  check('remote player: without cx, cy the old blocking still applies (' + d[2] + ')', oldShape);
});
// Partial overlap (20px apart): still overlapping, so walking out is free;
// walking deeper in is also free (the rule skips the whole circle).
check('remote player: partial overlap (20px) can walk out east',
  bf(4125 + 9, 1890, R, null, 4125 - 20, 1890) === false);
check('remote player: partial overlap (20px) can walk out west',
  bf(4125 - 29, 1890, R, null, 4125 - 20, 1890) === false);

// ---- NPC circle (same rule) ---------------------------------------------
var npc = { x: 1000, y: 1000 };
var stNpc = { npcs: [npc], animals: [], remotePlayers: {} };
var bfNpc = makeBlockedFull(stNpc);
check('NPC: walking INTO the circle from outside is blocked',
  bfNpc(1000 - 23, 1000, R, null, 1000 - 60, 1000) === true);
check('NPC: stacked on an NPC can walk east out',
  bfNpc(1000 + 9, 1000, R, null, 1000, 1000) === false);
check('NPC: stacked on an NPC can walk north out',
  bfNpc(1000, 1000 - 9, R, null, 1000, 1000) === false);

// ---- animal circle (same rule) ------------------------------------------
var animal = { x: 2000, y: 2000 };
var stAn = { npcs: [], animals: [animal], remotePlayers: {} };
var bfAn = makeBlockedFull(stAn);
check('animal: walking INTO the circle from outside is blocked',
  bfAn(2000, 2000 - 23, R, null, 2000, 2000 - 60) === true);
check('animal: stacked on an animal can walk south out',
  bfAn(2000, 2000 + 9, R, null, 2000, 2000) === false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
