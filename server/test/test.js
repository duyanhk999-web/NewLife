/* Đô Thị Ảo — M1 headless test (colyseus.js client).
   Starts the real server on a test port, connects 2 clients, asserts:
     1. both clients see each other in state (+ 6 bots + 11 NPCs present)
     2. a move from A changes A's x server-side (visible to B)
     3. a world chat from A is received by B
     4. "chào Tùng" (nearby) gets a bot reply within 5 s
     5. worldTime advances (1 game-min / real sec)
   Exit 0 on pass, non-zero on fail. Prints PASS/FAIL per assertion.
   M3 tests (SRS §14.2, §14.4): pure M3 math (deadlines, rewards, faint
   loss, hospital fee, doctor caps) + live-protocol tests (job set,
   shipper accept->deliver->duplicate, NPC talk, faint->hospital fee,
   doctor revive + cooldown). The live tests use the env-gated '__test_set'
   hook (DTA_ALLOW_TEST=1, set below before the server is required) to
   teleport/set stats — never enabled in production. */
process.env.DTA_ALLOW_TEST = '1';
const { Client } = require('colyseus.js');
const { start } = require('../index');
const M3 = require('../../shared/m3');
const BotBrain = require('../../shared/botBrain');
const RoadNet = require('../../shared/roadnet');
const Props = require('../../shared/props');

const PORT = parseInt(process.env.TEST_PORT || '2568', 10);
let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${detail !== undefined ? ' (' + detail + ')' : ''}`);
  if (!ok) failures += 1;
}
function waitFor(cond, timeoutMs, stepMs = 100) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tick = () => {
      let ok = false;
      try { ok = cond(); } catch (e) { ok = false; }
      if (ok) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(tick, stepMs);
    };
    tick();
  });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const { httpServer } = start(PORT);
  await sleep(500);
  const client = new Client(`ws://127.0.0.1:${PORT}`);
  let roomA, roomB;
  const chatsB = [];
  const botReplies = [];
  // M3 message collectors.
  const jobResultsA = [], jobResultsB = [], npcTalksA = [], revivedMsgs = [], faintAlerts = [];
  // M4 message collectors.
  const vehicleResultsA = [], taxiResultsA = [], motelResultsA = [], econResultsA = [], faintedMsgs = [];
  // Traffic accident collector (2026-11-28).
  const accidentMsgs = [];
  const statePlayer = (room, sid) => {
    try { return room.state && room.state.players.get(sid); } catch (e) { return null; }
  };
  const testSet = async (room, obj) => { room.send('__test_set', obj); await sleep(300); };
  const waitForMsg = (list, pred, timeoutMs) => waitFor(
    () => list.some(pred), timeoutMs || 5000);

  // ---- M3 pure math (SRS §6.3, §6.4, §3.2.3, §3.2.5, §3.4.3) ----
  // Deadlines: 500px/180 -> 33s, 2000px/180 -> 41s, 3200px/180 -> 48s,
  // 3200px/234 (bicycle) -> 44s, 4800px/234 -> 51s, 4800px/324 -> 45s
  // (SRS §6.3 examples; v2.1's 540 px/s bike is superseded by v2.2).
  check('M3 deadline 500px walk = 33s', M3.deliverySeconds(500, 180) === 33, String(M3.deliverySeconds(500, 180)));
  check('M3 deadline 2000px walk = 41s', M3.deliverySeconds(2000, 180) === 41, String(M3.deliverySeconds(2000, 180)));
  check('M3 deadline 3200px walk = 48s', M3.deliverySeconds(3200, 180) === 48, String(M3.deliverySeconds(3200, 180)));
  check('M4 deadline 3200px bicycle = 44s', M3.deliverySeconds(3200, 234) === 44, String(M3.deliverySeconds(3200, 234)));
  check('M4 deadline 4800px bicycle = 51s', M3.deliverySeconds(4800, 234) === 51, String(M3.deliverySeconds(4800, 234)));
  check('M4 deadline 4800px motorbike = 45s', M3.deliverySeconds(4800, 324) === 45, String(M3.deliverySeconds(4800, 324)));
  // Rewards day: 500 -> 15000 (clamped min), 2000 -> 16000, 3200 -> 19000.
  check('M3 reward 500px day = 15000', M3.deliveryReward(500, false) === 15000, String(M3.deliveryReward(500, false)));
  check('M3 reward 2000px day = 16000', M3.deliveryReward(2000, false) === 16000, String(M3.deliveryReward(2000, false)));
  check('M3 reward 3200px day = 19000', M3.deliveryReward(3200, false) === 19000, String(M3.deliveryReward(3200, false)));
  // Rewards night (x1.30): 500 -> 19500, 2000 -> 20800, 3200 -> 24700.
  check('M3 reward 500px night = 19500', M3.deliveryReward(500, true) === 19500, String(M3.deliveryReward(500, true)));
  check('M3 reward 2000px night = 20800', M3.deliveryReward(2000, true) === 20800, String(M3.deliveryReward(2000, true)));
  check('M3 reward 3200px night = 24700', M3.deliveryReward(3200, true) === 24700, String(M3.deliveryReward(3200, true)));
  // Faint loss + hospital fee: faint with 50.000 -> lose 25.000 -> fee 22.500.
  check('M3 faint loss 50000 -> 25000', M3.faintLoss(50000) === 25000, String(M3.faintLoss(50000)));
  check('M3 hospital fee on 25000 -> 22500', M3.hospitalFee(25000) === 22500, String(M3.hospitalFee(25000)));
  const d1 = M3.deductFee(25000, 0, 22500);
  check('M3 deduct fee 25000 cash pays 22500', d1.cash === 2500 && d1.bank === 0 && d1.paid === 22500, JSON.stringify(d1));
  const d2 = M3.deductFee(5000, 10000, 22500);
  check('M3 deduct fee falls back to bank, never negative', d2.cash === 0 && d2.bank === 0 && d2.paid === 15000, JSON.stringify(d2));
  const d3 = M3.deductFee(0, 0, 22500);
  check('M3 deduct fee with no money pays 0, no debt', d3.paid === 0 && d3.cash === 0 && d3.bank === 0, JSON.stringify(d3));
  // Doctor reward rules (§3.4.3, v2.2: max 2 rewarded revives of the SAME
  // victim / 60 min — supersedes v2.1's 3/hour): 25000 OK, 0 when not
  // doctor / cooldown / pair cap.
  const drOk = M3.doctorRewardCheck('doctor', 1000000, 0, 0);
  check('M3 doctor revive reward = 25000', drOk.reward === 25000 && drOk.reason === 'OK', JSON.stringify(drOk));
  check('M3 non-doctor revive reward = 0', M3.doctorRewardCheck('shipper', 1000000, 0, 0).reward === 0);
  check('M3 doctor 60s cooldown blocks reward', M3.doctorRewardCheck('doctor', 1000000, 970000, 0).reward === 0);
  check('M4 doctor 2/60min pair cap blocks 3rd reward', (() => {
    const r = M3.doctorRewardCheck('doctor', 1000000, 0, 2);
    return r.reward === 0 && r.reason === 'PAIR_CAP';
  })(), JSON.stringify(M3.doctorRewardCheck('doctor', 1000000, 0, 2)));
  check('M4 doctor 1st/2nd revive of same victim in 60min is rewarded',
    M3.doctorRewardCheck('doctor', 1000000, 0, 1).reward === 25000);
  check('M3 collusion flag at 11 pair revives/day', M3.collusionFlagged(11) === true && M3.collusionFlagged(10) === false);

  // ---- M4 pure math (SRS v2.2 §7.2, §8, §18.5) ----
  // Vehicle speeds (LOCKED): bicycle 234 = 180x1.30, motorbike 324 = 180x1.80.
  check('M4 bicycle speed = 234', M3.BICYCLE_SPEED === 234 && M3.vehicleSpeed('bicycle') === 234, String(M3.vehicleSpeed('bicycle')));
  check('M4 motorbike speed = 324', M3.MOTORBIKE_SPEED === 324 && M3.vehicleSpeed('motorbike') === 324, String(M3.vehicleSpeed('motorbike')));
  check('M4 motorbike with 0 fuel is pushed at 180', M3.vehicleSpeed('motorbike', 0) === 180, String(M3.vehicleSpeed('motorbike', 0)));
  check('M4 bicycle with 0 durability is pushed at 180', M3.vehicleSpeed('bicycle', 100, 0) === 180, String(M3.vehicleSpeed('bicycle', 100, 0)));
  check('M4 hunger 20-1 slows every speed x0.7', M3.speedWithHunger(234, 10) === 164 && M3.speedWithHunger(324, 10) === 227 && M3.speedWithHunger(180, 10) === 126,
    `${M3.speedWithHunger(234, 10)}/${M3.speedWithHunger(324, 10)}/${M3.speedWithHunger(180, 10)}`);
  check('M4 vehicle prices 250k / 1M', M3.vehiclePrice('bicycle') === 250000 && M3.vehiclePrice('motorbike') === 1000000);
  check('M4 vehicle capacity 10 / 13 / 18 kg', M3.vehicleCapacityKg('') === 10 && M3.vehicleCapacityKg('bicycle') === 13 && M3.vehicleCapacityKg('motorbike') === 18);
  // Shipper pay multipliers — LOCKED (user 2026-11-25 01:02): x1.00 / x1.30 / x2.00.
  check('M4 shipper pay mult walk/bike/moto = 1.00/1.30/2.00',
    M3.shipperPayMultiplier('') === 1 && M3.shipperPayMultiplier('bicycle') === 1.3 && M3.shipperPayMultiplier('motorbike') === 2,
    `${M3.shipperPayMultiplier('')}/${M3.shipperPayMultiplier('bicycle')}/${M3.shipperPayMultiplier('motorbike')}`);
  check('M4 16000d walk order pays 20800d bicycle / 32000d motorbike',
    M3.deliveryRewardFor(2000, false, 'bicycle') === 20800 && M3.deliveryRewardFor(2000, false, 'motorbike') === 32000,
    `${M3.deliveryRewardFor(2000, false, 'bicycle')}/${M3.deliveryRewardFor(2000, false, 'motorbike')}`);
  // Fuel / durability drain by distance: 100% fuel = 8000 px, 100% durability = 50000 px.
  check('M4 fuel after 8000px = 0%', M3.fuelAfterDistance(100, 8000) === 0, String(M3.fuelAfterDistance(100, 8000)));
  check('M4 fuel after 4000px = 50%', M3.fuelAfterDistance(100, 4000) === 50, String(M3.fuelAfterDistance(100, 4000)));
  check('M4 durability after 50000px = 0%', M3.durabilityAfterDistance(100, 50000) === 0, String(M3.durabilityAfterDistance(100, 50000)));
  // Taxi fares (§3.4.2, §4.1): 1.000đ/100px, min 5.000, max 20.000, tax 5% buyer-pays.
  check('M4 taxi fare 100px trip = min 5000, tax 250, passenger pays 5250', (() => {
    const f = M3.taxiFare(100, false);
    return f.fare === 5000 && f.tax === 250 && f.passengerPays === 5250 && f.driverReceives === 5000;
  })(), JSON.stringify(M3.taxiFare(100, false)));
  check('M4 taxi fare 1200px trip = 12000, tax 600', (() => {
    const f = M3.taxiFare(1200, false);
    return f.fare === 12000 && f.tax === 600 && f.passengerPays === 12600 && f.driverReceives === 12000;
  })(), JSON.stringify(M3.taxiFare(1200, false)));
  check('M4 taxi fare 3000px trip = max 20000', M3.taxiFare(3000, false).fare === 20000, String(M3.taxiFare(3000, false).fare));
  check('M4 taxi night bonus +30% capped at 6000', (() => {
    const f = M3.taxiFare(3000, true);
    return f.nightBonus === 6000 && f.driverReceives === 26000;
  })(), JSON.stringify(M3.taxiFare(3000, true)));
  check('M4 taxi night bonus 12000 fare = +3600', M3.taxiFare(1200, true).nightBonus === 3600, String(M3.taxiFare(1200, true).nightBonus));
  // Motel (§8.2): rent 50.000/24h, chest active/held/deleted.
  check('M4 motel rent = 50000 / 24h', M3.MOTEL_RENT === 50000 && M3.MOTEL_RENT_HOURS === 24);
  check('M4 motel chest states active/held/deleted', (() => {
    const now = 1000000000000, exp = now + 24 * 3600 * 1000;
    return M3.motelChestState(exp, now) === 'active'
      && M3.motelChestState(exp, exp + 3600 * 1000) === 'held'
      && M3.motelChestState(exp, exp + 25 * 3600 * 1000) === 'deleted'
      && M3.motelChestState(0, now) === 'none';
  })());
  check('M4 motel renew extends from old expiry, not from now', (() => {
    const now = 1000000000000, exp = now + 10 * 3600 * 1000;
    return M3.motelRenewExpiry(exp, now) === exp + 24 * 3600 * 1000;
  })(), String(M3.motelRenewExpiry(1000000000000 + 10 * 3600 * 1000, 1000000000000)));
  // Doctor revive mini-game (§18.5, PROPOSAL): >=90% -> +20 HP, else +0.
  check('M4 revive mini-game 95% -> +20 HP', M3.doctorMinigameBonus(95) === 20, String(M3.doctorMinigameBonus(95)));
  check('M4 revive mini-game 90% -> +20 HP', M3.doctorMinigameBonus(90) === 20, String(M3.doctorMinigameBonus(90)));
  check('M4 revive mini-game 89% -> +0 HP', M3.doctorMinigameBonus(89) === 0, String(M3.doctorMinigameBonus(89)));
  check('M4 revive mini-game clamps >100 to 100', M3.doctorMinigameBonus(150) === 20, String(M3.doctorMinigameBonus(150)));

  try {
    roomA = await client.joinOrCreate('city', { name: 'TestA', avatar: 'hero' });
    roomB = await client.joinOrCreate('city', { name: 'TestB', avatar: 'student' });
    roomA.onMessage('chat', () => {}); // silence colyseus.js "not registered" warning
    roomA.onMessage('job_result', (m) => jobResultsA.push(m));
    roomA.onMessage('npc_talk', (m) => npcTalksA.push(m));
    roomA.onMessage('revived', (m) => revivedMsgs.push(m));
    roomA.onMessage('faint_alert', (m) => faintAlerts.push(m));
    roomA.onMessage('interact_error', () => {});
    roomA.onMessage('econ_result', (m) => econResultsA.push(m));
    roomA.onMessage('vehicle_result', (m) => vehicleResultsA.push(m));
    roomA.onMessage('taxi_result', (m) => taxiResultsA.push(m));
    roomA.onMessage('motel_result', (m) => motelResultsA.push(m));
    roomA.onMessage('fainted', (m) => faintedMsgs.push(m));
    roomB.onMessage('fainted', (m) => faintedMsgs.push(m));
    roomA.onMessage('accident', (m) => accidentMsgs.push(m));
    roomB.onMessage('accident', (m) => accidentMsgs.push(m));
    roomB.onMessage('job_result', (m) => jobResultsB.push(m));
    roomB.onMessage('revived', (m) => revivedMsgs.push(m));
    roomB.onMessage('interact_error', () => {});
    roomB.onMessage('chat', (msg) => {
      chatsB.push(msg);
      if (msg.fromId && msg.fromId.startsWith('bot-')) botReplies.push(msg);
    });

    // 1. Both see each other in state; bots + NPCs spawned.
    const seen = await waitFor(() => {
      const ps = roomB.state && roomB.state.players;
      if (!ps) return false;
      let humans = 0, bots = 0;
      ps.forEach((p) => { if (p.id.startsWith('bot-')) bots += 1; else humans += 1; });
      return humans >= 2 && bots >= 6;
    }, 5000);
    let humanCount = 0, botCount = 0, npcCount = 0;
    if (roomB.state) {
      roomB.state.players.forEach((p) => { if (p.id.startsWith('bot-')) botCount += 1; else humanCount += 1; });
      npcCount = roomB.state.npcs ? roomB.state.npcs.size : 0;
    }
    check('both clients see each other + 6 bots in state', seen,
      `humans=${humanCount} bots=${botCount} npcs=${npcCount}`);

    // 2. Move from A changes A's position server-side (observed by B).
    // Walk toward the spawn plaza (2400,2625): open ground from anywhere in
    // the spawn ring, unlike walking blindly east into the motel wall.
    const before = roomB.state.players.get(roomA.sessionId);
    const x0 = before ? before.x : null, y0 = before ? before.y : null;
    const toCx = 2400 - x0, toCy = 2625 - y0;
    const toLen = Math.hypot(toCx, toCy) || 1;
    const mdx = toLen < 50 ? -1 : toCx / toLen, mdy = toLen < 50 ? 0 : toCy / toLen;
    for (let i = 1; i <= 20; i++) {
      roomA.send('move', { seq: i, dx: mdx, dy: mdy, sprint: false });
      await sleep(50);
    }
    const moved = await waitFor(() => {
      const p = roomB.state.players.get(roomA.sessionId);
      return p && x0 !== null && Math.hypot(p.x - x0, p.y - y0) > 50;
    }, 3000);
    const pAfter = roomB.state.players.get(roomA.sessionId);
    check('move from A changes A position server-side (seen by B)', moved,
      `(${x0.toFixed(0)},${y0.toFixed(0)}) -> (${pAfter ? pAfter.x.toFixed(1) : '?'},${pAfter ? pAfter.y.toFixed(1) : '?'})`);

    // 3. World chat from A is received by B.
    chatsB.length = 0;
    roomA.send('chat', { channel: 'world', text: 'xin chào mọi người' });
    const chatOk = await waitFor(
      () => chatsB.some((m) => m.fromId === roomA.sessionId && m.text === 'xin chào mọi người'),
      3000);
    check('world chat from A received by B', chatOk, `B got ${chatsB.length} chat msg(s)`);

    // 4. Greet a bot nearby -> bot replies within 5 s.
    // Drain first: the world-chat reply from step 3 (1-3 s delay) may still
    // land after the reset, and a proactive bot line is not a reply either.
    // So wait out any pending reply, then only count replies whose text is
    // NOT one of that persona's proactive lines.
    await sleep(3500);
    botReplies.length = 0;
    const isGenuineReply = (m) => {
      const persona = BotBrain.PERSONAS.find((p) => 'bot-' + p.id === m.fromId);
      return persona && !persona.lines.includes(m.text);
    };
    let botOk = false;
    for (let attempt = 0; attempt < 2 && !botOk; attempt += 1) {
      roomA.send('chat', { channel: 'nearby', text: 'chào Tùng ơi' });
      botOk = await waitFor(() => botReplies.some(isGenuineReply), 5000);
      if (!botOk) await sleep(500);
    }
    const genuine = botReplies.find(isGenuineReply);
    check('bot replies to "chào Tùng" (nearby) within 5 s', botOk,
      genuine ? `${genuine.fromName}: "${genuine.text}"` : 'no bot reply');

    // 5. worldTime advances.
    const t0 = roomB.state.worldTime;
    await sleep(2100);
    const t1 = roomB.state.worldTime;
    check('worldTime advances ~1 game-min per real sec', t1 > t0, `${t0} -> ${t1}`);

    // ---- M3 live protocol (§14.2, §14.4) ----
    // 6. Set job: TestA -> shipper.
    jobResultsA.length = 0;
    roomA.send('job', { job: 'shipper' });
    const jobOk = await waitForMsg(jobResultsA, (m) => m.type === 'job' && m.ok && m.job === 'shipper');
    await waitFor(() => {
      const p = statePlayer(roomB, roomA.sessionId);
      return p && p.job === 'shipper';
    }, 2000);
    const pAjob = statePlayer(roomB, roomA.sessionId);
    check('M3 set job shipper', jobOk && pAjob && pAjob.job === 'shipper',
      pAjob ? `job=${pAjob.job}` : 'no state');

    // 7. Shipper accept -> deliver -> duplicate complete (SRS §6, §14.2).
    // Teleport A just south of the warehouse (4155,3200 is open ground,
    // 290px from the warehouse POI (4155,2910) — inside the 300px range).
    await testSet(roomA, { x: 4155, y: 3200 });
    const pA0 = statePlayer(roomA, roomA.sessionId);
    const ax0 = pA0 ? pA0.x : 4155, ay0 = pA0 ? pA0.y : 3200;
    const cashBefore = pA0 ? pA0.cash : 0;
    jobResultsA.length = 0;
    roomA.send('shipper', { action: 'accept' });
    const acceptOk = await waitForMsg(jobResultsA,
      (m) => m.type === 'shipper' && m.ok && m.action === 'accept' && m.order);
    const acceptMsg = jobResultsA.find((m) => m.type === 'shipper' && m.ok && m.action === 'accept');
    let order = acceptMsg ? acceptMsg.order : null;
    let shipperDetail = 'no order';
    if (order) {
      const expectedDist = Math.round(Math.hypot(order.targetX - ax0, order.targetY - ay0));
      const expectedSec = M3.deliverySeconds(expectedDist, M3.WALK_SPEED);
      const night = M3.isNightWorld(roomA.state.worldTime);
      const expectedReward = M3.deliveryReward(expectedDist, night);
      shipperDetail = `dist=${expectedDist} sec=${order.secondsLeft}/${expectedSec} reward=${order.reward}/${expectedReward}`;
      check('M3 shipper accept: deadline + reward match SRS formulas',
        order.secondsLeft === expectedSec && order.reward === expectedReward, shipperDetail);
    } else {
      check('M3 shipper accept: deadline + reward match SRS formulas', false, shipperDetail);
    }
    // Teleport A onto the delivery target, then complete.
    if (order) {
      await testSet(roomA, { x: order.targetX, y: order.targetY });
      jobResultsA.length = 0;
      roomA.send('shipper', { action: 'complete', orderId: order.id });
      const completeOk = await waitForMsg(jobResultsA,
        (m) => m.type === 'shipper' && m.ok && m.action === 'complete');
      const completeMsg = jobResultsA.find((m) => m.type === 'shipper' && m.ok && m.action === 'complete');
      await waitFor(() => {
        const p = statePlayer(roomB, roomA.sessionId);
        return p && p.cash === cashBefore + (order ? order.reward : 0);
      }, 1000);
      const pA1 = statePlayer(roomB, roomA.sessionId);
      check('M3 shipper deliver pays server-calculated reward once',
        completeOk && completeMsg && completeMsg.reward === order.reward && pA1 && pA1.cash === cashBefore + order.reward,
        completeMsg ? `reward=${completeMsg.reward} cash=${pA1 ? pA1.cash : '?'}` : 'no complete');
      // Duplicate complete -> ALREADY_PROCESSED, cash unchanged.
      const cashAfterDeliver = pA1 ? pA1.cash : null;
      jobResultsA.length = 0;
      roomA.send('shipper', { action: 'complete', orderId: order.id });
      const dupOk = await waitForMsg(jobResultsA,
        (m) => m.type === 'shipper' && !m.ok && m.error === 'ALREADY_PROCESSED');
      await sleep(300);
      const pA2 = statePlayer(roomB, roomA.sessionId);
      check('M3 duplicate complete -> ALREADY_PROCESSED, no double pay',
        dupOk && pA2 && pA2.cash === cashAfterDeliver, `cash=${pA2 ? pA2.cash : '?'}`);
    }

    // 7b. Multi-shop Shipper (user 2026-11-25): 50% warehouse / 50% shops.
    // Pure M3 first (seeded, deterministic), then the live protocol.
    const seeded = (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();
    const srcCounts = {};
    for (let i = 0; i < 200; i++) {
      const src = M3.pickOrderSource(seeded);
      srcCounts[src.id] = (srcCounts[src.id] || 0) + 1;
    }
    const whCount = srcCounts.warehouse || 0;
    const shopCounts = ['shop', 'motel', 'market', 'cafe'].map((id) => srcCounts[id] || 0);
    check('M3 pickOrderSource: ~50% warehouse over 200 seeded picks',
      whCount >= 80 && whCount <= 120, `warehouse=${whCount}/200`);
    check('M3 pickOrderSource: every shop appears in 200 seeded picks',
      shopCounts.every((c) => c >= 10), `shop/motel/market/cafe=${shopCounts.join('/')}`);
    check('M3 pickOrderSource: all 5 sources are real SHIPPER_SOURCES',
      M3.SHIPPER_SOURCES.length === 5 && M3.SHIPPER_SOURCES[0].id === 'warehouse',
      M3.SHIPPER_SOURCES.map((s) => s.id).join(','));
    // Delivery is never the pickup shop itself.
    let excludedOk = true;
    for (let i = 0; i < 50; i++) {
      const dp = M3.pickDeliveryPoint(seeded, 'shop');
      if (dp.poiId === 'shop') { excludedOk = false; break; }
    }
    check('M3 pickDeliveryPoint excludes the pickup shop (50 picks)', excludedOk);
    // nearestShipperSource: near the shop -> shop; at the plaza -> motel
    // (1054px away, still the nearest) but outside the 300px accept range.
    const nearShop = M3.nearestShipperSource(3225, 1825);
    const atPlaza = M3.nearestShipperSource(2430, 2650);
    check('M3 nearestShipperSource near the shop returns shop (~260px)',
      nearShop.id === 'shop' && Math.round(nearShop.distance) === 260,
      `${nearShop.id} ${Math.round(nearShop.distance)}px`);
    check('M3 nearestShipperSource at the plaza is motel, 1015px (TOO_FAR range)',
      atPlaza.id === 'motel' && Math.round(atPlaza.distance) >= 800 && atPlaza.distance > M3.SHIPPER_RANGE,
      `${atPlaza.id} ${Math.round(atPlaza.distance)}px`);
    // Live: accept at a SHOP works. Try each shop spot in turn (a slot for
    // that shop must be free — ORDER_TAKEN just means try the next shop);
    // the accepted order's pickup must be the shop the player stands at.
    const shopSpots = [
      { id: 'shop', x: 3225, y: 1825 }, { id: 'motel', x: 2950, y: 3275 },
      { id: 'market', x: 4155, y: 4320 }, { id: 'cafe', x: 2760, y: 4630 },
    ];
    let shopOrder = null, shopSpot = null;
    for (const spot of shopSpots) {
      await testSet(roomA, { x: spot.x, y: spot.y });
      jobResultsA.length = 0;
      roomA.send('shipper', { action: 'accept' });
      const ok = await waitForMsg(jobResultsA,
        (m) => m.type === 'shipper' && m.ok && m.action === 'accept' && m.order, 3000);
      const msg = jobResultsA.find((m) => m.type === 'shipper' && m.ok && m.action === 'accept');
      if (ok && msg) { shopOrder = msg.order; shopSpot = spot; break; }
      // ORDER_TAKEN (no free slot for this shop) -> try the next shop.
      const err = jobResultsA.find((m) => m.type === 'shipper' && !m.ok);
      if (err && err.error !== 'ORDER_TAKEN') break; // TOO_FAR etc. = real failure
    }
    check('M3 shipper accept at a shop works (pickup = that shop)',
      !!shopOrder && !!shopSpot && shopOrder.pickupId === shopSpot.id,
      shopOrder ? `pickup=${shopOrder.pickupId} @${shopOrder.pickupName}` : 'no shop order accepted');
    if (shopOrder) {
      const pAx = statePlayer(roomA, roomA.sessionId);
      const pickupDist = Math.round(Math.hypot(shopOrder.pickupX - (pAx ? pAx.x : 0), shopOrder.pickupY - (pAx ? pAx.y : 0)));
      check('M3 shop order pickup is within 300px of the player at accept',
        pickupDist <= M3.SHIPPER_RANGE, `pickup ${pickupDist}px away`);
      // The Colyseus state mirrors the pickup (client order card reads it).
      const mirrored = await waitFor(() => {
        const p = statePlayer(roomB, roomA.sessionId);
        return p && p.orderPickupName === shopOrder.pickupName && p.orderStatus === 'accepted';
      }, 3000);
      check('M3 order pickup mirrored in player state (orderPickupName)',
        mirrored, `state pickup=${(statePlayer(roomB, roomA.sessionId) || {}).orderPickupName}`);
      // Deliver the shop order (teleport to target, complete) so later
      // tests start clean — no cancel cooldown for the bicycle test below.
      await testSet(roomA, { x: shopOrder.targetX, y: shopOrder.targetY });
      jobResultsA.length = 0;
      roomA.send('shipper', { action: 'complete', orderId: shopOrder.id });
      const shopDelivered = await waitForMsg(jobResultsA,
        (m) => m.type === 'shipper' && m.ok && m.action === 'complete');
      check('M3 shop order delivers and pays like a warehouse order', shopDelivered);
    }
    // Live: pickup at the wrong place fails — the plaza is >300px from
    // every source (nearest is the motel, 1015px away).
    await testSet(roomA, { x: 2430, y: 2650 });
    jobResultsA.length = 0;
    roomA.send('shipper', { action: 'accept' });
    const tooFarOk = await waitForMsg(jobResultsA,
      (m) => m.type === 'shipper' && !m.ok && m.error === 'TOO_FAR', 3000);
    check('M3 shipper accept far from every source -> TOO_FAR', tooFarOk);

    // 8. NPC talk (§10.2): guide -> tutorial quest; walker -> persona line.
    // Teleport A next to the guide (2400,2520), 110px away.
    await testSet(roomA, { x: 2400, y: 2630 });
    npcTalksA.length = 0;
    roomA.send('interact', { action: 'talk', targetId: 'npc-guide' });
    const guideOk = await waitForMsg(npcTalksA, (m) => m.npcId === 'npc-guide' && m.isGuide);
    const guideMsg = npcTalksA.find((m) => m.npcId === 'npc-guide');
    check('M3 talk to guide shows 5-step tutorial quest',
      guideOk && guideMsg && Array.isArray(guideMsg.quest) && guideMsg.quest.length === 5,
      guideMsg ? `${guideMsg.quest.length} steps` : 'no reply');
    // Walker: teleport next to npc-walker-0 (it wanders 90px/s, so stay close).
    const walker0 = roomA.state && roomA.state.npcs ? roomA.state.npcs.get('npc-walker-0') : null;
    if (walker0) {
      await testSet(roomA, { x: walker0.x, y: walker0.y + 60 });
      npcTalksA.length = 0;
      roomA.send('interact', { action: 'talk', targetId: 'npc-walker-0' });
      const talkOk = await waitForMsg(npcTalksA, (m) => m.npcId === 'npc-walker-0' && !m.isGuide);
      const talkMsg = npcTalksA.find((m) => m.npcId === 'npc-walker-0');
      const persona = BotBrain.PERSONAS.find((pp) => pp.id === (talkMsg && talkMsg.personaId));
      check('M3 talk to walker returns a persona line',
        talkOk && !!talkMsg && !!persona && persona.lines.includes(talkMsg.text),
        talkMsg ? `${talkMsg.personaId}: "${talkMsg.text}"` : 'no reply');
    } else {
      check('M3 talk to walker returns a persona line', false, 'walker-0 missing');
    }

    // ---- M4 live protocol (§14.4 v2.2, §7.2, §8) ----
    // 11. Starter grant is 80.000đ (v2.2, supersedes 50.000đ), once only.
    const pAgrant0 = statePlayer(roomB, roomA.sessionId);
    const cashGrant0 = pAgrant0 ? pAgrant0.cash : 0;
    econResultsA.length = 0;
    roomA.send('starter_grant', { request_id: 'm4-grant-' + Date.now() });
    const grantOk = await waitForMsg(econResultsA,
      (m) => m.type === 'starter_grant' && m.ok);
    const grantMsg = econResultsA.find((m) => m.type === 'starter_grant' && m.ok);
    check('M4 starter grant = 80000 (v2.2, once)',
      grantOk && grantMsg && grantMsg.cash === cashGrant0 + 80000,
      grantMsg ? `cash ${cashGrant0} -> ${grantMsg.cash}` : 'no grant');
    econResultsA.length = 0;
    roomA.send('starter_grant', { request_id: 'm4-grant2-' + Date.now() });
    const grant2Ok = await waitForMsg(econResultsA,
      (m) => m.type === 'starter_grant' && !m.ok && m.error === 'ALREADY_GRANTED');
    check('M4 second starter grant -> ALREADY_GRANTED', grant2Ok);

    // 12. Vehicles: buy bicycle (250.000đ) at the Showroom, mount it,
    // Shipper accept uses bicycle speed (234) + pay x1.30 (LOCKED).
    await testSet(roomA, { cash: 1200000, x: 1900, y: 3380 });
    vehicleResultsA.length = 0;
    roomA.send('vehicle', { action: 'buy', vehicleId: 'bicycle' });
    const buyBikeOk = await waitForMsg(vehicleResultsA,
      (m) => m.ok && m.action === 'buy' && m.vehicleId === 'bicycle');
    const buyBikeMsg = vehicleResultsA.find((m) => m.ok && m.action === 'buy');
    check('M4 buy bicycle 250000 at Showroom',
      buyBikeOk && buyBikeMsg && buyBikeMsg.cash === 1200000 - 250000,
      buyBikeMsg ? `cash=${buyBikeMsg.cash}` : 'no result');
    vehicleResultsA.length = 0;
    roomA.send('vehicle', { action: 'mount', vehicleId: 'bicycle' });
    const mountBikeOk = await waitForMsg(vehicleResultsA,
      (m) => m.ok && m.action === 'mount' && m.vehicleId === 'bicycle');
    const pAmounted = statePlayer(roomB, roomA.sessionId);
    check('M4 mount bicycle -> state vehicleId bicycle',
      mountBikeOk && pAmounted && pAmounted.vehicleId === 'bicycle',
      pAmounted ? `vehicleId=${pAmounted.vehicleId}` : 'no state');
    // Shipper accept on the bicycle: deadline = dist/234 + 30, reward x1.30.
    await testSet(roomA, { x: 4155, y: 3200 });
    const pAbike0 = statePlayer(roomA, roomA.sessionId);
    const bikeCash0 = pAbike0 ? pAbike0.cash : 0;
    jobResultsA.length = 0;
    roomA.send('shipper', { action: 'accept' });
    const acceptBikeOk = await waitForMsg(jobResultsA,
      (m) => m.type === 'shipper' && m.ok && m.action === 'accept' && m.order);
    const bikeOrder = (jobResultsA.find((m) => m.type === 'shipper' && m.ok && m.action === 'accept') || {}).order;
    if (bikeOrder) {
      const bDist = Math.round(Math.hypot(bikeOrder.targetX - 4155, bikeOrder.targetY - 3200));
      const bSec = M3.deliverySeconds(bDist, M3.BICYCLE_SPEED);
      const bReward = M3.deliveryRewardFor(bDist, M3.isNightWorld(roomA.state.worldTime), 'bicycle');
      check('M4 shipper accept on bicycle: deadline dist/234+30, reward x1.30',
        acceptBikeOk && bikeOrder.secondsLeft === bSec && bikeOrder.reward === bReward && bikeOrder.vehicleId === 'bicycle',
        `dist=${bDist} sec=${bikeOrder.secondsLeft}/${bSec} reward=${bikeOrder.reward}/${bReward}`);
      await testSet(roomA, { x: bikeOrder.targetX, y: bikeOrder.targetY });
      jobResultsA.length = 0;
      roomA.send('shipper', { action: 'complete', orderId: bikeOrder.id });
      const completeBikeOk = await waitForMsg(jobResultsA,
        (m) => m.type === 'shipper' && m.ok && m.action === 'complete');
      const pAbike1 = statePlayer(roomB, roomA.sessionId);
      check('M4 bicycle delivery pays x1.30 reward once',
        completeBikeOk && pAbike1 && pAbike1.cash === bikeCash0 + bikeOrder.reward,
        pAbike1 ? `cash=${pAbike1.cash} (expect ${bikeCash0 + bikeOrder.reward})` : 'no state');
    } else {
      check('M4 shipper accept on bicycle: deadline dist/234+30, reward x1.30', false, 'no order');
      check('M4 bicycle delivery pays x1.30 reward once', false, 'no order');
    }

    // 13. Motorbike: buy (1.000.000đ), mount, Shipper accept uses speed
    // 324 + pay x2.00 (LOCKED 2026-11-25 01:02).
    vehicleResultsA.length = 0;
    roomA.send('vehicle', { action: 'dismount' });
    await waitForMsg(vehicleResultsA, (m) => m.ok && m.action === 'dismount');
    await testSet(roomA, { cash: 1200000, x: 1900, y: 3380 });
    vehicleResultsA.length = 0;
    roomA.send('vehicle', { action: 'buy', vehicleId: 'motorbike' });
    const buyMotoOk = await waitForMsg(vehicleResultsA,
      (m) => m.ok && m.action === 'buy' && m.vehicleId === 'motorbike');
    check('M4 buy motorbike 1000000 at Showroom', buyMotoOk);
    vehicleResultsA.length = 0;
    roomA.send('vehicle', { action: 'mount', vehicleId: 'motorbike' });
    const mountMotoOk = await waitForMsg(vehicleResultsA,
      (m) => m.ok && m.action === 'mount' && m.vehicleId === 'motorbike');
    const pAmounted2 = statePlayer(roomB, roomA.sessionId);
    check('M4 mount motorbike -> state vehicleId motorbike',
      mountMotoOk && pAmounted2 && pAmounted2.vehicleId === 'motorbike',
      pAmounted2 ? `vehicleId=${pAmounted2.vehicleId}` : 'no state');
    await testSet(roomA, { x: 4155, y: 3200 });
    jobResultsA.length = 0;
    roomA.send('shipper', { action: 'accept' });
    const acceptMotoOk = await waitForMsg(jobResultsA,
      (m) => m.type === 'shipper' && m.ok && m.action === 'accept' && m.order);
    const motoOrder = (jobResultsA.find((m) => m.type === 'shipper' && m.ok && m.action === 'accept') || {}).order;
    if (motoOrder) {
      const mDist = Math.round(Math.hypot(motoOrder.targetX - 4155, motoOrder.targetY - 3200));
      const mSec = M3.deliverySeconds(mDist, M3.MOTORBIKE_SPEED);
      const mReward = M3.deliveryRewardFor(mDist, M3.isNightWorld(roomA.state.worldTime), 'motorbike');
      check('M4 shipper accept on motorbike: deadline dist/324+30, reward x2.00',
        acceptMotoOk && motoOrder.secondsLeft === mSec && motoOrder.reward === mReward && motoOrder.vehicleId === 'motorbike',
        `dist=${mDist} sec=${motoOrder.secondsLeft}/${mSec} reward=${motoOrder.reward}/${mReward}`);
      await testSet(roomA, { x: motoOrder.targetX, y: motoOrder.targetY });
      jobResultsA.length = 0;
      roomA.send('shipper', { action: 'complete', orderId: motoOrder.id });
      await waitForMsg(jobResultsA, (m) => m.type === 'shipper' && m.ok && m.action === 'complete');
    } else {
      check('M4 shipper accept on motorbike: deadline dist/324+30, reward x2.00', false, 'no order');
    }

    // 14. Taxi: driver with motorbike + "Nhận khách" gets an NPC customer
    // (room has 2 real players < 4), picks them up, drives to the
    // destination, fare auto-completes (min 5.000đ, driver paid by SYSTEM).
    jobResultsA.length = 0;
    roomA.send('job', { job: 'taxi_driver' });
    await waitForMsg(jobResultsA, (m) => m.type === 'job' && m.ok && m.job === 'taxi_driver');
    taxiResultsA.length = 0;
    roomA.send('taxi', { action: 'toggle' });
    const taxiOnOk = await waitForMsg(taxiResultsA,
      (m) => m.ok && m.action === 'toggle' && m.taxiMode === true);
    check('M4 taxi toggle on (taxi_driver + motorbike)', taxiOnOk);
    const custFound = await waitFor(() => {
      if (!roomA.state || !roomA.state.npcs) return false;
      let found = false;
      roomA.state.npcs.forEach((n) => { if (n.type === 'taxi_customer') found = true; });
      return found;
    }, 8000);
    check('M4 NPC taxi customer spawns (< 4 real players, driver on)', custFound);
    let taxiDetail = 'no customer';
    if (custFound) {
      let cust = null;
      roomA.state.npcs.forEach((n) => { if (n.type === 'taxi_customer' && !cust) cust = n; });
      await testSet(roomA, { x: cust.x + 50, y: cust.y });
      taxiResultsA.length = 0;
      roomA.send('taxi', { action: 'pickup', npcId: cust.id });
      const pickupOk = await waitForMsg(taxiResultsA,
        (m) => m.ok && m.action === 'pickup' && m.npcId === cust.id);
      const pickupMsg = taxiResultsA.find((m) => m.ok && m.action === 'pickup');
      check('M4 taxi pickup NPC customer', pickupOk,
        pickupMsg ? `-> ${pickupMsg.poiName} (${pickupMsg.destX},${pickupMsg.destY})` : 'no result');
      if (pickupMsg) {
        // Drive to the destination with real move messages (fare is
        // charged on distance actually travelled). If the straight line
        // gets stuck on a building, nudge forward with the test hook.
        // NOTE: do NOT clear taxiResultsA after the drive — the ride can
        // auto-complete server-side while the client is still driving, and
        // the dropoff message may already be in the collector.
        const cashTaxi0 = (statePlayer(roomB, roomA.sessionId) || {}).cash || 0;
        let seq = 1000;
        let stuckAt = null, stuckPos = null;
        const driveDeadline = Date.now() + 60000;
        let arrived = false;
        while (Date.now() < driveDeadline) {
          const p = statePlayer(roomA, roomA.sessionId);
          if (!p) break;
          const dx = pickupMsg.destX - p.x, dy = pickupMsg.destY - p.y;
          const d = Math.hypot(dx, dy);
          if (d <= 80) { arrived = true; break; }
          if (stuckPos && Math.hypot(p.x - stuckPos.x, p.y - stuckPos.y) < 5) {
            if (Date.now() - stuckAt > 2000) {
              await testSet(roomA, { x: p.x + dx / d * 150, y: p.y + dy / d * 150 });
              stuckAt = Date.now();
              stuckPos = { x: p.x, y: p.y };
              continue;
            }
          } else {
            stuckAt = Date.now();
            stuckPos = { x: p.x, y: p.y };
          }
          roomA.send('move', { seq: ++seq, dx: dx / d, dy: dy / d, sprint: false });
          await sleep(100);
        }
        taxiDetail = arrived ? 'arrived at destination' : 'drive timed out';
        const alreadyDropped = taxiResultsA.some((m) => m.ok && m.action === 'dropoff');
        const dropOk = alreadyDropped || await waitForMsg(taxiResultsA,
          (m) => m.ok && m.action === 'dropoff', 8000);
        const dropMsg = taxiResultsA.find((m) => m.ok && m.action === 'dropoff');
        await sleep(300);
        const pAtaxi = statePlayer(roomB, roomA.sessionId);
        check('M4 taxi NPC ride auto-completes at destination, fare >= 5000 paid',
          dropOk && dropMsg && dropMsg.received >= 5000 && pAtaxi && pAtaxi.cash === cashTaxi0 + dropMsg.received,
          dropMsg ? `received=${dropMsg.received} cash=${pAtaxi ? pAtaxi.cash : '?'}` : taxiDetail);
      } else {
        check('M4 taxi NPC ride auto-completes at destination, fare >= 5000 paid', false, 'no pickup');
      }
    } else {
      check('M4 taxi pickup NPC customer', false, taxiDetail);
      check('M4 taxi NPC ride auto-completes at destination, fare >= 5000 paid', false, taxiDetail);
    }

    // 15. Motel: rent 50.000đ/24h, chest put/take, renew extends expiry,
    // second rent while active -> ALREADY_RENTED.
    await testSet(roomA, { x: 3225, y: 1775 }); // 210px south of the shop
    econResultsA.length = 0;
    roomA.send('shop_buy', { item_id: 'banh_mi', qty: 1, request_id: 'm4-motel-buy-' + Date.now() });
    await waitForMsg(econResultsA, (m) => m.type === 'shop_buy' && m.ok);
    await testSet(roomA, { x: 2950, y: 3275 }); // 255px south of the motel
    motelResultsA.length = 0;
    roomA.send('motel', { action: 'rent' });
    const rentOk = await waitForMsg(motelResultsA, (m) => m.ok && m.action === 'rent');
    const rentMsg = motelResultsA.find((m) => m.ok && m.action === 'rent');
    const nowMs = Date.now();
    check('M4 motel rent 50000, expires in ~24h',
      rentOk && rentMsg && rentMsg.expiresAt > nowMs && rentMsg.expiresAt <= nowMs + 24 * 3600 * 1000 + 60000,
      rentMsg ? `expiresAt=${new Date(rentMsg.expiresAt).toISOString()}` : 'no result');
    motelResultsA.length = 0;
    roomA.send('motel', { action: 'rent' });
    const rent2Ok = await waitForMsg(motelResultsA,
      (m) => !m.ok && m.error === 'ALREADY_RENTED');
    check('M4 second motel rent while active -> ALREADY_RENTED', rent2Ok);
    motelResultsA.length = 0;
    roomA.send('motel', { action: 'chest_put', itemId: 'banh_mi', qty: 1 });
    const putOk = await waitForMsg(motelResultsA,
      (m) => m.ok && m.action === 'chest_put' && m.chest && m.chest.banh_mi === 1);
    check('M4 motel chest put banh_mi x1', putOk);
    motelResultsA.length = 0;
    roomA.send('motel', { action: 'chest_take', itemId: 'banh_mi', qty: 1 });
    const takeOk = await waitForMsg(motelResultsA,
      (m) => m.ok && m.action === 'chest_take' && (!m.chest || !m.chest.banh_mi));
    check('M4 motel chest take banh_mi x1', takeOk);
    motelResultsA.length = 0;
    roomA.send('motel', { action: 'renew' });
    const renewOk = await waitForMsg(motelResultsA, (m) => m.ok && m.action === 'renew');
    const renewMsg = motelResultsA.find((m) => m.ok && m.action === 'renew');
    check('M4 motel renew extends expiry by 24h',
      renewOk && renewMsg && rentMsg && renewMsg.expiresAt === rentMsg.expiresAt + 24 * 3600 * 1000,
      renewMsg ? `expiresAt=${new Date(renewMsg.expiresAt).toISOString()}` : 'no result');
    motelResultsA.length = 0;
    roomA.send('motel', { action: 'status' });
    const statusOk = await waitForMsg(motelResultsA,
      (m) => m.ok && m.action === 'status' && m.chestState === 'active');
    check('M4 motel status reports active room', statusOk);

    // 9. Faint -> hospital fee (§14.4): B faints with 50.000 cash.
    // Faint loss at faint time: 50.000 -> 25.000; hospital fee on the
    // remaining 25.000: 10.000 + 12.500 = 22.500 -> cash 2.500, hp 50.
    faintedMsgs.length = 0;
    await testSet(roomB, { cash: 50000, bank: 0, hp: 0, hunger: 0 });
    const faintOk = await waitFor(
      () => { const p = statePlayer(roomA, roomB.sessionId); return p && p.isFainted; }, 5000);
    const pBfaint = statePlayer(roomA, roomB.sessionId);
    check('M3 faint loses 50% cash immediately (50000 -> 25000)',
      faintOk && pBfaint && pBfaint.cash === 25000,
      pBfaint ? `cash=${pBfaint.cash} fainted=${pBfaint.isFainted}` : 'no state');
    // M4: the server broadcasts an explicit 'fainted' message to the whole
    // room (the fix for the M3 gap: online self-faint played no sound).
    const faintBcOk = await waitFor(
      () => faintedMsgs.some((m) => m.playerId === roomB.sessionId), 3000);
    check('M4 faint broadcasts explicit fainted message to the room',
      faintBcOk, `got ${faintedMsgs.length} fainted msg(s)`);
    // Force the 60 s countdown to end -> auto-revive at the hospital.
    await testSet(roomB, { faintMsLeft: 0 });
    const hospOk = await waitFor(
      () => { const p = statePlayer(roomA, roomB.sessionId); return p && !p.isFainted && p.hp === 50; }, 5000);
    const pBhosp = statePlayer(roomA, roomB.sessionId);
    const expHosp = M3.HOSPITAL_SPAWN || { x: 4125, y: 1890 };
    check('M3 hospital auto-revive: fee 22500, cash 2500, hp 50 at hospital entrance',
      hospOk && pBhosp && pBhosp.cash === 2500 && pBhosp.bank === 0
        && Math.abs(pBhosp.x - expHosp.x) < 5 && Math.abs(pBhosp.y - expHosp.y) < 5,
      pBhosp ? `cash=${pBhosp.cash} hp=${pBhosp.hp} at (${Math.round(pBhosp.x)},${Math.round(pBhosp.y)})` : 'no state');
    // Verify the revived player is NOT stuck inside the hospital building collider.
    const hx0 = pBhosp ? pBhosp.x : expHosp.x, hy0 = pBhosp ? pBhosp.y : expHosp.y;
    for (let i = 1; i <= 6; i++) {
      roomB.send('move', { seq: 500 + i, dx: 0, dy: 1, sprint: false });
      await sleep(50);
    }
    const hospCanWalk = await waitFor(() => {
      const p = statePlayer(roomA, roomB.sessionId);
      return p && p.y - hy0 > 20;
    }, 2000);
    check('M4 hospital revive spawn is walkable (not trapped inside building)', hospCanWalk,
      `y ${Math.round(hy0)} -> ${Math.round((statePlayer(roomA, roomB.sessionId) || {}).y || 0)}`);

    // M4 refuel while dismounted: first top up (the taxi trip drained fuel),
    // then a 2nd refuel while dismounted at 100% fuel -> ALREADY_FULL.
    await testSet(roomA, { x: 3225, y: 1775 });
    roomA.send('vehicle', { action: 'dismount' });
    await sleep(200);
    vehicleResultsA.length = 0;
    roomA.send('vehicle', { action: 'refuel' });
    await waitForMsg(vehicleResultsA, (m) => m.ok && m.action === 'refuel');
    vehicleResultsA.length = 0;
    roomA.send('vehicle', { action: 'refuel' });
    const fullRefuelBlocked = await waitForMsg(vehicleResultsA,
      (m) => !m.ok && m.error === 'ALREADY_FULL');
    check('M4 refuel while dismounted at 100% fuel -> ALREADY_FULL', fullRefuelBlocked);

    // 10. Doctor revive + 60 s cooldown (§3.4.3, §14.4).
    // A becomes a doctor (no active order, so the job change is allowed).
    jobResultsA.length = 0;
    roomA.send('job', { job: 'doctor' });
    await waitForMsg(jobResultsA, (m) => m.type === 'job' && m.ok && m.job === 'doctor');
    // B faints again with 10.000 cash (faint loss -> 5.000).
    await testSet(roomB, { cash: 10000, hp: 0 });
    await waitFor(
      () => { const p = statePlayer(roomA, roomB.sessionId); return p && p.isFainted; }, 5000);
    const pB2 = statePlayer(roomA, roomB.sessionId);
    await testSet(roomA, { x: pB2.x + 50, y: pB2.y }); // doctor within 120px
    const cashADoc0 = (statePlayer(roomB, roomA.sessionId) || {}).cash || 0;
    revivedMsgs.length = 0;
    // M4 (§18.5, PROPOSAL): revive with a 95% mini-game -> +20 HP bonus
    // on top of the locked 30 HP floor (victim 50 HP), reward unchanged.
    roomA.send('interact', { action: 'revive', targetId: roomB.sessionId, minigamePct: 95 });
    const reviveOk = await waitForMsg(revivedMsgs,
      (m) => m.targetId === roomB.sessionId && m.reward === 25000 && m.bonusHp === 20);
    await sleep(300);
    const pBrev = statePlayer(roomA, roomB.sessionId);
    const pAdoc = statePlayer(roomB, roomA.sessionId);
    check('M3 doctor revive: victim 30 HP, doctor +25000',
      reviveOk && pBrev && !pBrev.isFainted && pBrev.hp === 50
        && pAdoc && pAdoc.cash === cashADoc0 + 25000,
      pAdoc ? `doctor cash ${cashADoc0} -> ${pAdoc.cash}, victim hp=${pBrev ? pBrev.hp : '?'}` : 'no state');
    // Second faint + revive within 60 s -> reward 0 (COOLDOWN). The revive
    // itself still works; with a 50% mini-game there is no HP bonus (30 HP).
    await testSet(roomB, { hp: 0 });
    await waitFor(
      () => { const p = statePlayer(roomA, roomB.sessionId); return p && p.isFainted; }, 5000);
    const cashADoc1 = (statePlayer(roomB, roomA.sessionId) || {}).cash || 0;
    revivedMsgs.length = 0;
    roomA.send('interact', { action: 'revive', targetId: roomB.sessionId, minigamePct: 50 });
    const revive2Ok = await waitForMsg(revivedMsgs,
      (m) => m.targetId === roomB.sessionId && m.reward === 0 && m.reason === 'COOLDOWN' && m.bonusHp === 0);
    await sleep(300);
    const pAdoc2 = statePlayer(roomB, roomA.sessionId);
    const pBrev2 = statePlayer(roomA, roomB.sessionId);
    check('M3 doctor 2nd revive within 60s -> 0d (COOLDOWN)',
      revive2Ok && pAdoc2 && pAdoc2.cash === cashADoc1, `cash=${pAdoc2 ? pAdoc2.cash : '?'}`);
    check('M4 revive with 50% mini-game -> no bonus, victim 30 HP',
      revive2Ok && pBrev2 && !pBrev2.isFainted && pBrev2.hp === 30,
      pBrev2 ? `victim hp=${pBrev2.hp}` : 'no state');

    // ---- Solid collision + traffic accidents (2026-11-28) ----
    // Traffic: 20 server-authoritative vehicles in state, all on roads.
    const vehCount = roomA.state.vehicles ? roomA.state.vehicles.size : 0;
    let vehOnRoad = 0;
    if (roomA.state.vehicles) roomA.state.vehicles.forEach((v) => { if (RoadNet.inRoad(v.x, v.y)) vehOnRoad += 1; });
    check('traffic: 20 server vehicles in state', vehCount === 20, `vehicles=${vehCount}`);
    check('traffic: all vehicles on roads', vehOnRoad === vehCount, `${vehOnRoad}/${vehCount} on road`);
    // Animals: 4 server-authoritative animals (2 dogs + 2 cats) in state.npcs.
    let animalCount = 0;
    if (roomA.state.npcs) roomA.state.npcs.forEach((n) => { if (n.type === 'animal') animalCount += 1; });
    check('animals: 4 server animals in state.npcs', animalCount === 4,
      `animals=${animalCount}, npcs=${roomA.state.npcs ? roomA.state.npcs.size : 0}`);
    // Solid collision vs a tree: A starts 60px west of TREES[0] and walks
    // east for 1 s — must stop at the trunk (16 + 12 = 28px), never through.
    let seq = 100000;
    const tree = Props.TREES[0];
    await testSet(roomA, { x: tree[0] - 60, y: tree[1], hp: 100, cash: 100000 });
    for (let i = 0; i < 20; i++) {
      roomA.send('move', { seq: ++seq, dx: 1, dy: 0, sprint: false });
      await sleep(50);
    }
    await sleep(300);
    const pTree = statePlayer(roomA, roomA.sessionId);
    const dTree = pTree ? Math.hypot(pTree.x - tree[0], pTree.y - tree[1]) : 0;
    check('solid collision: player stops at a tree (cannot walk through)',
      pTree && dTree >= 27 && pTree.x > tree[0] - 60,
      `dist=${dTree.toFixed(1)}px, x=${pTree ? pTree.x.toFixed(0) : '?'}`);
    // Solid collision vs another player: B stands at (400,520) (open
    // grass, far from spawn/animals), A walks east into B — must stop at
    // 32px (16 + 16), never through.
    await testSet(roomB, { x: 400, y: 520, hp: 100 });
    await testSet(roomA, { x: 340, y: 520, hp: 100, cash: 100000 });
    for (let i = 0; i < 20; i++) {
      roomA.send('move', { seq: ++seq, dx: 1, dy: 0, sprint: false });
      await sleep(50);
    }
    await sleep(300);
    const pAcol = statePlayer(roomA, roomA.sessionId), pBcol = statePlayer(roomA, roomB.sessionId);
    const dAB = pAcol && pBcol ? Math.hypot(pAcol.x - pBcol.x, pAcol.y - pBcol.y) : 0;
    check('solid collision: player cannot walk through another player',
      pAcol && pBcol && dAB >= 31 && pAcol.x > 340, `dist=${dAB.toFixed(1)}px`);
    // Accident: place A 55px ahead of the fastest car (in front of its
    // nose — well inside the braking distance) and wait for the hit.
    // Retry up to 3 times: the car may turn or stop at a light first.
    // Penalty (exact user numbers): hospital, -30% cash, -10 HP.
    let accOk = false;
    for (let attempt = 0; attempt < 3 && !accOk; attempt++) {
      let fv = null;
      roomA.state.vehicles.forEach((v) => { if (!fv || v.speed > fv.speed) fv = v; });
      if (!fv || fv.speed < 100) { await sleep(1000); continue; }
      const ax = fv.x + Math.cos(fv.heading) * 55, ay = fv.y + Math.sin(fv.heading) * 55;
      accidentMsgs.length = 0;
      await testSet(roomA, { x: ax, y: ay, hp: 100, cash: 100000, bank: 0 });
      accOk = await waitForMsg(accidentMsgs,
        (m) => m.playerId === roomA.sessionId && m.lost === 30000, 4000);
      if (!accOk) await testSet(roomA, { hp: 100, cash: 100000 });
    }
    await sleep(300);
    const pAcc = statePlayer(roomA, roomA.sessionId);
    check('traffic accident: hit by a car -> hospital, -30% cash, -10 HP',
      accOk && pAcc && pAcc.cash === 70000 && pAcc.hp === 90
        && Math.hypot(pAcc.x - 4125, pAcc.y - 1890) < 5,
      pAcc ? `cash=${pAcc.cash} hp=${pAcc.hp} at (${pAcc.x.toFixed(0)},${pAcc.y.toFixed(0)})` : 'no state');
  } catch (err) {
    console.log('FAIL - test crashed:', err && err.message);
    failures += 1;
  } finally {
    try { if (roomA) await roomA.leave(); } catch (e) {}
    try { if (roomB) await roomB.leave(); } catch (e) {}
    httpServer.close(() => process.exit(failures === 0 ? 0 : 1));
    setTimeout(() => process.exit(failures === 0 ? 0 : 1), 2000);
  }
}

main();
