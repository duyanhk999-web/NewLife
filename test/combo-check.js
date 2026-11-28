/* Cuộc Sống Ảo — test/combo-check.js (Phase C: NPC/bot intelligence, 2026-11-28)
   1. EVENT REACTIONS: walkers within ~400px of an accident pause, face the
      spot and show a reaction line for ~4s (server npc_react + client
      onNpcReact; offline mirror offlineNpcReact).
   2. PLAYER MEMORY: per-player talk counts per NPC, tiers 0-2 / 3-7 / 8+
      (stranger / acquaintance / friend), tiered + time-of-day talk lines,
      tier shown in the talk UI. NO economy effects (no discounts/gifts).
   3. DAILY SCHEDULE: walker destination bias by game clock (morning
      market/shop, noon food/shop, evening cafe/plaza, night half go home).
   4. BOT JOB CHOICE: bots take the best-paying work among CURRENT systems
      (best free shipper slot vs best waiting taxi customer). There is NO
      shipper bidding/auction (accept is first-come-first-served), so no
      auction is built — best-pay selection only.
   Headless (no browser, no PIXI): pure helpers are required directly;
   client functions (applyOfflineSchedule, offlineNpcReact, npcPersonaLine)
   are extracted from src/main.js by brace matching and run with stubs.
   Run: node test/combo-check.js   (exit 0 = all PASS) */
'use strict';

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var BotBrain = require(path.join(ROOT, 'shared/botBrain.js'));
var M3 = require(path.join(ROOT, 'shared/m3.js'));
var RoadNet = require(path.join(ROOT, 'shared/roadnet.js'));

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('PASS - ' + name + (detail ? ' (' + detail + ')' : '')); }
  else { failed++; console.log('FAIL - ' + name + (detail ? ' (' + detail + ')' : '')); }
}
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
var mainSrc = read('src/main.js');
var citySrc = read('server/rooms/CityRoom.js');
var netSrc = read('src/net.js');

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

// ---- 1. botBrain: memory tiers --------------------------------------------
check('talkTier boundaries 0/2->0, 3/7->1, 8/100->2',
  BotBrain.talkTier(0) === 0 && BotBrain.talkTier(2) === 0 &&
  BotBrain.talkTier(3) === 1 && BotBrain.talkTier(7) === 1 &&
  BotBrain.talkTier(8) === 2 && BotBrain.talkTier(100) === 2);
check('talkTierName 0/1/2 = Người lạ / Quen biết / Bạn bè',
  BotBrain.talkTierName(0) === 'Người lạ' && BotBrain.talkTierName(1) === 'Quen biết' &&
  BotBrain.talkTierName(2) === 'Bạn bè');

// ---- 2. botBrain: time-of-day periods --------------------------------------
check('timePeriod 06:00-11:00 morning, 11:00-13:00 noon, 13:00-18:00 evening, else night',
  BotBrain.timePeriod(360) === 'morning' && BotBrain.timePeriod(659) === 'morning' &&
  BotBrain.timePeriod(660) === 'noon' && BotBrain.timePeriod(779) === 'noon' &&
  BotBrain.timePeriod(780) === 'evening' && BotBrain.timePeriod(1079) === 'evening' &&
  BotBrain.timePeriod(1080) === 'night' && BotBrain.timePeriod(0) === 'night' &&
  BotBrain.timePeriod(1439) === 'night' && BotBrain.timePeriod(359) === 'night');

// ---- 3. botBrain: every persona has the Phase C pools ----------------------
var poolOk = true, poolBad = [];
BotBrain.PERSONAS.forEach(function (p) {
  if (!p.friendLines || p.friendLines.length !== 2) { poolOk = false; poolBad.push(p.id + ':friend'); }
  if (!p.closeLines || p.closeLines.length !== 2) { poolOk = false; poolBad.push(p.id + ':close'); }
  if (!p.timeLines || !p.timeLines.morning || !p.timeLines.noon || !p.timeLines.evening || !p.timeLines.night) {
    poolOk = false; poolBad.push(p.id + ':time');
  }
  if (!p.reactLines || p.reactLines.length !== 2) { poolOk = false; poolBad.push(p.id + ':react'); }
});
check('all 6 personas have friendLines(2) + closeLines(2) + timeLines(4) + reactLines(2)',
  poolOk, poolBad.join(', ') || 'all present');

// NO economy effects: tier lines must never promise a discount/gift.
var econWords = /bớt|giảm giá|giảm|tặng|miễn phí|khuyến mãi|không lấy tiền/i;
var econBad = [];
BotBrain.PERSONAS.forEach(function (p) {
  (p.friendLines.concat(p.closeLines)).forEach(function (l) {
    if (econWords.test(l)) econBad.push(p.id + ':"' + l + '"');
  });
});
check('tier lines promise no discount/gift (no economy effects in Phase C)',
  econBad.length === 0, econBad.join('; ') || 'clean');

// ---- 4. botBrain: pickTalkLine / pickReactLine -----------------------------
var tung = BotBrain.PERSONAS[0]; // Anh Tùng
var alwaysHigh = function () { return 0.9; }; // skips the 30% time branch, picks last pool item
var alwaysLow = function () { return 0.1; };  // takes the 30% time branch
check('pickTalkLine tier 0 uses persona.lines',
  BotBrain.pickTalkLine(tung, 0, 'morning', null, alwaysHigh) === tung.lines[2]);
check('pickTalkLine tier 1 uses friendLines',
  BotBrain.pickTalkLine(tung, 1, 'morning', null, alwaysHigh) === tung.friendLines[1]);
check('pickTalkLine tier 2 uses closeLines',
  BotBrain.pickTalkLine(tung, 2, 'morning', null, alwaysHigh) === tung.closeLines[1]);
check('pickTalkLine ~30% time branch returns the time greeting',
  BotBrain.pickTalkLine(tung, 0, 'morning', null, alwaysLow) === tung.timeLines.morning &&
  BotBrain.pickTalkLine(tung, 0, 'night', null, alwaysLow) === tung.timeLines.night);
check('pickTalkLine avoids the last line (no repeat)',
  BotBrain.pickTalkLine(tung, 1, 'morning', tung.friendLines[1], alwaysHigh) === tung.friendLines[0]);
check('pickReactLine returns a react line',
  BotBrain.pickReactLine(tung, null, function () { return 0; }) === tung.reactLines[0] &&
  BotBrain.pickReactLine(tung, tung.reactLines[0], function () { return 0.9; }) === tung.reactLines[1]);

// ---- 5. m3: daily schedule -------------------------------------------------
check('schedulePeriod 06-11 morning, 11-13 noon, 13-17 roam, 17-21 evening, 21-06 night',
  M3.schedulePeriod(360) === 'morning' && M3.schedulePeriod(660) === 'noon' &&
  M3.schedulePeriod(780) === 'roam' && M3.schedulePeriod(1020) === 'evening' &&
  M3.schedulePeriod(1260) === 'night' && M3.schedulePeriod(0) === 'night' &&
  M3.schedulePeriod(359) === 'night' && M3.schedulePeriod(1259) === 'evening');
function spotsEq(a, b) {
  return a.length === b.length && a.every(function (s, i) { return s.x === b[i].x && s.y === b[i].y; });
}
check('scheduleSpots morning = market + shop',
  spotsEq(M3.scheduleSpots('morning'), [M3.SCHEDULE_SPOTS.market, M3.SCHEDULE_SPOTS.shop]));
check('scheduleSpots noon = shop + market (food)',
  spotsEq(M3.scheduleSpots('noon'), [M3.SCHEDULE_SPOTS.shop, M3.SCHEDULE_SPOTS.market]));
check('scheduleSpots evening = cafe + plaza',
  spotsEq(M3.scheduleSpots('evening'), [M3.SCHEDULE_SPOTS.cafe, M3.SCHEDULE_SPOTS.plaza]));
check('scheduleSpots roam/night = no bias',
  M3.scheduleSpots('roam').length === 0 && M3.scheduleSpots('night').length === 0);

// ---- 6. m3: bot job choice (pure) ------------------------------------------
var shipSlots = [
  { pickupX: 4155, pickupY: 2910, targetX: 2430, targetY: 2650, lockedBy: null, poiName: 'Plaza' },
  { pickupX: 3225, pickupY: 1565, targetX: 4125, targetY: 1635, lockedBy: 'someone', poiName: 'Hosp' }
];
var bestShip = M3.bestShipperPayFor(shipSlots, false);
check('bestShipperPayFor skips locked slots, pays walk reward for the free one',
  bestShip && bestShip.pay === 16000 && bestShip.poiName === 'Plaza',
  bestShip ? String(bestShip.pay) : 'null');
check('bestShipperPayFor all locked -> null',
  M3.bestShipperPayFor([shipSlots[1]], false) === null);
var taxiCusts = [
  { npcId: 'npc-taxi-1', x: 1230, y: 1230, destX: 2430, destY: 2650, poiName: 'Plaza' },
  { npcId: 'npc-taxi-2', x: 2430, y: 1230, destX: 2430, destY: 2650, poiName: 'Plaza' }
];
var bestTaxi = M3.bestTaxiPayFor(taxiCusts, false);
check('bestTaxiPayFor picks the highest driverReceives fare',
  bestTaxi && bestTaxi.pay === 19000 && bestTaxi.npcId === 'npc-taxi-1',
  bestTaxi ? String(bestTaxi.pay) : 'null');
check('bestTaxiPayFor no customers -> null', M3.bestTaxiPayFor([], false) === null);
check('chooseBotJob: higher pay wins, tie -> shipper, none -> null',
  M3.chooseBotJob({ pay: 15000 }, { pay: 20000 }) === 'taxi' &&
  M3.chooseBotJob({ pay: 20000 }, { pay: 15000 }) === 'shipper' &&
  M3.chooseBotJob({ pay: 15000 }, { pay: 15000 }) === 'shipper' &&
  M3.chooseBotJob(null, null) === null);

// ---- 7. roadnet: bias / pauseMult / ignoreHome ----------------------------
var w0 = RoadNet.createWalker(0, { speed: 90 });
check('createWalker defaults bias null, biasWeight 0.7, pauseMult 1, ignoreHome false',
  w0.bias === null && w0.biasWeight === 0.7 && w0.pauseMult === 1 && w0.ignoreHome === false);
// Node 1: plain links to 0 and 16, crosswalk links to 3 and 4.
var plainTarget = RoadNet.PED[0];
var wb = RoadNet.createWalker(1, { speed: 90, rnd: function () { return 0.99; }, bias: { x: plainTarget.x, y: plainTarget.y }, biasWeight: 1 });
RoadNet.stepWalker(wb, 0.1, 1000);
check('biased walker picks the link closest to the bias point',
  wb.to === 0, 'chose ' + wb.to);
var wu = RoadNet.createWalker(1, { speed: 90, rnd: function () { return 0.99; }, bias: { x: plainTarget.x, y: plainTarget.y }, biasWeight: 0 });
RoadNet.stepWalker(wu, 0.1, 1000);
check('biasWeight 0 ignores the bias (random link)',
  (wu.pending && wu.pending.to === 4) || wu.to === 4, 'pending ' + (wu.pending && wu.pending.to) + ' to ' + wu.to);
function pauseFor(mult) {
  var w = RoadNet.createWalker(1, { speed: 5000, pauseMult: mult });
  var seq = [0.1, 0.1, 0.5], k = 0; // choice, pause chance (<0.15), duration 0.5
  w.rnd = function () { return seq[k++ % seq.length]; };
  w.x = RoadNet.PED[1].x; w.y = RoadNet.PED[1].y; w.at = 1; w.to = null; w.prev = null; w.pending = null;
  RoadNet.stepWalker(w, 1.0, 5000);
  return w.pauseUntil - 5000;
}
check('pauseMult 1 -> 4000ms pause, pauseMult 2 -> 8000ms (night idle longer)',
  pauseFor(1) === 4000 && pauseFor(2) === 8000, pauseFor(1) + '/' + pauseFor(2));
var wi = RoadNet.createWalker(1, { speed: 90, rnd: function () { return 0.99; }, home: { x: 0, y: 0 }, radius: 10, bias: { x: plainTarget.x, y: plainTarget.y }, biasWeight: 1, ignoreHome: true });
RoadNet.stepWalker(wi, 0.1, 1000);
check('ignoreHome lets a bot on a job follow its bias out of the home radius',
  wi.to === 0, 'chose ' + wi.to);

// ---- 8. server wiring (CityRoom.js) ----------------------------------------
check('server: REACT_RADIUS 400 / REACT_MS 4000 constants',
  /const REACT_RADIUS = 400;/.test(citySrc) && /const REACT_MS = 4000;/.test(citySrc));
check('server: npcTalkCounts map (per-player talk counts, room session)',
  citySrc.indexOf('this.npcTalkCounts = new Map();') >= 0);
check('server: talk counts + tier + tiered line in _onInteract',
  citySrc.indexOf('BotBrain.talkTier(talks)') >= 0 &&
  citySrc.indexOf('BotBrain.pickTalkLine(') >= 0 &&
  citySrc.indexOf('tierName: BotBrain.talkTierName(tier), talks,') >= 0);
check('server: _broadcastAccidentReaction broadcasts npc_react',
  citySrc.indexOf("_broadcastAccidentReaction(x, y, now, excludeId)") >= 0 &&
  citySrc.indexOf("this.broadcast('npc_react'") >= 0);
check('server: reaction called from both _hitPlayer and _knockDownNpc',
  (citySrc.match(/this\._broadcastAccidentReaction\(/g) || []).length >= 3);
check('server: reaction pauses walkers via walker.pauseUntil',
  citySrc.indexOf('w.walker.pauseUntil = now + REACT_MS;') >= 0);
check('server: _applySchedule + period change in _secondTick',
  citySrc.indexOf('_applySchedule(period)') >= 0 &&
  citySrc.indexOf('M3.schedulePeriod(this.state.worldTime)') >= 0 &&
  citySrc.indexOf('this._applySchedule(period);') >= 0);
check('server: night home-goers are even idx, 45 px/s, pauseMult 2',
  /period === 'night' && \(w\.idx % 2 === 0\)/.test(citySrc) &&
  citySrc.indexOf('walker.speed = 45;') >= 0 &&
  citySrc.indexOf('walker.pauseMult = 2;') >= 0);
check('server: bot job tick + decide + advance wired in _secondTick',
  citySrc.indexOf('this._botJobTick(now);') >= 0 &&
  citySrc.indexOf('_decideBotJob(botId, bot, p, now)') >= 0 &&
  citySrc.indexOf('_advanceBotJob(botId, bot, p, now)') >= 0);
check('server: bot job compares best shipper vs best taxi (M3 pure helpers)',
  citySrc.indexOf('M3.bestShipperPayFor(this.orderPool, isNight)') >= 0 &&
  citySrc.indexOf('M3.bestTaxiPayFor(customers, isNight)') >= 0 &&
  citySrc.indexOf('M3.chooseBotJob(shipper, taxi)') >= 0);
check('server: bots never lock real order slots (no lockedBy write in bot job code)',
  (function () {
    var i = citySrc.indexOf('  _decideBotJob(botId, bot, p, now) {');
    var j = citySrc.indexOf('  _advanceBotJob(botId, bot, p, now) {');
    if (i < 0 || j < 0 || j <= i) return false;
    var seg = citySrc.slice(i, j);
    return seg.indexOf('lockedBy') < 0 && seg.indexOf('.cash +=') < 0;
  })());
check('server: bot taxi drivers count toward the taxi-customer spawn condition',
  citySrc.indexOf("b.job.kind === 'taxi'") >= 0);
check('server: __test_react hook exists (ALLOW_TEST-gated)',
  citySrc.indexOf("this.onMessage('__test_react'") >= 0);

// ---- 9. net + client wiring ------------------------------------------------
check('net.js dispatches npc_react to onNpcReact',
  netSrc.indexOf("room.onMessage('npc_react'") >= 0 &&
  netSrc.indexOf("self._call('onNpcReact', msg)") >= 0);
check('main.js: onNpcReact handler sets reactUntil/reactX/reactY + bubble',
  mainSrc.indexOf('onNpcReact: function (msg)') >= 0 &&
  mainSrc.indexOf('n.reactUntil = Date.now() + 4000;') >= 0 &&
  mainSrc.indexOf('n.reactX = msg.x; n.reactY = msg.y;') >= 0);
check('main.js: updateNPCs faces the accident spot while reacting (both branches, not cô ba)',
  (mainSrc.match(/if \(!n\.isCoba && n\.reactUntil && Date\.now\(\) < n\.reactUntil\)/g) || []).length === 2);
check('main.js: onNpcTalk shows the tier (Thân thiết: ...)',
  mainSrc.indexOf("var tierText = msg.tierName ? '\\nThân thiết: ' + msg.tierName : '';") >= 0);
check('main.js: offline npcPersonaLine counts talks + tier (mirror of server)',
  mainSrc.indexOf('npc.talkCount = (npc.talkCount || 0) + 1;') >= 0 &&
  mainSrc.indexOf('BotBrain.pickTalkLine(persona, tier, BotBrain.timePeriod(worldTime), npc.lastTalkLine)') >= 0);
check('main.js: offline talk bubble shows the tier too',
  mainSrc.indexOf("var tierSuffix = t.npc.talkTierName ? '\\nThân thiết: ' + t.npc.talkTierName : '';") >= 0);
check('main.js: offlineNpcReact exists + hooked into all three offline accident paths',
  mainSrc.indexOf('function offlineNpcReact(x, y, excludeId)') >= 0 &&
  (mainSrc.match(/offlineNpcReact\(/g) || []).length >= 4); // def + npc hit + animal hit + player hit
check('main.js: applyOfflineSchedule + ticker hook on period change',
  mainSrc.indexOf('function applyOfflineSchedule(period)') >= 0 &&
  mainSrc.indexOf('applyOfflineSchedule(schedPeriod);') >= 0 &&
  mainSrc.indexOf('M3.schedulePeriod(worldTime)') >= 0);
check('main.js: walkers + cô ba carry homePos/schedIdx for the schedule',
  mainSrc.indexOf('homePos: { x: sp.x, y: sp.y }, schedIdx: n,') >= 0 &&
  mainSrc.indexOf('homePos: { x: cobaSp.x, y: cobaSp.y }, schedIdx: 10,') >= 0);
check('main.js: cô ba animator untouched by Phase C (flip still owned by updateCobaAnim)',
  (mainSrc.match(/if \(!n\.isCoba\) \{/g) || []).length === 2 &&
  mainSrc.indexOf('function updateCobaAnim(n, dt, dx, dy)') >= 0);

// ---- 10. behaviour: applyOfflineSchedule (extracted) -----------------------
var schedSrc = extractFn(mainSrc, 'function applyOfflineSchedule(period)');
check('applyOfflineSchedule extractable from src/main.js', !!schedSrc);
if (schedSrc) {
  var mkSched = new Function('npcs', 'M3', schedSrc + '\nreturn applyOfflineSchedule;');
  function fakeNpc(schedIdx, homePos) {
    return { walker: { bias: null, biasWeight: 0.7, speed: 90, pauseMult: 1 }, homePos: homePos, schedIdx: schedIdx, isTutorial: false };
  }
  var fakeNpcs = [fakeNpc(0, { x: 100, y: 100 }), fakeNpc(1, { x: 200, y: 200 }), fakeNpc(10, { x: 300, y: 300 })];
  var guide = { isTutorial: true };
  fakeNpcs.push(guide);
  var applySched = mkSched(fakeNpcs, M3);
  applySched('morning');
  check('offline schedule morning: every walker biased to market or shop',
    fakeNpcs.slice(0, 3).every(function (n) {
      return n.walker.bias && ((n.walker.bias.x === 4155 && n.walker.bias.y === 4065) ||
        (n.walker.bias.x === 3225 && n.walker.bias.y === 1565));
    }) && fakeNpcs.slice(0, 3).every(function (n) { return n.walker.speed === 90 && n.walker.pauseMult === 1; }));
  applySched('night');
  check('offline schedule night: even idx go home (45 px/s, pauseMult 2), odd roam',
    fakeNpcs[0].walker.bias && fakeNpcs[0].walker.bias.x === 100 && fakeNpcs[0].walker.speed === 45 && fakeNpcs[0].walker.pauseMult === 2 &&
    fakeNpcs[1].walker.bias === null && fakeNpcs[1].walker.speed === 90 && fakeNpcs[1].walker.pauseMult === 1 &&
    fakeNpcs[2].walker.bias && fakeNpcs[2].walker.bias.x === 300 && fakeNpcs[2].walker.speed === 45);
  applySched('roam');
  check('offline schedule roam: no bias, normal speed',
    fakeNpcs.slice(0, 3).every(function (n) { return n.walker.bias === null && n.walker.speed === 90; }));
  check('offline schedule skips the guide (no walker)',
    guide.walker === undefined);
}

// ---- 11. behaviour: offlineNpcReact (extracted) ----------------------------
var reactSrc = extractFn(mainSrc, 'function offlineNpcReact(x, y, excludeId)');
check('offlineNpcReact extractable from src/main.js', !!reactSrc);
if (reactSrc) {
  var bubbles = [];
  var showBubbleStub = function (x, y, str, ms) { bubbles.push({ x: x, y: y, str: str, ms: ms }); };
  var mkReact = new Function('npcs', 'BotBrain', 'showBubble', 'Date', reactSrc + '\nreturn offlineNpcReact;');
  function rNpc(id, x, y, personaId, opts) {
    var n = { id: id, x: x, y: y, personaId: personaId, walker: { pauseUntil: 0 }, lastTalkLine: null };
    if (opts) Object.assign(n, opts);
    return n;
  }
  var rNpcs = [
    rNpc('npc-walker-0', 1000, 1000, 'tung'),              // at the accident spot
    rNpc('npc-walker-1', 1300, 1000, 'lan'),              // 300px away — reacts
    rNpc('npc-walker-2', 2000, 1000, 'cong'),             // 1000px away — no react
    rNpc('npc-guide', 1100, 1100, null, { isTutorial: true }), // tutorial — no react
    rNpc('npc-walker-3', 1050, 1050, 'mai', { downUntil: Date.now() + 2000 }) // down — no react
  ];
  var react = mkReact(rNpcs, BotBrain, showBubbleStub, Date);
  var before = Date.now();
  react(1000, 1000, 'npc-walker-0'); // victim excluded
  check('offline reaction: victim excluded, near walkers react, far/guide/down do not',
    rNpcs[0].reactUntil === undefined && rNpcs[0].walker.pauseUntil === 0 &&
    rNpcs[1].reactUntil > before && rNpcs[1].walker.pauseUntil > before &&
    rNpcs[2].reactUntil === undefined && rNpcs[3].reactUntil === undefined &&
    rNpcs[4].reactUntil === undefined);
  check('offline reaction: reacting walker faces the spot + shows a react line for 4s',
    rNpcs[1].reactX === 1000 && rNpcs[1].reactY === 1000 &&
    rNpcs[1].reactUntil - before >= 3900 && rNpcs[1].reactUntil - before <= 4100 &&
    bubbles.length === 1 && BotBrain.PERSONAS[1].reactLines.indexOf(bubbles[0].str) >= 0 &&
    bubbles[0].ms === 4000);
}

// ---- 12. behaviour: npcPersonaLine tiers (extracted) ------------------------
var npcLineSrc = extractFn(mainSrc, 'function npcPersonaLine(npc)');
check('npcPersonaLine extractable from src/main.js', !!npcLineSrc);
if (npcLineSrc) {
  var pickStub = function (arr) { return arr[0]; };
  var mkLine = new Function('BotBrain', 'pick', 'TALK_LINES', 'worldTime', npcLineSrc + '\nreturn npcPersonaLine;');
  var npcLine = mkLine(BotBrain, pickStub, ['generic'], 480); // 08:00 morning
  var npc = { personaId: 'tung', lastTalkLine: null };
  var realRandom = Math.random;
  Math.random = function () { return 0.9; }; // skip the 30% time branch, pick last pool item
  var lines = [];
  for (var t = 0; t < 8; t++) lines.push(npcLine(npc));
  Math.random = realRandom;
  var persona = BotBrain.PERSONAS[0];
  check('offline talk tiers: talks 1-2 stranger, 3-7 acquaintance, 8 friend',
    npc.talkCount === 8 && npc.talkTier === 2 && npc.talkTierName === 'Bạn bè');
  check('offline talk lines follow the tier pools (lines -> friend -> close)',
    persona.lines.indexOf(lines[0]) >= 0 && persona.lines.indexOf(lines[1]) >= 0 &&
    persona.friendLines.indexOf(lines[2]) >= 0 &&
    persona.closeLines.indexOf(lines[7]) >= 0,
    lines.join(' | '));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
