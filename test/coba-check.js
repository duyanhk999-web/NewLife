/* Cuộc Sống Ảo — test/coba-check.js (Cô Ba Sài Gòn NPC v2, 2026-11-28)
   Cô ba is a named walker NPC with a DIRECTION-AWARE animator using the
   12 v2 frames in assets/characters/coba-v2/ (CHARACTER ASSET SPEC v2:
   stand 3 angles, walk 3 angles x 2 steps, fall 3 angles; side view
   flipped in code). This replaces the v1 5-row side-only animator
   (stand/walk/run/ride/fall x4): run/ride are dropped (she walks at
   90 px/s, no NPC rides a bike), and walk steps advance by DISTANCE
   traveled (~14px/step), not wall-clock, so her feet match ground speed.
   The 12 PNGs are uploaded separately (binary); the code must be safe to
   ship BEFORE they land: loadTextures is per-file try/catch (a 404 leaves
   TEX[k] null), makeFullBody falls back to the M0 code-drawn person, and
   the animator no-ops when there is no sprite and skips null textures.
   The 20 v1 PNGs under assets/characters/coba/ are orphaned (the
   connector cannot delete files) — no code may reference them anymore.
   This check unit-tests the CLIENT animator headless (no browser, no
   PIXI): cobaFacing / cobaAnimState / updateCobaAnim / cobaApplyFrame
   are extracted from src/main.js by brace matching and run with stubbed
   textures. It also locks the wiring: 12 coba2_* ASSET_FILES entries,
   the npc-coba server spawn, the syncNpc mapping, and the fall hook in
   onAccident.
   Run: node test/coba-check.js   (exit 0 = all PASS) */
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

// ---- extract the animator from src/main.js (IIFE, not exported) --------
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
var facingSrc = extractFn(mainSrc, 'function cobaFacing(dx, dy)');
var stateSrc = extractFn(mainSrc, 'function cobaAnimState(down, moving, dx, dy, lastFacing)');
var animSrc = extractFn(mainSrc, 'function updateCobaAnim(n, dt, dx, dy)');
var applySrc = extractFn(mainSrc, 'function cobaApplyFrame(n)');
check('cobaFacing exists in src/main.js', !!facingSrc);
check('cobaAnimState exists in src/main.js', !!stateSrc);
check('updateCobaAnim exists in src/main.js', !!animSrc);
check('cobaApplyFrame exists in src/main.js', !!applySrc);

// ---- wiring: asset table -------------------------------------------------
var v2keys = [
  'coba2_stand_front', 'coba2_stand_side', 'coba2_stand_back',
  'coba2_walk_front_0', 'coba2_walk_front_1',
  'coba2_walk_side_0', 'coba2_walk_side_1',
  'coba2_walk_back_0', 'coba2_walk_back_1',
  'coba2_fall_front', 'coba2_fall_side', 'coba2_fall_back'
];
var found = 0, badPath = [];
v2keys.forEach(function (key) {
  var m = mainSrc.match(new RegExp(key + ":\\s*'([^']+)'"));
  if (m) {
    found++;
    var want = 'assets/characters/coba-v2/' + key.slice('coba2_'.length) + '.png';
    if (m[1] !== want) badPath.push(m[1] + ' != ' + want);
  }
});
check('12 coba2 ASSET_FILES entries (stand/walk/fall x 3 views)', found === 12, 'found=' + found);
check('all coba2 entries point at assets/characters/coba-v2/', badPath.length === 0, badPath.join(', '));
check('COBA2_FRAMES lists the same 12 keys',
  v2keys.every(function (k) { return mainSrc.indexOf("'" + k + "'") >= 0; }));
check('no old v1 coba_* ASSET_FILES entries remain',
  !/coba_(stand|walk|run|ride|fall)_\d/.test(mainSrc));
check('no run/ride states in the cô ba v2 animator',
  !/run:|ride:/.test(mainSrc.slice(mainSrc.indexOf('var COBA2_FRAMES'), mainSrc.indexOf('var PLAYER_FRAMES'))) &&
  stateSrc.indexOf("'run'") < 0 && stateSrc.indexOf("'ride'") < 0);
check('COBA_STEP_PX is 14 (one walk step per ~14px traveled)',
  /var COBA_STEP_PX = 14;/.test(mainSrc));

// ---- wiring: NPC creation, sync, fall hook -------------------------------
check('cô ba created in buildWorld (id npc-coba, isCoba, v2 stand_front)',
  mainSrc.indexOf("id: 'npc-coba'") >= 0 && mainSrc.indexOf('isCoba: true') >= 0 &&
  mainSrc.indexOf("makeFullBody(TEX.coba2_stand_front || null, 'Cô Ba')") >= 0 &&
  mainSrc.indexOf("animState: 'stand_front', animFrame: 0, animDist: 0, facing: 'front'") >= 0);
check('syncNpc maps npc-coba by id (never by npcs[] index)',
  mainSrc.indexOf("n.id === 'npc-coba'") >= 0);
check('onAccident sets downUntil for npc-coba (online fall)',
  /msg\.npcId === 'npc-coba' && cobaNpc\) cobaNpc\.downUntil = Date\.now\(\) \+ 3000/.test(mainSrc));
check('updateNPCs animates cô ba with (dx, dy) in both branches',
  (mainSrc.match(/updateCobaAnim\(n, dt, [a-zA-Z0-9_, ]+\)/g) || []).length >= 5);
check('updateNPCs skips the generic flip for cô ba (animator owns it)',
  !/n\.isCoba \? 1 : -1/.test(mainSrc) &&
  (mainSrc.match(/if \(!n\.isCoba\) \{/g) || []).length === 2);
check('server _spawnNpcs spawns npc-coba + a walkers entry',
  citySrc.indexOf("id: 'npc-coba'") >= 0 && citySrc.indexOf('this.walkers.set(coba.id') >= 0);
check('server npc_talk falls back to persona mai for null personaId',
  citySrc.indexOf("const personaId = (w && w.personaId) || 'mai';") >= 0);
check('animator flips the face container, never the sprite itself',
  animSrc && animSrc.indexOf('cobaSpr.scale') < 0 && applySrc && applySrc.indexOf('scale') < 0);

// ---- run the animator headless -------------------------------------------
var COBA2_FRAMES = {
  stand: { front: 'coba2_stand_front', side: 'coba2_stand_side', back: 'coba2_stand_back' },
  walk: {
    front: ['coba2_walk_front_0', 'coba2_walk_front_1'],
    side: ['coba2_walk_side_0', 'coba2_walk_side_1'],
    back: ['coba2_walk_back_0', 'coba2_walk_back_1']
  },
  fall: { front: 'coba2_fall_front', side: 'coba2_fall_side', back: 'coba2_fall_back' }
};
var CHAR_H = 40;
function makeAnim(TEX) {
  var factory = new Function('TEX', 'CHAR_H', 'COBA2_FRAMES', 'COBA_STEP_PX',
    facingSrc + '\n' + stateSrc + '\n' + animSrc + '\n' + applySrc +
    '\nreturn { cobaFacing: cobaFacing, cobaAnimState: cobaAnimState, updateCobaAnim: updateCobaAnim };');
  return factory(TEX, CHAR_H, COBA2_FRAMES, 14);
}
function fakeTex(name, w, h) { return { name: name, width: w, height: h }; }
function makeNpc(TEX) {
  return {
    cobaSpr: { texture: null, width: 0, height: 0 },
    face: { scale: { x: 1, y: 1 } },
    downUntil: 0,
    animState: 'stand_front', animFrame: 0, animDist: 0, facing: 'front'
  };
}
var anim = makeAnim({});

// facing: dominant direction
check('facing: up -> back', anim.cobaFacing(0, -10) === 'back');
check('facing: down -> front', anim.cobaFacing(0, 10) === 'front');
check('facing: left -> side', anim.cobaFacing(-10, 0) === 'side');
check('facing: right -> side', anim.cobaFacing(10, 0) === 'side');
check('facing: up-dominant diagonal -> back', anim.cobaFacing(5, -10) === 'back');
check('facing: down-dominant diagonal -> front', anim.cobaFacing(5, 10) === 'front');
check('facing: exact tie counts as horizontal -> side', anim.cobaFacing(10, 10) === 'side' && anim.cobaFacing(10, -10) === 'side');

// state selection
check('state: down -> fall_<facing at knockdown>',
  anim.cobaAnimState(true, true, 10, 0, 'side') === 'fall_side' &&
  anim.cobaAnimState(true, false, 0, 0, 'back') === 'fall_back');
check('state: moving up -> walk_back', anim.cobaAnimState(false, true, 0, -10, 'front') === 'walk_back');
check('state: moving down -> walk_front', anim.cobaAnimState(false, true, 0, 10, 'side') === 'walk_front');
check('state: moving left -> walk_side', anim.cobaAnimState(false, true, -10, 0, 'front') === 'walk_side');
check('state: moving right -> walk_side', anim.cobaAnimState(false, true, 10, 0, 'front') === 'walk_side');
check('state: idle keeps last facing -> stand_<facing>',
  anim.cobaAnimState(false, false, 0, 0, 'back') === 'stand_back' &&
  anim.cobaAnimState(false, false, 0, 0, 'side') === 'stand_side');

// no sprite (M0 fallback, PNGs not uploaded yet): no-op, no throw
var npcNoSpr = makeNpc({});
npcNoSpr.cobaSpr = null;
var threw = false;
try { anim.updateCobaAnim(npcNoSpr, 0.2, 10, 0); } catch (e) { threw = true; }
check('animator with no sprite (PNGs missing) is a no-op, no throw', !threw);

// all textures null (PNGs missing): no throw, texture stays null
var animNull = makeAnim({});
var npcNull = makeNpc({});
threw = false;
try {
  animNull.updateCobaAnim(npcNull, 0.2, 10, 0);
  animNull.updateCobaAnim(npcNull, 0.2, 10, 0);
} catch (e) { threw = true; }
check('animator with all textures null is a no-op, no throw', !threw && npcNull.cobaSpr.texture === null);

// textures present: distance-based walk, flip, height
var TEX = {};
v2keys.forEach(function (k) {
  // stand ~880x870, walk ~633x634, fall ~893x908 (real v2 frame dims)
  var dims = k.indexOf('_stand_') >= 0 ? [880, 870] : k.indexOf('_walk_') >= 0 ? [633, 634] : [893, 908];
  TEX[k] = fakeTex(k, dims[0], dims[1]);
});
var animFull = makeAnim(TEX);
var npc = makeNpc(TEX);
npc.cobaSpr.texture = TEX.coba2_stand_front; npc.cobaSpr.height = 40; npc.cobaSpr.width = 40 * 880 / 870;
// walk right 7px: not enough for a step yet
animFull.updateCobaAnim(npc, 0.16, 7, 0);
check('walk: 7px traveled stays on frame 0', npc.animState === 'walk_side' && npc.animFrame === 0,
  npc.animState + '/' + npc.animFrame);
check('walk: moving right mirrors the side view (face.scale.x = -1)',
  npc.face.scale.x === -1, 'scale.x=' + npc.face.scale.x);
animFull.updateCobaAnim(npc, 0.16, 7, 0); // +7px = 14px total -> step
check('walk: 14px total advances one frame', npc.animFrame === 1,
  'frame=' + npc.animFrame);
check('walk: texture swaps to walk_side_1, height stays 40px',
  npc.cobaSpr.texture === TEX.coba2_walk_side_1 && npc.cobaSpr.height === 40,
  (npc.cobaSpr.texture && npc.cobaSpr.texture.name) + ' h=' + npc.cobaSpr.height);
animFull.updateCobaAnim(npc, 0.16, 14, 0); // +14px = 1 step -> back to frame 0
check('walk: next 14px advances back to frame 0', npc.animFrame === 0, 'frame=' + npc.animFrame);
animFull.updateCobaAnim(npc, 0.16, 28, 0); // +28px = 2 steps -> 0 -> 1 -> 0
check('walk: 28px advances two steps (loops 0 -> 1 -> 0)', npc.animFrame === 0, 'frame=' + npc.animFrame);
animFull.updateCobaAnim(npc, 0.16, 0, 0); // paused: legs stop
check('walk: paused (0px) advances nothing, idle keeps side facing',
  npc.animState === 'stand_side' && npc.animFrame === 0 && npc.animDist === 0,
  npc.animState + '/' + npc.animFrame);
// walk up: back view, unmirrored
animFull.updateCobaAnim(npc, 0.16, 0, -14);
check('walk up: back view, face unmirrored (+1)',
  npc.animState === 'walk_back' && npc.face.scale.x === 1,
  npc.animState + ' scale.x=' + npc.face.scale.x);
check('walk up: texture swaps to walk_back_1 after 14px',
  npc.cobaSpr.texture === TEX.coba2_walk_back_1,
  npc.cobaSpr.texture && npc.cobaSpr.texture.name);
animFull.updateCobaAnim(npc, 0.16, 0, 0); // stop facing up
check('idle after walking up keeps back view (stand_back)',
  npc.animState === 'stand_back', npc.animState);
// walk left: side view as drawn (+1)
animFull.updateCobaAnim(npc, 0.16, -14, 0);
check('walk left: side view as drawn (face.scale.x = +1)',
  npc.animState === 'walk_side' && npc.face.scale.x === 1,
  npc.animState + ' scale.x=' + npc.face.scale.x);
// fall: knocked down while facing side -> fall_side, holds, then stands
var npcFall = makeNpc(TEX);
npcFall.cobaSpr.texture = TEX.coba2_stand_side;
npcFall.facing = 'side'; npcFall.animState = 'stand_side';
npcFall.downUntil = Date.now() + 3000;
animFull.updateCobaAnim(npcFall, 0.2, 0, 0);
check('fall: knocked down facing side -> fall_side',
  npcFall.animState === 'fall_side' && npcFall.cobaSpr.texture === TEX.coba2_fall_side,
  npcFall.animState + ' ' + (npcFall.cobaSpr.texture && npcFall.cobaSpr.texture.name));
check('fall: height stays 40px, width by aspect (wide lying figure)',
  npcFall.cobaSpr.height === 40 && Math.abs(npcFall.cobaSpr.width - 40 * 893 / 908) < 0.01,
  'w=' + npcFall.cobaSpr.width.toFixed(1) + ' h=' + npcFall.cobaSpr.height);
animFull.updateCobaAnim(npcFall, 0.2, 5, 5); // still down: view frozen, no walk
check('fall: stays fall_side while down even if displaced',
  npcFall.animState === 'fall_side', npcFall.animState);
npcFall.downUntil = 0; // down ends -> back to stand with last facing
animFull.updateCobaAnim(npcFall, 0.2, 0, 0);
check('fall ends: state returns to stand_side when down expires',
  npcFall.animState === 'stand_side', npcFall.animState);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
