/* Cuộc Sống Ảo — test/player-check.js (player action frames, 2026-11-28)
   The main character animates with 3 action rows (walk / run / ride) x 4
   frames, side view facing left, from assets/characters/player/
   (sprite-sheet-gen pipeline). No stand row — idle keeps the front-view
   heroFull sprite, as does pure up/down movement. Frames advance by
   DISTANCE traveled (~14px/frame), not wall-clock, so the feet match
   ground speed and stop when the player pauses (same rule as the cô ba
   v2 animator). Remote players whose
   base texture is heroFull share the same animator; other avatars keep
   their own full-body sprite. The 12 PNGs are uploaded (commit 6103be0);
   the code must stay safe if one is missing: loadTextures is per-file
   try/catch (a 404 leaves TEX[k] null), makeFullBody falls back to the
   M0 code-drawn person, and the animator no-ops when there is no sprite
   and skips null frame textures.
   This check unit-tests the CLIENT animator headless (no browser, no
   PIXI): playerAnimState / updatePlayerAnim / playerApplyFrame are
   extracted from src/main.js by brace matching and run with stubbed
   textures. It also locks the wiring: 12 ASSET_FILES entries, the
   buildWorld spr hookup, the updatePlayer + updateRemotePlayers hooks,
   the fainted restore, and the left-facing flip fix (side frames face
   left: moving left shows them as drawn, moving right mirrors them —
   the old mapping was inverted for side-view art).
   Run: node test/player-check.js   (exit 0 = all PASS) */
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
var stateSrc = extractFn(mainSrc, 'function playerAnimState(riding, sprinting, moving, horizontal)');
var animSrc = extractFn(mainSrc, 'function updatePlayerAnim(t, dt, state, dist)');
var applySrc = extractFn(mainSrc, 'function playerApplyFrame(t)');
check('playerAnimState exists in src/main.js', !!stateSrc);
check('updatePlayerAnim exists in src/main.js', !!animSrc);
check('playerApplyFrame exists in src/main.js', !!applySrc);

// ---- wiring: asset table -------------------------------------------------
var rows = ['walk', 'run', 'ride'];
var found = 0, badPath = [];
rows.forEach(function (row) {
  for (var i = 0; i < 4; i++) {
    var m = mainSrc.match(new RegExp('player_' + row + '_' + i + ":\\s*'([^']+)'"));
    if (m) {
      found++;
      if (m[1] !== 'assets/characters/player/' + row + '_' + i + '.png') badPath.push(m[1]);
    }
  }
});
check('12 player ASSET_FILES entries (3 rows x 4)', found === 12, 'found=' + found);
check('all player entries point at assets/characters/player/', badPath.length === 0, badPath.join(', '));
check('PLAYER_FRAMES lists the same 3 rows x 4 keys',
  rows.every(function (row) {
    return ['0', '1', '2', '3'].every(function (i) {
      return mainSrc.indexOf("'player_" + row + '_' + i + "'") >= 0;
    });
  }));
check('PLAYER_RUN_SPEED is 240 (walk 180, sprint 300)',
  /var PLAYER_RUN_SPEED = 240;/.test(mainSrc));
check('PLAYER_STEP_PX is 14 (one frame per ~14px traveled, distance-based)',
  /var PLAYER_STEP_PX = 14;/.test(mainSrc) && !/PLAYER_FRAME_MS/.test(mainSrc));

// ---- wiring: local player ------------------------------------------------
check('buildWorld hooks playerAnim.spr from the player face sprite',
  /playerAnim\.spr = \(pFace\.children/.test(mainSrc));
check('updatePlayer drives the animator (riding/sprint/moving/horizontal) + distance',
  /playerAnimState\(!!currentRidingId\(\), sprinting, len > 0\.1, Math\.abs\(input\.dx\) > 0\.1\)/.test(mainSrc) &&
  /var pMoved = Math\.hypot\(playerState\.x - ox, playerState\.y - oy\);/.test(mainSrc) &&
  mainSrc.indexOf('updatePlayerAnim(playerAnim, dt, pState, pMoved)') >= 0);
check('fainted branch restores the idle (front-view) frame',
  /Fainted: back to the front-view sprite/.test(mainSrc) &&
  mainSrc.indexOf("playerAnim.animState = 'idle'; playerAnim.animFrame = 0; playerAnim.animDist = 0;") >= 0);

// ---- wiring: flip (left-facing art) --------------------------------------
check('player flip: side view moving left shows as drawn (+1), right mirrors (-1)',
  /var pSide = playerAnim\.animState !== 'idle';/.test(mainSrc) &&
  /if \(input\.dx < -0\.1\) face2\.scale\.x = pSide \? 1 : -1;/.test(mainSrc) &&
  /else if \(input\.dx > 0\.1\) face2\.scale\.x = pSide \? -1 : 1;/.test(mainSrc));
check('cô ba flip is owned by her v2 animator (no isCoba ternary in updateNPCs)',
  !/n\.isCoba \? 1 : -1/.test(mainSrc) &&
  mainSrc.indexOf('function updateCobaAnim(n, dt, dx, dy)') >= 0);
check('animator never flips the sprite itself (face flip only, existing code)',
  animSrc && animSrc.indexOf('scale') < 0 && applySrc && applySrc.indexOf('scale') < 0);

// ---- wiring: remote players ----------------------------------------------
check('createRemotePlayer gives hero/citizen avatars a playerAnim copy',
  /entry\.playerAnim = \(entry\.avatar === 'hero' \|\| entry\.avatar === 'citizen'\)/.test(mainSrc));
check('createRemotePlayer stores vehicleId on the entry',
  /vehicleId: p\.vehicleId \|\| ''/.test(mainSrc));
check('syncRemotePlayer stores the synced vehicleId',
  /if \(p\.vehicleId !== undefined\) entry\.vehicleId = p\.vehicleId \|\| '';/.test(mainSrc));
check('updateRemotePlayers animates hero remotes + side-aware flip',
  /playerAnimState\(!!r\.vehicleId, rSpeed > PLAYER_RUN_SPEED,/.test(mainSrc) &&
  /updatePlayerAnim\(r\.playerAnim, dt, rState, Math\.hypot\(mdx, mdy\)\)/.test(mainSrc) &&
  /var rSide = r\.playerAnim && r\.playerAnim\.animState !== 'idle';/.test(mainSrc));

// ---- run the animator headless -------------------------------------------
var PLAYER_FRAMES = {
  walk: ['player_walk_0', 'player_walk_1', 'player_walk_2', 'player_walk_3'],
  run: ['player_run_0', 'player_run_1', 'player_run_2', 'player_run_3'],
  ride: ['player_ride_0', 'player_ride_1', 'player_ride_2', 'player_ride_3']
};
var PLAYER_STEP_PX = 14;
var CHAR_H = 40;
function makeAnim(TEX) {
  var factory = new Function('TEX', 'CHAR_H', 'PLAYER_FRAMES', 'PLAYER_STEP_PX',
    stateSrc + '\n' + animSrc + '\n' + applySrc +
    '\nreturn { playerAnimState: playerAnimState, updatePlayerAnim: updatePlayerAnim };');
  return factory(TEX, CHAR_H, PLAYER_FRAMES, PLAYER_STEP_PX);
}
function fakeTex(name, w, h) { return { name: name, width: w, height: h }; }
function makeT(TEX) {
  return { spr: { texture: null, width: 0, height: 0 }, animState: 'idle', animFrame: 0, animDist: 0 };
}
var anim = makeAnim({});

// state selection
check('state: riding beats sprinting/moving -> ride',
  anim.playerAnimState(true, true, true, true) === 'ride');
check('state: riding while idle still -> ride',
  anim.playerAnimState(true, false, false, false) === 'ride');
check('state: sprinting + moving horizontal -> run',
  anim.playerAnimState(false, true, true, true) === 'run');
check('state: moving horizontal, not sprinting -> walk',
  anim.playerAnimState(false, false, true, true) === 'walk');
check('state: moving but pure vertical -> idle (front view kept)',
  anim.playerAnimState(false, true, true, false) === 'idle');
check('state: sprinting but not moving -> idle',
  anim.playerAnimState(false, true, false, true) === 'idle');
check('state: idle -> idle', anim.playerAnimState(false, false, false, false) === 'idle');

// no sprite (M0 fallback, PNGs not uploaded yet): no-op, no throw
var tNoSpr = { spr: null, animState: 'idle', animFrame: 0, animDist: 0 };
var threw = false;
try { anim.updatePlayerAnim(tNoSpr, 0.2, 'walk', 14); } catch (e) { threw = true; }
check('animator with no sprite (PNGs missing) is a no-op, no throw', !threw);

// all textures null (PNGs missing): no throw, texture stays null
var animNull = makeAnim({});
var tNull = makeT({});
threw = false;
try {
  animNull.updatePlayerAnim(tNull, 0.2, 'walk', 14);
  animNull.updatePlayerAnim(tNull, 0.2, 'walk', 14);
} catch (e) { threw = true; }
check('animator with all textures null is a no-op, no throw', !threw && tNull.spr.texture === null);

// textures present: walk cycles through frames by DISTANCE, size stays 40px tall
var TEX = { heroFull: fakeTex('heroFull', 100, 200) };
rows.forEach(function (row) {
  for (var i = 0; i < 4; i++) TEX['player_' + row + '_' + i] = fakeTex('player_' + row + '_' + i, 280, 280);
});
var animFull = makeAnim(TEX);
var t = makeT(TEX);
t.spr.texture = TEX.heroFull; t.spr.height = 40; t.spr.width = 20;
animFull.updatePlayerAnim(t, 0.16, 'walk', 7); // 7px < step 14px: no advance yet
check('walk: 7px traveled stays on frame 0', t.animState === 'walk' && t.animFrame === 0,
  t.animState + '/' + t.animFrame);
animFull.updatePlayerAnim(t, 0.16, 'walk', 7); // +7px = 14px total -> step
check('walk: 14px total advances one frame', t.animFrame === 1,
  'frame=' + t.animFrame);
check('walk: texture swaps to walk_1, height stays 40px',
  t.spr.texture === TEX.player_walk_1 && t.spr.height === 40,
  (t.spr.texture && t.spr.texture.name) + ' h=' + t.spr.height);
animFull.updatePlayerAnim(t, 0.16, 'walk', 14);
animFull.updatePlayerAnim(t, 0.16, 'walk', 14);
animFull.updatePlayerAnim(t, 0.16, 'walk', 14);
check('walk: loops back to frame 0 after 4 advances', t.animFrame === 0, 'frame=' + t.animFrame);
animFull.updatePlayerAnim(t, 0.16, 'walk', 0); // paused: legs stop, no advance
check('walk: paused (0px) advances nothing', t.animFrame === 0 && t.animDist === 0,
  'frame=' + t.animFrame + ' dist=' + t.animDist);
animFull.updatePlayerAnim(t, 0.01, 'run', 0); // state switches, frame resets to 0, no advance at 0px
check('walk -> run switches state, frame resets to 0',
  t.animState === 'run' && t.animFrame === 0 && t.spr.texture === TEX.player_run_0,
  t.animState + '/' + t.animFrame + ' ' + (t.spr.texture && t.spr.texture.name));
animFull.updatePlayerAnim(t, 0.16, 'ride', 14);
check('ride: texture swaps to ride_1 after 14px',
  t.animState === 'ride' && t.animFrame === 1 && t.spr.texture === TEX.player_ride_1,
  t.animState + '/' + t.animFrame + ' ' + (t.spr.texture && t.spr.texture.name));
animFull.updatePlayerAnim(t, 0.16, 'idle', 0); // stops -> idle restores heroFull
check('stopping switches to idle and restores the heroFull front view',
  t.animState === 'idle' && t.spr.texture === TEX.heroFull,
  t.animState + ' ' + (t.spr.texture && t.spr.texture.name));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
