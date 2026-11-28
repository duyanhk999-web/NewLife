/* Cuộc Sống Ảo — test/coba-check.js (Cô Ba Sài Gòn NPC, 2026-11-28)
   Cô ba is a named walker NPC with 5 animated action rows (stand / walk /
   run / ride / fall) x 4 frames, side view facing left, from
   assets/characters/coba/ (sprite-sheet-gen pipeline). The 20 PNGs are
   uploaded separately (binary); the code must be safe to ship BEFORE they
   land: loadTextures is per-file try/catch (a 404 leaves TEX[k] null),
   makeFullBody falls back to the M0 code-drawn person, and the animator
   no-ops when there is no sprite and skips null frame textures.
   This check unit-tests the CLIENT animator headless (no browser, no
   PIXI): cobaAnimState / updateCobaAnim / cobaApplyFrame are extracted
   from src/main.js by brace matching and run with stubbed textures.
   It also locks the wiring: 20 ASSET_FILES entries, the npc-coba server
   spawn, the syncNpc mapping, and the fall hook in onAccident.
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
var stateSrc = extractFn(mainSrc, 'function cobaAnimState(down, riding, moving, speed)');
var animSrc = extractFn(mainSrc, 'function updateCobaAnim(n, dt, moving, speed)');
var applySrc = extractFn(mainSrc, 'function cobaApplyFrame(n)');
check('cobaAnimState exists in src/main.js', !!stateSrc);
check('updateCobaAnim exists in src/main.js', !!animSrc);
check('cobaApplyFrame exists in src/main.js', !!applySrc);

// ---- wiring: asset table -------------------------------------------------
var rows = ['stand', 'walk', 'run', 'ride', 'fall'];
var found = 0, badPath = [];
rows.forEach(function (row) {
  for (var i = 0; i < 4; i++) {
    var m = mainSrc.match(new RegExp('coba_' + row + '_' + i + ":\\s*'([^']+)'"));
    if (m) {
      found++;
      if (m[1] !== 'assets/characters/coba/' + row + '_' + i + '.png') badPath.push(m[1]);
    }
  }
});
check('20 coba ASSET_FILES entries (5 rows x 4)', found === 20, 'found=' + found);
check('all coba entries point at assets/characters/coba/', badPath.length === 0, badPath.join(', '));
check('COBA_FRAMES lists the same 5 rows x 4 keys',
  rows.every(function (row) {
    return ['0', '1', '2', '3'].every(function (i) {
      return mainSrc.indexOf("'coba_" + row + '_' + i + "'") >= 0;
    });
  }));

// ---- wiring: NPC creation, sync, fall hook -------------------------------
check('cô ba created in buildWorld (id npc-coba, isCoba)', 
  mainSrc.indexOf("id: 'npc-coba'") >= 0 && mainSrc.indexOf('isCoba: true') >= 0);
check('syncNpc maps npc-coba by id (never by npcs[] index)',
  mainSrc.indexOf("n.id === 'npc-coba'") >= 0);
check('onAccident sets downUntil for npc-coba (online fall)',
  /msg\.npcId === 'npc-coba' && cobaNpc\) cobaNpc\.downUntil = Date\.now\(\) \+ 3000/.test(mainSrc));
check('updateNPCs animates cô ba in both online and offline branches',
  (mainSrc.match(/updateCobaAnim\(n, dt/g) || []).length >= 4);
check('server _spawnNpcs spawns npc-coba + a walkers entry',
  citySrc.indexOf("id: 'npc-coba'") >= 0 && citySrc.indexOf('this.walkers.set(coba.id') >= 0);
check('server npc_talk falls back to persona mai for null personaId',
  citySrc.indexOf("const personaId = (w && w.personaId) || 'mai';") >= 0);
check('animator never flips the sprite itself (face flip only, existing code)',
  animSrc && animSrc.indexOf('scale') < 0 && applySrc && applySrc.indexOf('scale') < 0);

// ---- run the animator headless -------------------------------------------
var COBA_FRAMES = {
  stand: ['coba_stand_0', 'coba_stand_1', 'coba_stand_2', 'coba_stand_3'],
  walk: ['coba_walk_0', 'coba_walk_1', 'coba_walk_2', 'coba_walk_3'],
  run: ['coba_run_0', 'coba_run_1', 'coba_run_2', 'coba_run_3'],
  ride: ['coba_ride_0', 'coba_ride_1', 'coba_ride_2', 'coba_ride_3'],
  fall: ['coba_fall_0', 'coba_fall_1', 'coba_fall_2', 'coba_fall_3']
};
var COBA_FRAME_MS = { stand: 200, walk: 150, run: 100, ride: 150, fall: 750 };
var CHAR_H = 40;
function makeAnim(TEX) {
  var factory = new Function('TEX', 'CHAR_H', 'COBA_FRAMES', 'COBA_FRAME_MS', 'COBA_RUN_SPEED',
    stateSrc + '\n' + animSrc + '\n' + applySrc +
    '\nreturn { cobaAnimState: cobaAnimState, updateCobaAnim: updateCobaAnim };');
  return factory(TEX, CHAR_H, COBA_FRAMES, COBA_FRAME_MS, 120);
}
function fakeTex(name, w, h) { return { name: name, width: w, height: h }; }
function makeNpc(TEX) {
  return {
    cobaSpr: { texture: null, width: 0, height: 0 },
    downUntil: 0, riding: false,
    animState: 'stand', animFrame: 0, animTime: 0
  };
}
var anim = makeAnim({});

// state selection
check('state: down beats riding/moving -> fall',
  anim.cobaAnimState(true, true, true, 200) === 'fall');
check('state: riding -> ride', anim.cobaAnimState(false, true, false, 0) === 'ride');
check('state: moving fast (>120) -> run', anim.cobaAnimState(false, false, true, 121) === 'run');
check('state: moving at exactly 120 stays walk (boundary)',
  anim.cobaAnimState(false, false, true, 120) === 'walk');
check('state: moving slow -> walk', anim.cobaAnimState(false, false, true, 90) === 'walk');
check('state: idle -> stand', anim.cobaAnimState(false, false, false, 0) === 'stand');

// no sprite (M0 fallback, PNGs not uploaded yet): no-op, no throw
var npcNoSpr = { cobaSpr: null, downUntil: 0, riding: false, animState: 'stand', animFrame: 0, animTime: 0 };
var threw = false;
try { anim.updateCobaAnim(npcNoSpr, 0.2, true, 90); } catch (e) { threw = true; }
check('animator with no sprite (PNGs missing) is a no-op, no throw', !threw);

// all textures null (PNGs missing): no throw, texture stays null
var animNull = makeAnim({});
var npcNull = makeNpc({});
threw = false;
try {
  animNull.updateCobaAnim(npcNull, 0.2, true, 90);
  animNull.updateCobaAnim(npcNull, 0.2, true, 90);
} catch (e) { threw = true; }
check('animator with all textures null is a no-op, no throw', !threw && npcNull.cobaSpr.texture === null);

// textures present: walk cycles through frames, size stays 40px tall
var TEX = {};
rows.forEach(function (row) {
  for (var i = 0; i < 4; i++) TEX['coba_' + row + '_' + i] = fakeTex('coba_' + row + '_' + i, 314, 400);
});
var animFull = makeAnim(TEX);
var npc = makeNpc(TEX);
npc.cobaSpr.texture = TEX.coba_stand_0; npc.cobaSpr.height = 40; npc.cobaSpr.width = 40 * 314 / 400;
animFull.updateCobaAnim(npc, 0.16, true, 90); // 160ms > walk step 150ms
check('walk: one frame advances after 160ms', npc.animState === 'walk' && npc.animFrame === 1,
  npc.animState + '/' + npc.animFrame);
check('walk: texture swaps to walk_1, height stays 40px',
  npc.cobaSpr.texture === TEX.coba_walk_1 && npc.cobaSpr.height === 40,
  (npc.cobaSpr.texture && npc.cobaSpr.texture.name) + ' h=' + npc.cobaSpr.height);
animFull.updateCobaAnim(npc, 0.16, true, 90);
animFull.updateCobaAnim(npc, 0.16, true, 90);
animFull.updateCobaAnim(npc, 0.16, true, 90);
check('walk: loops back to frame 0 after 4 advances', npc.animFrame === 0, 'frame=' + npc.animFrame);
animFull.updateCobaAnim(npc, 0.01, true, 200); // small dt: fast -> run, frame resets to 0 and stays (10ms < run step 100ms)
check('fast move switches to run, frame resets to 0',
  npc.animState === 'run' && npc.animFrame === 0 && npc.cobaSpr.texture === TEX.coba_run_0,
  npc.animState + '/' + npc.animFrame + ' ' + (npc.cobaSpr.texture && npc.cobaSpr.texture.name));
animFull.updateCobaAnim(npc, 0.16, false, 0); // stops -> stand
check('stopping switches to stand', npc.animState === 'stand', npc.animState);

// fall: plays once, holds the last frame (lying flat) while down
var npcFall = makeNpc(TEX);
npcFall.cobaSpr.texture = TEX.coba_stand_0;
npcFall.downUntil = Date.now() + 3000;
for (var f = 0; f < 6; f++) animFull.updateCobaAnim(npcFall, 0.8, false, 0); // 6 x 800ms > fall step 750ms
check('fall: holds the last frame (lying flat) after the sequence',
  npcFall.animState === 'fall' && npcFall.animFrame === 3 &&
  npcFall.cobaSpr.texture === TEX.coba_fall_3,
  npcFall.animState + '/' + npcFall.animFrame + ' ' + (npcFall.cobaSpr.texture && npcFall.cobaSpr.texture.name));
npcFall.downUntil = 0; // down ends -> back to stand
animFull.updateCobaAnim(npcFall, 0.2, false, 0);
check('fall ends: state returns to stand when down expires',
  npcFall.animState === 'stand', npcFall.animState);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
