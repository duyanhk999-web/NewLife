/* Đô Thị Ảo — shared/m3.js
   M3 pure game rules (SRS v2.1 §3.2 survival, §3.4.3 doctor, §6 Shipper).
   NO dependencies except Colliders (for delivery-point picking) and NO
   side effects: every function is pure and takes its inputs explicitly, so
   the Colyseus server, the offline client and the tests all use the SAME
   numbers. Plain JS, UMD (Node require() + browser <script>), like
   shared/colliders.js and shared/botBrain.js.

   Verified SRS examples (see server/test/test.js):
     deliverySeconds: 500px/180 -> 33s, 2000px/180 -> 41s, 3200px/180 -> 48s,
                      4800px/234 -> 51s, 4800px/324 -> 45s
                      (Math.round(dist/speed + 30))
     deliveryReward:  500px -> 15.000đ day / 19.500đ night (clamped minimum)
                      2000px -> 16.000đ day / 20.800đ night
                      3200px -> 19.000đ day / 24.700đ night
     faintLoss:       50.000 -> lose 25.000
     hospitalFee:     25.000 remaining -> fee 22.500 (10.000 + 12.500)
   M4 (SRS v2.2 §7.2, §8): vehicles (bicycle 234 px/s, motorbike 324 px/s),
   taxi fares, motel rent/chest, doctor revive mini-game. LOCKED numbers
   live here next to the M3 ones; PROPOSAL numbers are named constants
   marked ĐỀ XUẤT so they are one-line tunable (see docs/m4.md). */
(function (root, factory) {
  var Colliders = null;
  if (typeof module !== 'undefined' && module.exports) {
    try { Colliders = require('./colliders'); } catch (e) { Colliders = null; }
    module.exports = factory(Colliders);
  } else {
    root.M3 = factory(root.Colliders || null);
  }
})(typeof self !== 'undefined' ? self : this, function (Colliders) {
  'use strict';

  // M4 (SRS v2.2 §7.2, §8.1 — LOCKED): walk 180 is the base; bicycle
  // +30%, motorbike +80% over WALK (v2.1's 540 px/s = 300 x 1.8 over
  // SPRINT is superseded). BIKE_SPEED is kept as an alias of the bicycle
  // speed so old callers keep working (its old value 540 is gone).
  var WALK_SPEED = 180, SPRINT_SPEED = 300;
  var BICYCLE_SPEED = 234, MOTORBIKE_SPEED = 324, BIKE_SPEED = 234;
  var SHOWROOM_POS = { x: 1665, y: 2850 }; // Showroom Xe Máy POI (Map v2)
  var MOTEL_POS = { x: 2910, y: 2865 };    // Khu Nhà Trọ POI (Map v2)
  var MOTEL_SPAWN = { x: 2910, y: 3100 };  // Open ground south of Motel (outside building rect)
  var MOUNT_RANGE = 80;   // must be within 80 px of the parked vehicle (§8.1)
  var PICKUP_RANGE = 120; // taxi pickup / revive range for passengers
  var DROPOFF_RANGE = 80; // must be within 80 px of the destination
  var WAREHOUSE_POS = { x: 4155, y: 2910 }; // Kho Hàng Trung Tâm POI (Map v2: building centre)
  var HOSPITAL_POS = { x: 4125, y: 1635 };  // Bệnh Viện POI (Map v2: building centre)
  var HOSPITAL_SPAWN = { x: 4125, y: 1890 }; // Open ground south of Hospital (outside 3840..4410,1425..1845)
  var FAINT_SECONDS = 60;
  var HOSPITAL_BUTTON_DELAY_S = 10; // "Về Bệnh viện" appears after 10 s (§3.2.4)
  var DOCTOR_REWARD = 25000;
  var REVIVE_RANGE = 120, TALK_RANGE = 120, SHIPPER_RANGE = 300, DELIVER_RANGE = 80;
  var ORDER_CANCEL_COOLDOWN_S = 10;
  var DOCTOR_COOLDOWN_S = 60;      // between rewarded revives (§3.4.3)
  // v2.2 (supersedes v2.1: 3 rewarded revives / hour): max 2 REWARDED
  // revives of the SAME victim per 60 minutes; 3rd+ still revives but 0đ.
  var DOCTOR_PAIR_CAP_60MIN = 2;
  var DOCTOR_HOURLY_CAP = 2; // old name, same value — kept for callers
  var COLLUSION_PAIR_PER_DAY = 10;  // same pair > 10 revives/day -> flag

  // ---- M4 vehicles (SRS v2.2 §7.2, §8.1) — LOCKED prices/speeds ----
  var BICYCLE_PRICE = 250000, MOTORBIKE_PRICE = 1000000;
  var WALK_CAPACITY_KG = 10; // kg/order on foot (base for the +30%/+80%)
  // Capacity kg/order — ĐỀ XUẤT (§7.2: principle locked, kg table awaits
  // approval): bicycle 13 kg (+30%), motorbike 18 kg (+80%).
  var BICYCLE_CAPACITY_KG = 13, MOTORBIKE_CAPACITY_KG = 18;
  // Fuel — LOCKED price, PROPOSAL range is the SRS §8.1 figure itself
  // (1 bình 5.000đ đi 8.000 px): motorbike only, bicycle has no fuel.
  var FUEL_PRICE = 5000, FUEL_RANGE_PX = 8000; // 100% fuel = 8000 px
  // Bicycle durability — ĐỀ XUẤT (§8.1): 100% lasts 50.000 px, one repair
  // 10.000đ at the shop. At 0% the bicycle rides at walk speed (180).
  var BIKE_DURABILITY_PX = 50000, BIKE_REPAIR_PRICE = 10000;
  // Shipper pay by vehicle — LOCKED (user 2026-11-25 01:02): walk x1.00,
  // bicycle x1.30, motorbike x2.00 (NOT x1.80 — only the pay multiplier is
  // x2.00; motorbike speed/capacity stay +80%: 324 px/s, 18 kg).
  // Example: a 16.000đ walk order pays 20.800đ by bicycle, 32.000đ by
  // motorbike. One-line tunable constants, but no longer proposals.
  var SHIPPER_PAY_MULT_FOOT = 1.00;
  var SHIPPER_PAY_MULT_BICYCLE = 1.30;   // LOCKED
  var SHIPPER_PAY_MULT_MOTORBIKE = 2.00; // LOCKED (user 2026-11-25 01:02)

  // ---- M4 taxi (SRS v2.2 §3.4.2, §4.1 — LOCKED) ----
  var TAXI_FARE_PER_100PX = 1000, TAXI_FARE_MIN = 5000, TAXI_FARE_MAX = 20000;
  var TAX_RATE = 0.05; // LOCKED 2026-11-25: all taxes 5%, BUYER pays.
  var TAXI_NIGHT_MULT = 1.30, TAXI_NIGHT_BONUS_MAX = 6000; // SYSTEM pays
  var TAXI_MIN_TRIP_PX = 600; // ĐỀ XUẤT (§16.6): trips shorter than this
  // do not count for fare (anti-teleport/farm check) — enforced as a
  // minimum-distance check, fare itself still uses TAXI_FARE_MIN.
  var TAXI_CUSTOMER_MAX = 4; // max NPC wandering customers at once (§10.2)
  var TAXI_CUSTOMER_DESPAWN_S = 300; // despawn after 5 min unpicked (§10.2)

  // Danh tính đa dạng cho khách NPC Taxi (học hỏi từ hệ thống Citizen sống động của The Capitol)
  var TAXI_CITIZEN_PERSONAS = [
    { name: 'Khách công sở', avatar: 'student', lines: ['Cho tôi ra Bệnh viện kiểm tra sức khỏe gấp!', 'Tới Ngân Hàng giúp tôi nhé bác tài!'] },
    { name: 'Bác Ba dân phố', avatar: 'guide', lines: ['Bác tài chở tôi về Khu Nhà Trọ nghỉ ngơi nhé.', 'Chở tôi ra Chợ mua ít đồ ăn nha!'] },
    { name: 'Cô Lan tiểu thương', avatar: 'doctor', lines: ['Ghé Cửa Hàng Tiện Lợi 24/7 giùm cô.', 'Chạy cẩn thận nha tài xế, cô say xe đó!'] },
    { name: 'Bạn trẻ du khách', avatar: 'hero', lines: ['Chở em tới Quảng Trường hóng gió với anh ơi.', 'Điểm đến quen thuộc, tính cước chuẩn nha bác tài!'] },
    { name: 'Anh Hùng thợ máy', avatar: 'walker', lines: ['Cho anh về Showroom Xe Máy lấy đồ.', 'Hôm nay đông khách không chú em?'] }
  ];

  function pickTaxiCitizenPersona(randFn) {
    var rnd = randFn || Math.random;
    return TAXI_CITIZEN_PERSONAS[Math.floor(rnd() * TAXI_CITIZEN_PERSONAS.length)];
  }

  // ---- M4 motel (SRS v2.2 §8.2, §4.1 — LOCKED) ----
  var MOTEL_RENT = 50000, MOTEL_RENT_HOURS = 24; // 50.000đ / 24h real
  var MOTEL_CHEST_SLOTS = 10; // 10 item slots; no vehicles, no money
  var MOTEL_CHEST_HOLD_HOURS = 24; // after expiry: held 24h (locked),
  // then deleted for good (§8.2). Renewing inside the hold re-opens it.
  var MOTEL_RENEW_MAX_DAYS = 7; // max 7 days of advance renewal (§8.2)

  // ---- M4 doctor revive mini-game (SRS v2.2 §18.5 — PROPOSAL impl.) ----
  // Rhythm tap; >=90% accuracy -> victim +20 HP on top of the locked 30 HP
  // floor. Reward 25.000đ, 60 s cooldown and the 2/60min pair cap are
  // UNCHANGED — the mini-game only changes revive quality, never money.
  var REVIVE_BASE_HP = 30;
  var REVIVE_MINIGAME_BONUS_HP = 20; // ĐỀ XUẤT
  var REVIVE_MINIGAME_PASS_PCT = 90; // ĐỀ XUẤT

  // Delivery-point POIs (§6.2: random coordinate near a POI). Warehouse is
  // the pickup point, so it is never a delivery target. Coords are Map v2
  // building centres (shared/colliders.js §3).
  var DELIVERY_POIS = [
    { id: 'spawn',    name: 'Quảng Trường Trung Tâm', x: 2400, y: 2625 },
    { id: 'bank',     name: 'Ngân Hàng & ATM',        x: 1650, y: 1590 },
    { id: 'shop',     name: 'Cửa Hàng Tiện Lợi 24/7', x: 2895, y: 1590 },
    { id: 'hospital', name: 'Bệnh Viện',              x: 4125, y: 1635 },
    { id: 'showroom', name: 'Showroom Xe Máy',        x: 1665, y: 2850 },
    { id: 'motel',    name: 'Khu Nhà Trọ',            x: 2910, y: 2865 }
  ];

  // ---- Shipper pickup sources (user decision 2026-11-25) ----
  // Orders are picked up from MANY places, not just the warehouse: 50% of
  // orders from Kho Hàng Trung Tâm (as before), 50% from shops — food /
  // convenience / motel / other shops. Coords are Map v2 building centres
  // (shared/colliders.js §3); the player accepts within SHIPPER_RANGE
  // (300px) of the source, exactly like the warehouse before. The
  // warehouse entry MUST stay index 0 (pickOrderSource returns it for the
  // 50% branch); WAREHOUSE_POS above is the same point.
  var SHIPPER_SOURCES = [
    { id: 'warehouse', name: 'Kho Hàng Trung Tâm',     x: 4155, y: 2910 },
    { id: 'shop',      name: 'Cửa Hàng Tiện Lợi 24/7', x: 2895, y: 1590 },
    { id: 'motel',     name: 'Khu Nhà Trọ',            x: 2910, y: 2865 },
    { id: 'market',    name: 'Chợ',                    x: 4155, y: 4065 },
    { id: 'cafe',      name: 'Quán Cà Phê',            x: 2700, y: 4380 }
  ];
  // Pick an order's pickup source: 50% warehouse, 50% one of the shops
  // (uniform among the 4 shops). randFn defaults to Math.random; pass a
  // seeded function in tests for determinism.
  function pickOrderSource(randFn) {
    var rnd = randFn || Math.random;
    if (rnd() < 0.5) return SHIPPER_SOURCES[0];
    var shops = SHIPPER_SOURCES.slice(1);
    return shops[Math.floor(rnd() * shops.length)];
  }
  // Nearest pickup source to (x, y), with its distance — the accept check
  // is "within SHIPPER_RANGE of the NEAREST source" (any source, not just
  // the warehouse). Returns {id, name, x, y, distance}.
  function nearestShipperSource(x, y) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < SHIPPER_SOURCES.length; i++) {
      var s = SHIPPER_SOURCES[i];
      var d = dist(x, y, s.x, s.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return { id: best.id, name: best.name, x: best.x, y: best.y, distance: bestD };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

  // §6.3: Delivery_Time = distance/speed + 30 s buffer, rounded to seconds.
  function deliverySeconds(distancePx, speedPxPerS) {
    return Math.round(distancePx / speedPxPerS + 30);
  }

  // §6.4: base = 12000 + ceil(dist/500)*1000, clamped 15.000-22.000 day,
  // night = round(day * 1.30).
  function deliveryReward(distancePx, isNight) {
    var base = 12000 + Math.ceil(distancePx / 500) * 1000;
    var day = clamp(base, 15000, 22000);
    return isNight ? Math.round(day * 1.30) : day;
  }

  // Dynamic Surge Pricing (học hỏi từ hệ thống khan hiếm/cung cầu động của The Capitol):
  // Hệ số thưởng đơn hàng tăng khi:
  // - Ban đêm: giữ nguyên quy chuẩn x1.30 (+30%)
  // - Đơn hàng gấp / xa (> 2500px): surge +10% (+15% nếu > 3500px)
  // - Surge cấp số theo nhu cầu thị trường (surgeFactor: 1.0 đến 1.5)
  function calculateSurgeMultiplier(distancePx, isNight, marketDemandSurge) {
    var mult = 1.0;
    if (isNight) mult *= 1.30;
    if (distancePx >= 3500) mult *= 1.15;
    else if (distancePx >= 2500) mult *= 1.10;
    if (typeof marketDemandSurge === 'number' && marketDemandSurge > 1.0) {
      mult *= Math.min(marketDemandSurge, 1.50); // cap max +50% surge do thị trường
    }
    return mult;
  }

  // §6.4 reward with the LOCKED vehicle multiplier and dynamic surge applied, rounded.
  function deliveryRewardDynamic(distancePx, isNight, vehicleId, marketDemandSurge) {
    var base = 12000 + Math.ceil(distancePx / 500) * 1000;
    var dayBase = clamp(base, 15000, 22000);
    var surge = calculateSurgeMultiplier(distancePx, isNight, marketDemandSurge);
    var vMult = shipperPayMultiplier(vehicleId);
    return Math.round(dayBase * surge * vMult);
  }

  // §3.2.3: fainting loses 50% of carried Cash immediately (round down).
  function faintLoss(cash) { return Math.floor(cash / 2); }

  // §3.2.5: hospital fee = 10.000 + 50% of Cash REMAINING after faint loss.
  function hospitalFee(cashAfterLoss) {
    return 10000 + Math.floor(cashAfterLoss / 2);
  }

  // §3.2.5: deduct fee from Cash first, then Bank; never negative, never debt.
  // Returns {cash, bank, paid} — paid < fee only when cash+bank < fee.
  function deductFee(cash, bank, fee) {
    var paid = 0;
    var fromCash = Math.min(cash, fee);
    cash -= fromCash; paid += fromCash;
    var fromBank = Math.min(bank, fee - paid);
    bank -= fromBank; paid += fromBank;
    return { cash: cash, bank: bank, paid: paid };
  }

  function isNightWorld(worldTime) {
    var h = Math.floor((worldTime || 480) / 60) % 24;
    return h >= 18 || h < 6;
  }

  // §6.2: random delivery point near a POI (open ground, not inside a
  // building, not on a road). randFn defaults to Math.random; pass a seeded
  // function in tests for determinism. excludePoiId (optional) skips one
  // POI — used for shipper orders so the delivery is never the same shop
  // the order was picked up from.
  function pickDeliveryPoint(randFn, excludePoiId) {
    var rnd = randFn || Math.random;
    if (Colliders) {
      for (var i = 0; i < 40; i++) {
        var poi = DELIVERY_POIS[Math.floor(rnd() * DELIVERY_POIS.length)];
        if (excludePoiId && poi.id === excludePoiId) continue;
        var a = rnd() * Math.PI * 2, r = 40 + rnd() * 220;
        var x = poi.x + Math.cos(a) * r, y = poi.y + Math.sin(a) * r;
        if (Colliders.isOpenPoint(x, y)) return { x: Math.round(x), y: Math.round(y), poiId: poi.id, poiName: poi.name };
      }
      var p = Colliders.randomOpenPoint(rnd);
      return { x: Math.round(p.x), y: Math.round(p.y), poiId: null, poiName: null };
    }
    // No Colliders (should not happen in the game): fall back to a POI point.
    var poi2 = DELIVERY_POIS[Math.floor(rnd() * DELIVERY_POIS.length)];
    if (excludePoiId && poi2.id === excludePoiId) poi2 = DELIVERY_POIS[(DELIVERY_POIS.indexOf(poi2) + 1) % DELIVERY_POIS.length];
    return { x: poi2.x, y: poi2.y, poiId: poi2.id, poiName: poi2.name };
  }

  // §3.4.3 doctor revive reward, all server-side. Inputs are explicit so
  // tests can pass fake timestamps:
  //   job: the reviver's job; now: ms epoch; lastRewardedAt: ms epoch of
  //   the doctor's last REWARDED revive (0 = none); revivesLast60Min:
  //   number of REWARDED revives of THIS victim in the last 60 minutes.
  // Returns {reward, reason}: reason is 'OK' | 'NOT_DOCTOR' | 'COOLDOWN' |
  // 'PAIR_CAP' (v2.2: 2 rewarded revives of the same victim / 60 min).
  function doctorRewardCheck(job, now, lastRewardedAt, revivesLast60Min) {
    if (job !== 'doctor') return { reward: 0, reason: 'NOT_DOCTOR' };
    if (lastRewardedAt && now - lastRewardedAt < DOCTOR_COOLDOWN_S * 1000) {
      return { reward: 0, reason: 'COOLDOWN' };
    }
    if (revivesLast60Min >= DOCTOR_PAIR_CAP_60MIN) {
      return { reward: 0, reason: 'PAIR_CAP' };
    }
    return { reward: DOCTOR_REWARD, reason: 'OK' };
  }

  // ---- M4: vehicles (§7.2, §8.1) ----
  // Speed of a vehicle id: '' (on foot) -> WALK; 'bicycle' -> 234;
  // 'motorbike' -> 324. A motorbike with 0 fuel or a bicycle with 0%
  // durability is PUSHED at walk speed (180) — pass fuel/durability in.
  function vehicleSpeed(vehicleId, fuelPct, durabilityPct) {
    if (vehicleId === 'motorbike') return (fuelPct === undefined || fuelPct > 0) ? MOTORBIKE_SPEED : WALK_SPEED;
    if (vehicleId === 'bicycle') return (durabilityPct === undefined || durabilityPct > 0) ? BICYCLE_SPEED : WALK_SPEED;
    return WALK_SPEED;
  }
  // Hunger 20–1: x0.7 on EVERY speed (§3.2.2 table, v2.2 values).
  function speedWithHunger(speed, hunger) {
    return (hunger >= 1 && hunger < 20) ? Math.round(speed * 0.7) : speed;
  }
  function vehicleCapacityKg(vehicleId) {
    if (vehicleId === 'bicycle') return BICYCLE_CAPACITY_KG;
    if (vehicleId === 'motorbike') return MOTORBIKE_CAPACITY_KG;
    return WALK_CAPACITY_KG;
  }
  function vehiclePrice(vehicleId) {
    if (vehicleId === 'bicycle') return BICYCLE_PRICE;
    if (vehicleId === 'motorbike') return MOTORBIKE_PRICE;
    return 0;
  }
  // Shipper pay multiplier by vehicle — ĐỀ XUẤT (§6.4), one-line tunable.
  function shipperPayMultiplier(vehicleId) {
    if (vehicleId === 'bicycle') return SHIPPER_PAY_MULT_BICYCLE;
    if (vehicleId === 'motorbike') return SHIPPER_PAY_MULT_MOTORBIKE;
    return SHIPPER_PAY_MULT_FOOT;
  }
  // §6.4 reward with the LOCKED vehicle multiplier applied, rounded.
  function deliveryRewardFor(distancePx, isNight, vehicleId) {
    return Math.round(deliveryReward(distancePx, isNight) * shipperPayMultiplier(vehicleId));
  }
  // Fuel/durability drain by distance travelled (px). 100% fuel = 8000 px
  // (1% = 80 px); 100% bicycle durability = 50.000 px (1% = 500 px).
  function fuelAfterDistance(fuelPct, distancePx) {
    return Math.max(0, fuelPct - distancePx / (FUEL_RANGE_PX / 100));
  }
  function durabilityAfterDistance(durabilityPct, distancePx) {
    return Math.max(0, durabilityPct - distancePx / (BIKE_DURABILITY_PX / 100));
  }

  // ---- M4: taxi (§3.4.2, §4.1, §9) ----
  // Fare for a trip of distancePx (actual distance travelled): 1.000đ per
  // 100 px, clamped 5.000–20.000đ. Tax is 5% — the BUYER (passenger) pays
  // it on top of the fare (LOCKED 2026-11-25). At night the SYSTEM pays
  // the driver a +30% bonus, capped at 6.000đ (§9); the passenger never
  // pays the bonus. Returns {fare, tax, passengerPays, driverReceives,
  // nightBonus}. For an NPC passenger the fare is paid by SYSTEM (the NPC
  // has no wallet) — driverReceives is the same either way.
  function taxiFare(distancePx, isNight) {
    var fare = clamp(Math.round(distancePx / 100) * TAXI_FARE_PER_100PX, TAXI_FARE_MIN, TAXI_FARE_MAX);
    var tax = Math.round(fare * TAX_RATE);
    var nightBonus = isNight ? Math.min(Math.round(fare * (TAXI_NIGHT_MULT - 1)), TAXI_NIGHT_BONUS_MAX) : 0;
    return {
      fare: fare, tax: tax,
      passengerPays: fare + tax, driverReceives: fare + nightBonus,
      nightBonus: nightBonus
    };
  }

  // ---- M4: motel (§8.2) ----
  // Room expiry: rent/renew adds 24h. Renewal extends from the OLD
  // expiresAt (not from now), max 7 days ahead.
  function motelRenewExpiry(currentExpiresAt, now) {
    var base = Math.max(currentExpiresAt || 0, now);
    return base + MOTEL_RENT_HOURS * 3600 * 1000;
  }
  function motelIsActive(expiresAt, now) {
    return !!expiresAt && now < expiresAt;
  }
  // Chest state: 'none' (never rented), 'active' (room rented),
  // 'held' (expired < 24h ago — locked, renew re-opens), 'deleted'
  // (expired >= 24h ago — contents gone for good).
  function motelChestState(expiresAt, now) {
    if (!expiresAt) return 'none';
    if (now < expiresAt) return 'active';
    if (now < expiresAt + MOTEL_CHEST_HOLD_HOURS * 3600 * 1000) return 'held';
    return 'deleted';
  }

  // ---- M4: doctor revive mini-game (§18.5, PROPOSAL) ----
  // accuracyPct 0–100 (clamped; the server never trusts a client number
  // above the cap — the bonus itself is bounded at +20 HP either way).
  // >= 90% -> +20 HP on top of the locked 30 HP floor; otherwise +0.
  function doctorMinigameBonus(accuracyPct) {
    var pct = clamp(accuracyPct || 0, 0, 100);
    return pct >= REVIVE_MINIGAME_PASS_PCT ? REVIVE_MINIGAME_BONUS_HP : 0;
  }

  // §3.4.3: same doctor/victim pair reviving > 10 times in one day is
  // flagged 'suspected_collusion' (no auto-ban in P0).
  function collusionFlagged(pairRevivesToday) {
    return pairRevivesToday > COLLUSION_PAIR_PER_DAY;
  }

  var JOB_LABELS = {
    unemployed: 'Chưa có', shipper: 'Shipper', doctor: 'Bác sĩ', taxi_driver: 'Tài xế'
  };
  var JOBS = ['unemployed', 'shipper', 'doctor', 'taxi_driver'];

  return {
    WALK_SPEED: WALK_SPEED, SPRINT_SPEED: SPRINT_SPEED, BIKE_SPEED: BIKE_SPEED,
    BICYCLE_SPEED: BICYCLE_SPEED, MOTORBIKE_SPEED: MOTORBIKE_SPEED,
    SHOWROOM_POS: SHOWROOM_POS, MOTEL_POS: MOTEL_POS, MOTEL_SPAWN: MOTEL_SPAWN,
    MOUNT_RANGE: MOUNT_RANGE, PICKUP_RANGE: PICKUP_RANGE, DROPOFF_RANGE: DROPOFF_RANGE,
    WAREHOUSE_POS: WAREHOUSE_POS, HOSPITAL_POS: HOSPITAL_POS, HOSPITAL_SPAWN: HOSPITAL_SPAWN,
    FAINT_SECONDS: FAINT_SECONDS, HOSPITAL_BUTTON_DELAY_S: HOSPITAL_BUTTON_DELAY_S,
    DOCTOR_REWARD: DOCTOR_REWARD,
    REVIVE_RANGE: REVIVE_RANGE, TALK_RANGE: TALK_RANGE,
    SHIPPER_RANGE: SHIPPER_RANGE, DELIVER_RANGE: DELIVER_RANGE,
    ORDER_CANCEL_COOLDOWN_S: ORDER_CANCEL_COOLDOWN_S,
    DOCTOR_COOLDOWN_S: DOCTOR_COOLDOWN_S, DOCTOR_HOURLY_CAP: DOCTOR_HOURLY_CAP,
    DOCTOR_PAIR_CAP_60MIN: DOCTOR_PAIR_CAP_60MIN,
    COLLUSION_PAIR_PER_DAY: COLLUSION_PAIR_PER_DAY,
    // M4 vehicles (locked prices/speeds; proposal multipliers marked above)
    BICYCLE_PRICE: BICYCLE_PRICE, MOTORBIKE_PRICE: MOTORBIKE_PRICE,
    WALK_CAPACITY_KG: WALK_CAPACITY_KG,
    BICYCLE_CAPACITY_KG: BICYCLE_CAPACITY_KG, MOTORBIKE_CAPACITY_KG: MOTORBIKE_CAPACITY_KG,
    FUEL_PRICE: FUEL_PRICE, FUEL_RANGE_PX: FUEL_RANGE_PX,
    BIKE_DURABILITY_PX: BIKE_DURABILITY_PX, BIKE_REPAIR_PRICE: BIKE_REPAIR_PRICE,
    SHIPPER_PAY_MULT_FOOT: SHIPPER_PAY_MULT_FOOT,
    SHIPPER_PAY_MULT_BICYCLE: SHIPPER_PAY_MULT_BICYCLE,
    SHIPPER_PAY_MULT_MOTORBIKE: SHIPPER_PAY_MULT_MOTORBIKE,
    // M4 taxi (locked fares/tax; min-trip distance is a proposal)
    TAXI_FARE_PER_100PX: TAXI_FARE_PER_100PX, TAXI_FARE_MIN: TAXI_FARE_MIN,
    TAXI_FARE_MAX: TAXI_FARE_MAX, TAX_RATE: TAX_RATE,
    TAXI_NIGHT_MULT: TAXI_NIGHT_MULT, TAXI_NIGHT_BONUS_MAX: TAXI_NIGHT_BONUS_MAX,
    TAXI_MIN_TRIP_PX: TAXI_MIN_TRIP_PX,
    TAXI_CUSTOMER_MAX: TAXI_CUSTOMER_MAX, TAXI_CUSTOMER_DESPAWN_S: TAXI_CUSTOMER_DESPAWN_S,
    TAXI_CITIZEN_PERSONAS: TAXI_CITIZEN_PERSONAS, pickTaxiCitizenPersona: pickTaxiCitizenPersona,
    // M4 motel (locked)
    MOTEL_RENT: MOTEL_RENT, MOTEL_RENT_HOURS: MOTEL_RENT_HOURS,
    MOTEL_CHEST_SLOTS: MOTEL_CHEST_SLOTS, MOTEL_CHEST_HOLD_HOURS: MOTEL_CHEST_HOLD_HOURS,
    MOTEL_RENEW_MAX_DAYS: MOTEL_RENEW_MAX_DAYS,
    // M4 doctor mini-game (proposal)
    REVIVE_BASE_HP: REVIVE_BASE_HP, REVIVE_MINIGAME_BONUS_HP: REVIVE_MINIGAME_BONUS_HP,
    REVIVE_MINIGAME_PASS_PCT: REVIVE_MINIGAME_PASS_PCT,
    DELIVERY_POIS: DELIVERY_POIS, SHIPPER_SOURCES: SHIPPER_SOURCES,
    pickOrderSource: pickOrderSource, nearestShipperSource: nearestShipperSource,
    JOB_LABELS: JOB_LABELS, JOBS: JOBS,
    clamp: clamp, dist: dist,
    deliverySeconds: deliverySeconds, deliveryReward: deliveryReward,
    deliveryRewardFor: deliveryRewardFor,
    calculateSurgeMultiplier: calculateSurgeMultiplier,
    deliveryRewardDynamic: deliveryRewardDynamic,
    faintLoss: faintLoss, hospitalFee: hospitalFee, deductFee: deductFee,
    isNightWorld: isNightWorld, pickDeliveryPoint: pickDeliveryPoint,
    doctorRewardCheck: doctorRewardCheck, collusionFlagged: collusionFlagged,
    vehicleSpeed: vehicleSpeed, speedWithHunger: speedWithHunger,
    vehicleCapacityKg: vehicleCapacityKg, vehiclePrice: vehiclePrice,
    shipperPayMultiplier: shipperPayMultiplier,
    fuelAfterDistance: fuelAfterDistance,
    durabilityAfterDistance: durabilityAfterDistance,
    taxiFare: taxiFare,
    motelRenewExpiry: motelRenewExpiry, motelIsActive: motelIsActive,
    motelChestState: motelChestState,
    doctorMinigameBonus: doctorMinigameBonus
  };
});
