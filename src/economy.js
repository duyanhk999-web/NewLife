/* Đô Thị Ảo — M2 Economy (SRS v2.1 §4, §5).
   Plug-ready Supabase + local fallback. NO real keys are hardcoded here.
   - With Supabase configured (window.SUPABASE_URL + SUPABASE_ANON_KEY, or
     ?supabase_url= / ?supabase_key=), buy/ATM go through the atomic RPCs
     (rpc_shop_buy / rpc_atm_transfer / rpc_starter_grant) — see
     supabase/migrations/003_rpc.sql. Any Supabase error falls back to local.
   - Without keys: everything works LOCALLY (localStorage wallet +
     in-memory transaction log with idempotency keys), so the Netlify link
     still plays. Local mode is clearly labelled in the UI ("Chế độ local").
   Rules enforced here (same rules the server enforces online):
   - profile starts Cash = 0; starter grant 80.000đ ONCE (starter_grant tx)
   - prices come from ITEMS (= game_items table), never hardcoded in gameplay
   - every money action has an idempotency request_id; a repeated request_id
     returns ALREADY_PROCESSED and changes nothing
   - ATM: 1.000–200.000đ per transaction, max 500.000đ/day (real day)
   M4 (SRS v2.2 §8): vehicles + motel, offline mirror of the server rules
   in shared/m3.js — buy at the Showroom, mount/dismount with the E key
   (or the job panel), fuel/durability drain by distance, motel rent
   50.000đ/24h with a 10-slot chest in the same localStorage wallet. */
(function () {
  'use strict';

  // Mirror of game_items seed (supabase/migrations/001_m2.sql). The server
  // and Supabase are the source of truth when connected; this copy is only
  // for local/offline mode.
  var ITEMS = {
    banh_mi: { id: 'banh_mi', name: 'Bánh mì', price: 15000, dayPrice: 13500, hunger: 40, stamina: 0, desc: 'Hồi +40 Độ no' },
    nuoc_tang_luc: { id: 'nuoc_tang_luc', name: 'Nước tăng lực', price: 10000, dayPrice: 10000, hunger: 0, stamina: 50, desc: 'Hồi +50 Thể lực' }
  };
  var STARTER_GRANT = 80000; // v2.2 (supersedes v2.1: 50.000đ)
  var ATM_MIN = 1000, ATM_MAX = 200000, ATM_DAY_MAX = 500000;
  var SHOP_POS = { x: 2895, y: 1590 }; // Cửa Hàng Tiện Lợi POI (Map v2)
  var BANK_POS = { x: 1650, y: 1590 }; // Ngân Hàng & ATM POI (Map v2)
  var SHOWROOM_POS = { x: 1665, y: 2850 }; // Showroom Xe Máy POI (Map v2)
  var MOTEL_POS = { x: 2910, y: 2865 }; // Khu Nhà Trọ POI (Map v2)
  var SHOP_RANGE = 300; // must be within 300px to open shop/ATM (SRS gameplay)
  var LS_KEY = 'dta_m2_wallet_v1';

  // M4 vehicles (§8.1 — LOCKED prices/speeds, shared/m3.js is the source
  // of truth; these numbers only mirror it for the offline wallet).
  var VEHICLES = {
    bicycle: { id: 'bicycle', name: 'Xe đạp', price: 250000, speed: 234, desc: '234 px/s (+30%), chở 13 kg, không tốn xăng' },
    motorbike: { id: 'motorbike', name: 'Xe máy', price: 1000000, speed: 324, desc: '324 px/s (+80%), chở 18 kg, xăng 5.000đ/bình' }
  };
  var MOUNT_RANGE = 80;
  var riding = ''; // '' | 'bicycle' | 'motorbike' — session-only, not saved
  var onlineInventory = {}; // online mirror fed from server econ_result / motel_result
  var onlineAtmDayUsed = 0;
  var onlineVehiclesState = null; // online mirror fed from main.js vehicle_result status

  var state = null;        // playerState object (attached by main.js)
  var clockFn = null;      // () => worldTime minutes
  var wallet = null;       // local wallet (localStorage)
  var mode = 'local';      // 'local' | 'supabase'
  var sb = null;           // supabase client, when configured

  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function fmt(n) { return Math.floor(n).toLocaleString('vi-VN') + 'đ'; }
  function hourNow() {
    try { var m = clockFn ? clockFn() : 480; return Math.floor(m / 60) % 24; } catch (e) { return 8; }
  }
  function isDay() { var h = hourNow(); return h >= 6 && h < 18; }
  function priceOf(item) { return (isDay() && item.dayPrice) ? item.dayPrice : item.price; }

  function loadWallet() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        var w = JSON.parse(raw);
        if (w && typeof w.cash === 'number') {
          // M4 migration: wallets saved before M4 have no vehicles/motel.
          if (!w.vehicles) w.vehicles = { bicycle: null, motorbike: null };
          if (!w.motel) w.motel = { expiresAt: 0, chest: {} };
          return w;
        }
      }
    } catch (e) { /* private mode etc. — fall through to fresh wallet */ }
    return { cash: 0, bank: 0, inventory: {}, tx: [], granted: false, atmDay: { date: todayStr(), total: 0 }, processed: [], vehicles: { bicycle: null, motorbike: null }, motel: { expiresAt: 0, chest: {} } };
  }
  function saveWallet() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(wallet)); } catch (e) { /* ignore */ }
  }
  function logTx(type, amount, meta) {
    wallet.tx.unshift({ type: type, amount: amount, at: Date.now(), meta: meta || {} });
    if (wallet.tx.length > 50) wallet.tx.length = 50;
  }
  function applyToState() {
    if (!state) return;
    state.cash = wallet.cash;
    state.bank = wallet.bank;
  }

  // ---- Supabase plug (optional) ----
  function trySupabase() {
    var url = null, key = null;
    try {
      var q = new URLSearchParams(window.location.search);
      url = q.get('supabase_url') || window.SUPABASE_URL || null;
      key = q.get('supabase_key') || window.SUPABASE_ANON_KEY || null;
    } catch (e) { /* ignore */ }
    if (url && key && typeof window.supabase !== 'undefined' && window.supabase.createClient) {
      try {
        sb = window.supabase.createClient(url, key);
        mode = 'supabase';
        console.log('[economy] Supabase configured — RPC mode');
        return true;
      } catch (e) { console.warn('[economy] supabase client failed, local mode:', e); }
    }
    mode = 'local';
    return false;
  }

  // ---- core actions (local path; Supabase path calls the same RPC names) ----
  function starterGrant() {
    if (wallet.granted) return { ok: false, error: 'ALREADY_GRANTED' };
    wallet.granted = true;
    wallet.cash += STARTER_GRANT;
    logTx('starter_grant', STARTER_GRANT, { once: true });
    saveWallet(); applyToState();
    return { ok: true, cash: wallet.cash };
  }

  // M3 (§3.2.3/§3.2.5, offline mirror of the server rules in shared/m3.js):
  // faintLoss halves carried Cash at faint time (sink, Bank untouched);
  // hospitalFee charges 10.000 + 50% of the remaining Cash, Cash first then
  // Bank, never negative; grant adds a server-calculated reward (Shipper /
  // doctor) with its idempotency key in the log.
  function faintLoss() {
    var lost = Math.floor(wallet.cash / 2);
    wallet.cash -= lost;
    logTx('faint_loss', -lost, { cash_after: wallet.cash });
    saveWallet(); applyToState();
    return { ok: true, lost: lost, cash: wallet.cash };
  }
  function hospitalFee() {
    var fee = 10000 + Math.floor(wallet.cash / 2);
    var fromCash = Math.min(wallet.cash, fee);
    wallet.cash -= fromCash;
    var fromBank = Math.min(wallet.bank, fee - fromCash);
    wallet.bank -= fromBank;
    var paid = fromCash + fromBank;
    logTx('hospital_fee', -paid, { fee: fee, cash_after: wallet.cash });
    saveWallet(); applyToState();
    return { ok: true, fee: fee, paid: paid, cash: wallet.cash, bank: wallet.bank };
  }
  function grant(amount, type, meta) {
    wallet.cash += amount;
    logTx(type || 'job_reward', amount, meta || {});
    saveWallet(); applyToState();
    return { ok: true, cash: wallet.cash, bank: wallet.bank };
  }

  // ---- M4 vehicles + motel (offline mirror of the server, shared/m3.js) ----
  // Money for vehicles/motel comes from Cash first, then Bank (same rule
  // as the hospital fee, §3.2.5) — Bank is where vehicle/rent money lives
  // (§3.3). Never negative, never debt.
  function deductCashBank(amount) {
    if (wallet.cash + wallet.bank < amount) return { ok: false, paid: 0 };
    var fromCash = Math.min(wallet.cash, amount);
    wallet.cash -= fromCash;
    var fromBank = Math.min(wallet.bank, amount - fromCash);
    wallet.bank -= fromBank;
    return { ok: true, paid: fromCash + fromBank };
  }
  function m3() {
    return (typeof window !== 'undefined' && window.M3) ? window.M3 : null;
  }
  function ridingSpeed() {
    var M = m3();
    if (!riding) return 180;
    if (M) return M.vehicleSpeed(riding, riddenFuel(), riddenDurability());
    if (riding === 'motorbike') return (riddenFuel() > 0) ? 324 : 180;
    if (riding === 'bicycle') return (riddenDurability() > 0) ? 234 : 180;
    return 180;
  }
  function riddenFuel() {
    var v = riding && wallet.vehicles[riding];
    return v ? v.fuel : 100;
  }
  function riddenDurability() {
    var v = riding && wallet.vehicles[riding];
    return v ? v.durability : 100;
  }
  function buyVehicle(type) {
    var spec = VEHICLES[type];
    if (!spec) return { ok: false, error: 'BAD_VEHICLE' };
    if (isFaintedState()) return { ok: false, error: 'FAINTED' };
    if (isOnlineNet() && typeof NetClient.sendVehicle === 'function') {
      if (!nearShowroom()) return { ok: false, error: 'TOO_FAR' };
      NetClient.sendVehicle('buy', { vehicleId: type });
      return { ok: true, pending: true };
    }
    if (wallet.vehicles[type]) return { ok: false, error: 'ALREADY_OWNED' };
    if (!nearShowroom()) return { ok: false, error: 'TOO_FAR' };
    var paid = deductCashBank(spec.price);
    if (!paid.ok) return { ok: false, error: 'INSUFFICIENT_FUNDS', need: spec.price };
    // Parked on the open lot SOUTH of the Showroom — the showroom
    // building itself is blocked, so parking at SHOWROOM_POS would strand
    // the vehicle where nobody can mount it (same fix as server).
    wallet.vehicles[type] = { fuel: 100, durability: 100, x: SHOWROOM_POS.x, y: SHOWROOM_POS.y + 270 };
    logTx('asset_buy', -spec.price, { asset_type: 'vehicle', asset_code: type });
    saveWallet(); applyToState();
    return { ok: true, vehicleId: type, cash: wallet.cash, bank: wallet.bank };
  }
  function mountVehicle(type) {
    var v = wallet.vehicles[type];
    if (!v) return { ok: false, error: 'NO_VEHICLE' };
    if (isFaintedState()) return { ok: false, error: 'FAINTED' };
    if (riding) return { ok: false, error: 'ALREADY_RIDING', vehicleId: riding };
    if (!state) return { ok: false, error: 'NO_STATE' };
    if (Math.hypot(state.x - v.x, state.y - v.y) > MOUNT_RANGE) {
      return { ok: false, error: 'TOO_FAR', x: v.x, y: v.y };
    }
    riding = type;
    saveWallet();
    return { ok: true, vehicleId: type, fuel: v.fuel, durability: v.durability };
  }
  function dismountVehicle() {
    if (!riding) return { ok: false, error: 'NOT_RIDING' };
    var cur = riding;
    var v = wallet.vehicles[cur];
    if (v && state) { v.x = state.x; v.y = state.y; }
    riding = '';
    saveWallet();
    return { ok: true, vehicleId: cur };
  }
  // Drain fuel/durability by distance actually travelled (called by
  // main.js updatePlayer). Returns {outOfFuel, wornOut} edge flags.
  function rideDistance(px) {
    if (!riding || px <= 0) return { outOfFuel: false, wornOut: false };
    var v = wallet.vehicles[riding];
    if (!v) return { outOfFuel: false, wornOut: false };
    var M = m3();
    if (riding === 'motorbike' && v.fuel > 0) {
      var before = v.fuel;
      v.fuel = M ? M.fuelAfterDistance(v.fuel, px) : Math.max(0, v.fuel - px / 80);
      v.fuel = Math.round(v.fuel * 10) / 10;
      saveWallet();
      return { outOfFuel: before > 0 && v.fuel <= 0, wornOut: false };
    }
    if (riding === 'bicycle' && v.durability > 0) {
      var bBefore = v.durability;
      v.durability = M ? M.durabilityAfterDistance(v.durability, px) : Math.max(0, v.durability - px / 500);
      v.durability = Math.round(v.durability * 10) / 10;
      saveWallet();
      return { outOfFuel: false, wornOut: bBefore > 0 && v.durability <= 0 };
    }
    return { outOfFuel: false, wornOut: false };
  }
  function refuel() {
    if (isOnlineNet() && typeof NetClient.sendVehicle === 'function') {
      if (!nearShop()) return { ok: false, error: 'TOO_FAR' };
      NetClient.sendVehicle('refuel', {});
      return { ok: true, pending: true };
    }
    var v = wallet.vehicles.motorbike;
    if (!v) return { ok: false, error: 'NO_VEHICLE' };
    if (!nearShop()) return { ok: false, error: 'TOO_FAR' };
    if (v.fuel >= 100) return { ok: false, error: 'ALREADY_FULL' };
    var paid = deductCashBank(5000);
    if (!paid.ok) return { ok: false, error: 'INSUFFICIENT_FUNDS', need: 5000 };
    v.fuel = 100;
    logTx('shop_buy', -5000, { item_id: 'fuel', qty: 1 });
    saveWallet(); applyToState();
    return { ok: true, fuel: 100, cash: wallet.cash, bank: wallet.bank };
  }
  function repairBike() {
    // Bicycle repair — ĐỀ XUẤT price (§8.1): 10.000đ.
    if (isOnlineNet() && typeof NetClient.sendVehicle === 'function') {
      if (!nearShop()) return { ok: false, error: 'TOO_FAR' };
      NetClient.sendVehicle('repair', {});
      return { ok: true, pending: true };
    }
    var v = wallet.vehicles.bicycle;
    if (!v) return { ok: false, error: 'NO_VEHICLE' };
    if (!nearShop()) return { ok: false, error: 'TOO_FAR' };
    if (v.durability >= 100) return { ok: false, error: 'ALREADY_FULL' };
    var paid = deductCashBank(10000);
    if (!paid.ok) return { ok: false, error: 'INSUFFICIENT_FUNDS', need: 10000 };
    v.durability = 100;
    logTx('shop_buy', -10000, { item_id: 'bike_repair', qty: 1 });
    saveWallet(); applyToState();
    return { ok: true, durability: 100, cash: wallet.cash, bank: wallet.bank };
  }
  function getVehicleState() {
    return {
      riding: riding,
      bicycle: wallet.vehicles.bicycle ? { owned: true, fuel: wallet.vehicles.bicycle.fuel, durability: wallet.vehicles.bicycle.durability, x: wallet.vehicles.bicycle.x, y: wallet.vehicles.bicycle.y } : { owned: false },
      motorbike: wallet.vehicles.motorbike ? { owned: true, fuel: wallet.vehicles.motorbike.fuel, durability: wallet.vehicles.motorbike.durability, x: wallet.vehicles.motorbike.x, y: wallet.vehicles.motorbike.y } : { owned: false },
    };
  }
  // ---- M4 motel (§8.2): rent 50.000đ/24h real, 10-slot chest. The chest
  // lives in the same localStorage wallet as the money (offline) and in
  // server state when online — same persistence the wallet uses.
  function motelChestState() {
    var M = m3();
    var exp = wallet.motel.expiresAt || 0;
    if (M) return M.motelChestState(exp, Date.now());
    if (!exp) return 'none';
    if (Date.now() < exp) return 'active';
    if (Date.now() < exp + 24 * 3600 * 1000) return 'held';
    return 'deleted';
  }
  function motelSweep() {
    // Expired >= 24h ago: chest contents are deleted for good (§8.2).
    if (motelChestState() === 'deleted' && Object.keys(wallet.motel.chest).length) {
      wallet.motel.chest = {};
      saveWallet();
    }
  }
  function motelRent() {
    if (isOnlineNet()) {
      NetClient.sendMotel('rent', {});
      return { ok: true, pending: true };
    }
    if (isFaintedState()) return { ok: false, error: 'FAINTED' };
    if (!nearMotel()) return { ok: false, error: 'TOO_FAR' };
    if (motelChestState() === 'active') return { ok: false, error: 'ALREADY_RENTED', expiresAt: wallet.motel.expiresAt };
    var paid = deductCashBank(50000);
    if (!paid.ok) return { ok: false, error: 'INSUFFICIENT_FUNDS', need: 50000 };
    wallet.motel.expiresAt = Date.now() + 24 * 3600 * 1000;
    logTx('asset_rent', -50000, { asset_type: 'room', asset_code: 'motel_01' });
    saveWallet(); applyToState();
    return { ok: true, expiresAt: wallet.motel.expiresAt, cash: wallet.cash, bank: wallet.bank };
  }
  function motelRenew() {
    if (isOnlineNet()) {
      NetClient.sendMotel('renew', {});
      return { ok: true, pending: true };
    }
    if (isFaintedState()) return { ok: false, error: 'FAINTED' };
    if (!nearMotel()) return { ok: false, error: 'TOO_FAR' };
    if (!wallet.motel.expiresAt) return { ok: false, error: 'NO_ROOM' };
    var M = m3();
    var next = M ? M.motelRenewExpiry(wallet.motel.expiresAt, Date.now())
      : Math.max(wallet.motel.expiresAt, Date.now()) + 24 * 3600 * 1000;
    if (next - Date.now() > 7 * 24 * 3600 * 1000) return { ok: false, error: 'RENEW_LIMIT' };
    var paid = deductCashBank(50000);
    if (!paid.ok) return { ok: false, error: 'INSUFFICIENT_FUNDS', need: 50000 };
    wallet.motel.expiresAt = next;
    logTx('asset_rent', -50000, { asset_type: 'room', asset_code: 'motel_01', renew: true });
    saveWallet(); applyToState();
    return { ok: true, expiresAt: next, cash: wallet.cash, bank: wallet.bank };
  }
  function motelStatus() {
    motelSweep();
    return { expiresAt: wallet.motel.expiresAt || 0, chestState: motelChestState(), chest: Object.assign({}, wallet.motel.chest) };
  }
  function chestPut(itemId, qty) {
    qty = Math.max(1, Math.min(99, qty | 0 || 1));
    if (isOnlineNet()) {
      NetClient.sendMotel('chest_put', { itemId: itemId, qty: qty });
      return { ok: true, pending: true };
    }
    if (motelChestState() !== 'active') return { ok: false, error: 'CHEST_LOCKED', state: motelChestState() };
    if (!ITEMS[itemId]) return { ok: false, error: 'ITEM_NOT_FOUND' };
    var have = wallet.inventory[itemId] || 0;
    if (have < qty) return { ok: false, error: 'NO_ITEM' };
    if (!wallet.motel.chest[itemId] && Object.keys(wallet.motel.chest).length >= 10) {
      return { ok: false, error: 'CHEST_FULL' };
    }
    wallet.inventory[itemId] = have - qty;
    wallet.motel.chest[itemId] = (wallet.motel.chest[itemId] || 0) + qty;
    saveWallet();
    return { ok: true, chest: Object.assign({}, wallet.motel.chest) };
  }
  function chestTake(itemId, qty) {
    qty = Math.max(1, Math.min(99, qty | 0 || 1));
    if (isOnlineNet()) {
      NetClient.sendMotel('chest_take', { itemId: itemId, qty: qty });
      return { ok: true, pending: true };
    }
    if (motelChestState() !== 'active') return { ok: false, error: 'CHEST_LOCKED', state: motelChestState() };
    var stored = wallet.motel.chest[itemId] || 0;
    if (stored < qty) return { ok: false, error: 'NO_ITEM' };
    wallet.motel.chest[itemId] = stored - qty;
    if (wallet.motel.chest[itemId] <= 0) delete wallet.motel.chest[itemId];
    wallet.inventory[itemId] = (wallet.inventory[itemId] || 0) + qty;
    saveWallet();
    return { ok: true, chest: Object.assign({}, wallet.motel.chest) };
  }
  function isFaintedState() { return !!(state && state.isFainted); }

  function buy(itemId, qty) {
    qty = Math.max(1, Math.min(99, qty | 0 || 1));
    var item = ITEMS[itemId];
    if (!item) return { ok: false, error: 'ITEM_NOT_FOUND' };
    // M3 (§3.2.3): a fainted player cannot move, work or buy/sell.
    if (isFaintedState()) return { ok: false, error: 'FAINTED' };
    if (isOnlineNet() && typeof NetClient.sendEconomy === 'function') {
      if (!nearShop()) return { ok: false, error: 'TOO_FAR' };
      NetClient.sendEconomy('shop_buy', { item_id: itemId, qty: qty });
      return { ok: true, pending: true };
    }
    var requestId = uuid();
    if (wallet.processed.indexOf(requestId) !== -1) return { ok: false, error: 'ALREADY_PROCESSED' };
    var total = priceOf(item) * qty;
    if (wallet.cash < total) return { ok: false, error: 'INSUFFICIENT_FUNDS', need: total, cash: wallet.cash };
    if (mode === 'supabase' && sb) {
      // Async path: the caller uses buyAsync instead; this sync path is
      // local-only by design (see buyAsync below).
      return { ok: false, error: 'USE_ASYNC' };
    }
    wallet.processed.push(requestId);
    wallet.cash -= total;
    wallet.inventory[itemId] = (wallet.inventory[itemId] || 0) + qty;
    logTx('shop_buy', -total, { item_id: itemId, qty: qty, unit_price: priceOf(item), request_id: requestId });
    saveWallet(); applyToState();
    return { ok: true, cash: wallet.cash, qty: wallet.inventory[itemId], total: total, request_id: requestId };
  }

  function buyAsync(itemId, qty) {
    if (mode !== 'supabase' || !sb) return Promise.resolve(buy(itemId, qty));
    var item = ITEMS[itemId];
    if (!item) return Promise.resolve({ ok: false, error: 'ITEM_NOT_FOUND' });
    var requestId = uuid();
    return sb.rpc('rpc_shop_buy', {
      p_user_id: window.DTA_USER_ID || null,
      p_item_id: itemId, p_qty: qty, p_idempotency_key: requestId,
      p_is_day: isDay()
    }).then(function (res) {
      if (res.error) { console.warn('[economy] rpc_shop_buy failed, local fallback:', res.error); return buy(itemId, qty); }
      var d = res.data;
      // No Auth yet (window.DTA_USER_ID unset) -> RPC refuses; fall back to
      // local wallet so the game still plays (README §4/§5).
      if (d && (d.error === 'AUTH_REQUIRED' || d.error === 'FORBIDDEN')) return buy(itemId, qty);
      if (!d || !d.ok) return { ok: false, error: (d && d.error) || 'RPC_FAILED' };
      if (typeof d.cash === 'number') wallet.cash = d.cash;
      if (typeof d.bank === 'number') wallet.bank = d.bank;
      wallet.inventory[itemId] = (wallet.inventory[itemId] || 0) + qty;
      saveWallet(); applyToState();
      return { ok: true, cash: wallet.cash, qty: wallet.inventory[itemId] };
    }).catch(function (err) {
      console.warn('[economy] rpc error, local fallback:', err);
      return buy(itemId, qty);
    });
  }

  function useItem(itemId) {
    var item = ITEMS[itemId];
    if (!item) return { ok: false, error: 'ITEM_NOT_FOUND' };
    if (isFaintedState()) return { ok: false, error: 'FAINTED' };
    if (isOnlineNet() && typeof NetClient.sendEconomy === 'function') {
      NetClient.sendEconomy('use_item', { item_id: itemId });
      return { ok: true, pending: true };
    }
    if ((wallet.inventory[itemId] || 0) < 1) return { ok: false, error: 'NO_ITEM' };
    if (!state) return { ok: false, error: 'NO_STATE' };
    wallet.inventory[itemId] -= 1;
    if (item.hunger) state.hunger = Math.min(100, state.hunger + item.hunger);
    if (item.stamina) state.stamina = Math.min(100, state.stamina + item.stamina);
    logTx('use_item', 0, { item_id: itemId });
    saveWallet();
    return { ok: true, hunger: state.hunger, stamina: state.stamina, left: wallet.inventory[itemId] };
  }

  function atm(action, amount) {
    amount = Math.floor(amount);
    if (isFaintedState()) return { ok: false, error: 'FAINTED' };
    if (action !== 'deposit' && action !== 'withdraw') return { ok: false, error: 'BAD_ACTION' };
    if (!isFinite(amount) || amount < ATM_MIN || amount > ATM_MAX) {
      return { ok: false, error: 'AMOUNT_RANGE', min: ATM_MIN, max: ATM_MAX };
    }
    if (isOnlineNet() && typeof NetClient.sendEconomy === 'function') {
      if (!nearBank()) return { ok: false, error: 'TOO_FAR' };
      NetClient.sendEconomy('atm_transfer', { action: action, amount: amount });
      return { ok: true, pending: true };
    }
    if (wallet.atmDay.date !== todayStr()) wallet.atmDay = { date: todayStr(), total: 0 };
    if (wallet.atmDay.total + amount > ATM_DAY_MAX) {
      return { ok: false, error: 'DAILY_LIMIT', dayMax: ATM_DAY_MAX, used: wallet.atmDay.total };
    }
    var requestId = uuid();
    if (action === 'deposit') {
      if (wallet.cash < amount) return { ok: false, error: 'INSUFFICIENT_FUNDS' };
      wallet.cash -= amount; wallet.bank += amount;
    } else if (action === 'withdraw') {
      if (wallet.bank < amount) return { ok: false, error: 'INSUFFICIENT_FUNDS' };
      wallet.bank -= amount; wallet.cash += amount;
    } else return { ok: false, error: 'BAD_ACTION' };
    wallet.processed.push(requestId);
    wallet.atmDay.total += amount;
    logTx('atm', action === 'deposit' ? -amount : amount, { action: action, request_id: requestId });
    saveWallet(); applyToState();
    return { ok: true, cash: wallet.cash, bank: wallet.bank, dayUsed: wallet.atmDay.total };
  }

  function nearShop() {
    if (!state) return false;
    return Math.hypot(state.x - SHOP_POS.x, state.y - SHOP_POS.y) <= SHOP_RANGE;
  }
  function nearBank() {
    if (!state) return false;
    return Math.hypot(state.x - BANK_POS.x, state.y - BANK_POS.y) <= SHOP_RANGE;
  }
  function nearShowroom() {
    if (!state) return false;
    return Math.hypot(state.x - SHOWROOM_POS.x, state.y - SHOWROOM_POS.y) <= SHOP_RANGE;
  }
  function nearMotel() {
    if (!state) return false;
    return Math.hypot(state.x - MOTEL_POS.x, state.y - MOTEL_POS.y) <= SHOP_RANGE;
  }

  // ---- DOM panels (Hybrid UI: money input is DOM, shop list is DOM too) ----
  var shopEl = null, atmEl = null, shopMsg = null, atmMsg = null;

  function el(id) { return document.getElementById(id); }
  function showMsg(node, text, isErr) {
    if (!node) return;
    node.textContent = text;
    node.style.color = isErr ? '#ff9a9a' : '#a5e08a';
  }
  function displayCash() { return (isOnlineNet() && state) ? (state.cash || 0) : wallet.cash; }
  function displayBank() { return (isOnlineNet() && state) ? (state.bank || 0) : wallet.bank; }
  function displayInv(id) { return (isOnlineNet() ? onlineInventory[id] : wallet.inventory[id]) || 0; }
  function displayAtmUsed() {
    if (isOnlineNet()) return onlineAtmDayUsed;
    if (wallet.atmDay.date !== todayStr()) return 0;
    return wallet.atmDay.total;
  }
  function errText(res) {
    switch (res.error) {
      case 'INSUFFICIENT_FUNDS': return 'Không đủ tiền! Cần ' + fmt(res.need || 0) + ', bạn có ' + fmt(displayCash()) + ' mặt + ' + fmt(displayBank()) + ' ngân hàng.';
      case 'ALREADY_PROCESSED': return 'Giao dịch này đã xử lý rồi (chống trùng).';
      case 'AMOUNT_RANGE': return 'Số tiền phải từ ' + fmt(ATM_MIN) + ' tới ' + fmt(ATM_MAX) + ' / lần.';
      case 'DAILY_LIMIT': return 'Đã dùng ' + fmt(res.used || 0) + ' hôm nay, tối đa ' + fmt(ATM_DAY_MAX) + '/ngày.';
      case 'NO_ITEM': return 'Bạn không có vật phẩm này.';
      case 'ITEM_NOT_FOUND': return 'Không có mặt hàng này.';
      case 'FAINTED': return 'Bạn đang ngất, không mua bán / dùng đồ được. Về Bệnh viện hoặc chờ bác sĩ cứu!';
      case 'TOO_FAR': return 'Bạn đang ở xa quá — tới gần điểm cần tới trên bản đồ rồi thử lại.';
      case 'ALREADY_OWNED': return 'Bạn đã có xe này rồi.';
      case 'NO_VEHICLE': return 'Bạn chưa có xe này — mua ở Showroom trước.';
      case 'ALREADY_RIDING': return 'Bạn đang đi xe rồi — xuống xe trước đã.';
      case 'NOT_RIDING': return 'Bạn không đi xe.';
      case 'ALREADY_FULL': return 'Đã đầy rồi, không cần nạp/sửa thêm.';
      case 'ALREADY_RENTED': return 'Bạn đang thuê phòng rồi (hết hạn ' + new Date(res.expiresAt).toLocaleString('vi-VN') + '). Gia hạn thay vì thuê mới.';
      case 'NO_ROOM': return 'Bạn chưa thuê phòng nào.';
      case 'RENEW_LIMIT': return 'Chỉ được gia hạn trước tối đa 7 ngày.';
      case 'CHEST_LOCKED': return res.state === 'held' ? 'Phòng đã hết hạn — rương bị khóa. Gia hạn phòng để lấy lại đồ (giữ 24h rồi xóa).' : 'Bạn chưa thuê phòng nên không có rương.';
      case 'CHEST_FULL': return 'Rương đã đầy 10 ô.';
      case 'RATE_LIMITED': return 'Thao tác quá nhanh (tối đa 5 lần/phút) — chờ một chút rồi thử lại.';
      default: return 'Lỗi: ' + (res.error || 'không rõ');
    }
  }

  function renderShop() {
    if (!shopEl) return;
    var list = el('shopList');
    if (!list) return;
    // BUG FIX (M2 browser test): the buy/use buttons stay usable only near
    // the shop — but the PANEL itself must open from anywhere (see
    // openShopPanel). When far, disable the buttons and say so in-panel
    // instead of silently refusing to open (the old proximity gate).
    var farFromShop = !nearShop();
    var online = isOnlineNet();
    list.innerHTML = '';
    Object.keys(ITEMS).forEach(function (id) {
      var item = ITEMS[id];
      var row = document.createElement('div');
      row.className = 'shopRow';
      var have = displayInv(id);
      row.innerHTML = '<div class="shopName">' + item.name + ' <span class="shopDesc">' + item.desc + '</span></div>' +
        '<div class="shopPrice">' + fmt(priceOf(item)) + (isDay() && item.dayPrice ? ' <span class="shopSale">giá ngày</span>' : '') + '</div>' +
        '<div class="shopHave">Có: ' + have + '</div>';
      var buyBtn = document.createElement('button');
      buyBtn.className = 'shopBtn'; buyBtn.textContent = 'Mua';
      buyBtn.disabled = farFromShop; // must be near the shop to buy (SRS)
      buyBtn.addEventListener('click', function () {
        buyBtn.disabled = true; // double-click guard (idempotency, SRS §4.3)
        var done = function (res) {
          buyBtn.disabled = false;
          if (res.pending) { showMsg(shopMsg, 'Đang gửi yêu cầu mua ' + item.name + '…'); return; }
          if (res.ok) showMsg(shopMsg, 'Đã mua ' + item.name + ' (' + fmt(res.total || priceOf(item)) + '). Còn ' + fmt(displayCash()) + '.');
          else showMsg(shopMsg, errText(res), true);
          renderShop(); renderAtm();
        };
        if (!online && mode === 'supabase' && sb) buyAsync(id, 1).then(done);
        else done(buy(id, 1));
      });
      row.appendChild(buyBtn);
      if (have > 0) {
        var useBtn = document.createElement('button');
        useBtn.className = 'shopBtn useBtn'; useBtn.textContent = 'Dùng';
        useBtn.disabled = farFromShop;
        useBtn.addEventListener('click', function () {
          var res = useItem(id);
          if (res.pending) { showMsg(shopMsg, 'Đang dùng ' + item.name + '…'); return; }
          if (res.ok) showMsg(shopMsg, 'Đã dùng ' + item.name + '! Độ no ' + Math.floor(state.hunger) + ', Thể lực ' + Math.floor(state.stamina) + '.');
          else showMsg(shopMsg, errText(res), true);
          renderShop();
        });
        row.appendChild(useBtn);
      }
      list.appendChild(row);
    });
    var walletLine = el('shopWallet');
    var modeLabel = online ? 'Online (server)' : (mode === 'local' ? 'Chế độ local' : 'Supabase');
    if (walletLine) walletLine.textContent = 'Tiền mặt: ' + fmt(displayCash()) + '  •  Ngân hàng: ' + fmt(displayBank()) + '  •  ' + modeLabel;
    // Only overwrite the message when far (never wipe a buy-success message
    // — renderShop is called right after a successful buy).
    if (farFromShop) showMsg(shopMsg, 'Bạn đang ở xa Cửa Hàng Tiện Lợi — tới gần điểm cam trên bản đồ để mua / dùng đồ.');
    renderVehicles();
  }

  // M4: Showroom section inside the shop panel — buy / mount / refuel /
  // repair. Buying needs proximity to the Showroom (300 px); mounting
  // needs the player within 80 px of where the vehicle is parked.
  var motelEl = null, motelMsg = null;
  function renderVehicles() {
    var list = el('vehicleList');
    if (!list) return;
    list.innerHTML = '';
    var farFromShowroom = !nearShowroom();
    var online = isOnlineNet();
    var vs = (online && onlineVehiclesState) ? onlineVehiclesState : getVehicleState();
    var curRiding = online ? ((state && state.vehicleId) || vs.riding || '') : riding;
    Object.keys(VEHICLES).forEach(function (id) {
      var spec = VEHICLES[id];
      var v = vs[id] || { owned: false };
      var owned = !!v.owned;
      var fuelVal = (online && curRiding === id && state && typeof state.fuel === 'number') ? state.fuel : (v.fuel === undefined ? 100 : v.fuel);
      var durVal = (online && curRiding === id && state && typeof state.durability === 'number') ? state.durability : (v.durability === undefined ? 100 : v.durability);
      var row = document.createElement('div');
      row.className = 'shopRow';
      var status = owned
        ? (curRiding === id ? 'Đang đi • ' : 'Đang đỗ • ') +
          (id === 'motorbike' ? 'Xăng ' + Math.floor(fuelVal) + '%' : 'Độ bền ' + Math.floor(durVal) + '%')
        : 'Chưa có';
      row.innerHTML = '<div class="shopName">' + spec.name + ' <span class="shopDesc">' + spec.desc + '</span></div>' +
        '<div class="shopPrice">' + fmt(spec.price) + '</div>' +
        '<div class="shopHave">' + status + '</div>';
      if (!owned) {
        var buyBtn = document.createElement('button');
        buyBtn.className = 'shopBtn'; buyBtn.textContent = 'Mua';
        buyBtn.disabled = farFromShowroom;
        buyBtn.addEventListener('click', function () {
          var res = buyVehicle(id);
          if (res.pending) { showMsg(shopMsg, 'Đang gửi yêu cầu mua ' + spec.name + '…'); return; }
          if (res.ok) showMsg(shopMsg, 'Đã mua ' + spec.name + ' (' + fmt(spec.price) + '). Xe đang đỗ ở Showroom — tới gần rồi bấm Lên xe (phím E).');
          else showMsg(shopMsg, errText(res), true);
          renderShop(); renderAtm();
        });
        row.appendChild(buyBtn);
      } else {
        if (curRiding === id) {
          var offBtn = document.createElement('button');
          offBtn.className = 'shopBtn useBtn'; offBtn.textContent = 'Xuống xe';
          offBtn.addEventListener('click', function () {
            if (online && typeof NetClient.sendVehicle === 'function') {
              NetClient.sendVehicle('dismount', {});
              showMsg(shopMsg, 'Đang xuống xe…');
              return;
            }
            dismountVehicle();
            showMsg(shopMsg, 'Đã xuống xe — xe đỗ tại chỗ này.');
            renderShop();
          });
          row.appendChild(offBtn);
        } else {
          var onBtn = document.createElement('button');
          onBtn.className = 'shopBtn'; onBtn.textContent = 'Lên xe';
          onBtn.addEventListener('click', function () {
            if (online && typeof NetClient.sendVehicle === 'function') {
              NetClient.sendVehicle('mount', { vehicleId: id });
              showMsg(shopMsg, 'Đang lên ' + spec.name + '…');
              return;
            }
            var res = mountVehicle(id);
            if (res.ok) showMsg(shopMsg, 'Đã lên ' + spec.name + ' — tốc độ ' + spec.speed + ' px/s.');
            else showMsg(shopMsg, errText(res), true);
            renderShop();
          });
          row.appendChild(onBtn);
        }
        if (id === 'motorbike' && fuelVal < 100) {
          var fuelBtn = document.createElement('button');
          fuelBtn.className = 'shopBtn'; fuelBtn.textContent = 'Đổ xăng 5.000đ';
          fuelBtn.disabled = !nearShop();
          fuelBtn.addEventListener('click', function () {
            var res = refuel();
            if (res.pending) { showMsg(shopMsg, 'Đang đổ xăng…'); return; }
            if (res.ok) showMsg(shopMsg, 'Đã đổ đầy bình xăng (đi được 8.000 px).');
            else showMsg(shopMsg, errText(res), true);
            renderShop(); renderAtm();
          });
          row.appendChild(fuelBtn);
        }
        if (id === 'bicycle' && durVal < 100) {
          var repBtn = document.createElement('button');
          repBtn.className = 'shopBtn'; repBtn.textContent = 'Sửa xe 10.000đ';
          repBtn.disabled = !nearShop();
          repBtn.addEventListener('click', function () {
            var res = repairBike();
            if (res.pending) { showMsg(shopMsg, 'Đang sửa xe…'); return; }
            if (res.ok) showMsg(shopMsg, 'Đã sửa xe đạp — độ bền 100%.');
            else showMsg(shopMsg, errText(res), true);
            renderShop(); renderAtm();
          });
          row.appendChild(repBtn);
        }
      }
      list.appendChild(row);
    });
    var note = el('vehicleNote');
    if (note) note.textContent = farFromShowroom
      ? 'Mua xe cần tới gần Showroom Xe Máy (điểm tím phía Tây Nam). Đổ xăng / sửa xe cần tới gần Cửa Hàng.'
      : 'Bạn đang ở Showroom — mua xe tại đây, xe đỗ ở đây.';
  }

  // M4: motel panel (rent / renew / chest). Same econPanel style as shop.
  // Online the motel lives in SERVER state, not the local wallet: main.js
  // feeds server status here via setOnlineMotelStatus(), and rent/renew/
  // chest actions forward to the server (NetClient.sendMotel) instead of
  // touching the local wallet. Offline everything uses the local wallet.
  var onlineMotel = null; // {expiresAt, chestState, chest} | null
  function isOnlineNet() {
    try {
      return typeof NetClient !== 'undefined' && NetClient && NetClient.connected
        && typeof NetClient.sendMotel === 'function';
    } catch (e) { return false; }
  }
  function setOnlineMotelStatus(s) {
    if (!s) { onlineMotel = null; return; }
    onlineMotel = Object.assign({}, onlineMotel || {}, s);
    if (motelEl && motelEl.classList.contains('open')) renderMotel();
  }
  function renderMotel() {
    if (!motelEl) return;
    // Online: display the SERVER motel state (main.js feeds it via
    // setOnlineMotelStatus); offline: the local wallet state.
    var st = onlineMotel
      ? { expiresAt: onlineMotel.expiresAt || 0, chestState: onlineMotel.chestState || (onlineMotel.expiresAt ? 'active' : 'none'), chest: onlineMotel.chest || {} }
      : motelStatus();
    var line = el('motelWallet');
    if (line) line.textContent = 'Tiền mặt: ' + fmt(displayCash()) + '  •  Ngân hàng: ' + fmt(displayBank());
    var info = el('motelInfo');
    if (info) {
      if (st.chestState === 'active') {
        info.textContent = 'Đang thuê phòng — hết hạn ' + new Date(st.expiresAt).toLocaleString('vi-VN') + '. Điểm hồi sinh của bạn là phòng trọ. Rương: 10 ô.';
      } else if (st.chestState === 'held') {
        info.textContent = 'Phòng đã hết hạn — rương BỊ KHÓA (đồ giữ 24h rồi xóa). Gia hạn ngay để lấy lại đồ.';
      } else if (st.chestState === 'deleted') {
        info.textContent = 'Phòng đã hết hạn quá 24h — đồ trong rương đã bị xóa.';
      } else {
        info.textContent = 'Chưa thuê phòng. Thuê 50.000đ / 24h thực — có rương 10 ô + điểm hồi sinh riêng.';
      }
    }
    var rentBtn = el('motelRent'), renewBtn = el('motelRenew');
    var far = !nearMotel();
    if (rentBtn) rentBtn.disabled = far || st.chestState === 'active';
    if (renewBtn) renewBtn.disabled = far || !st.expiresAt;
    if (far) showMsg(motelMsg, 'Bạn đang ở xa Khu Nhà Trọ — tới gần để thuê / gia hạn phòng.');
    var chestEl = el('motelChest');
    if (chestEl) {
      chestEl.innerHTML = '';
      var keys = Object.keys(st.chest);
      if (!keys.length) chestEl.textContent = 'Rương trống.';
      keys.forEach(function (itemId) {
        var item = ITEMS[itemId];
        if (!item) return;
        var row = document.createElement('div');
        row.className = 'shopRow';
        row.innerHTML = '<div class="shopName">' + item.name + '</div><div class="shopHave">Trong rương: ' + st.chest[itemId] + ' • Túi: ' + displayInv(itemId) + '</div>';
        var putBtn = document.createElement('button');
        putBtn.className = 'shopBtn'; putBtn.textContent = 'Cất 1';
        putBtn.disabled = st.chestState !== 'active';
        putBtn.addEventListener('click', function () {
          var res = chestPut(itemId, 1);
          if (!res.ok) showMsg(motelMsg, errText(res), true);
          renderMotel(); renderShop();
        });
        var takeBtn = document.createElement('button');
        takeBtn.className = 'shopBtn useBtn'; takeBtn.textContent = 'Lấy 1';
        takeBtn.disabled = st.chestState !== 'active';
        takeBtn.addEventListener('click', function () {
          var res = chestTake(itemId, 1);
          if (!res.ok) showMsg(motelMsg, errText(res), true);
          renderMotel(); renderShop();
        });
        row.appendChild(putBtn); row.appendChild(takeBtn);
        chestEl.appendChild(row);
      });
      // Online: the server validates the inventory, so offer "Cất 1" for
      // shop items not yet in the chest too (server answers NO_ITEM when
      // the player has none). Offline the counts above already cover it.
      if (onlineMotel) {
        Object.keys(ITEMS).forEach(function (itemId) {
          if (st.chest[itemId]) return;
          var item = ITEMS[itemId];
          var row = document.createElement('div');
          row.className = 'shopRow';
          row.innerHTML = '<div class="shopName">' + item.name + '</div><div class="shopHave">Trong rương: 0</div>';
          var putBtn = document.createElement('button');
          putBtn.className = 'shopBtn'; putBtn.textContent = 'Cất 1';
          putBtn.disabled = st.chestState !== 'active';
          putBtn.addEventListener('click', function () {
            var res = chestPut(itemId, 1);
            if (!res.ok) showMsg(motelMsg, errText(res), true);
            renderMotel(); renderShop();
          });
          row.appendChild(putBtn);
          chestEl.appendChild(row);
        });
      }
    }
  }
  function openMotelPanel() {
    if (motelEl && motelEl.classList.contains('open')) { closePanels(); return; }
    renderMotel();
    if (motelEl) motelEl.classList.add('open');
    if (shopEl) shopEl.classList.remove('open');
    if (atmEl) atmEl.classList.remove('open');
  }

  function renderAtm() {
    if (!atmEl) return;
    var line = el('atmWallet');
    if (line) line.textContent = 'Tiền mặt: ' + fmt(displayCash()) + '  •  Ngân hàng: ' + fmt(displayBank()) + '  •  Đã giao dịch hôm nay: ' + fmt(displayAtmUsed()) + ' / ' + fmt(ATM_DAY_MAX);
    // BUG FIX (M2 browser test): same as shop — panel opens from anywhere,
    // but Gửi/Rút are disabled until the player is near the bank.
    var farFromBank = !nearBank();
    var depBtn = el('atmDeposit'), wdBtn = el('atmWithdraw');
    if (depBtn) depBtn.disabled = farFromBank;
    if (wdBtn) wdBtn.disabled = farFromBank;
    if (farFromBank) showMsg(atmMsg, 'Bạn đang ở xa Ngân Hàng — tới gần để gửi / rút tiền.');
  }

  function openShopPanel() {
    // BUG FIX (M2 browser test) — ROOT CAUSE: this used to return early with
    // only an alert() when the player was not within 300px of the shop.
    // Spawn (2400,2625) is ~1147px from the shop (2895,1590), so every SHOP
    // click from spawn did nothing visible (the alert is suppressed / missed
    // in a live browser test) while CHAT, which has no gate, worked fine.
    // The handler itself was wired correctly (wirePanels) and the button was
    // on top (z-index 6) — the gate was the bug, not the wiring.
    // Fix: SHOP toggles the panel open/closed reliably, exactly like CHAT.
    // The proximity rule is preserved where it belongs: Mua/Dùng buttons are
    // disabled in renderShop() until the player is near the shop.
    console.log('[economy] openShopPanel, nearShop=', nearShop());
    if (shopEl && shopEl.classList.contains('open')) { closePanels(); return; }
    renderShop();
    if (shopEl) shopEl.classList.add('open');
    if (atmEl) atmEl.classList.remove('open');
  }
  function openAtmPanel() {
    // Same fix as openShopPanel: toggle reliably from anywhere; Gửi/Rút are
    // disabled in renderAtm() until the player is near the bank (1650,1590).
    console.log('[economy] openAtmPanel, nearBank=', nearBank());
    if (atmEl && atmEl.classList.contains('open')) { closePanels(); return; }
    renderAtm();
    if (atmEl) atmEl.classList.add('open');
    if (shopEl) shopEl.classList.remove('open');
  }
  function closePanels() {
    if (shopEl) shopEl.classList.remove('open');
    if (atmEl) atmEl.classList.remove('open');
    if (motelEl) motelEl.classList.remove('open');
  }

  function wirePanels() {
    shopEl = el('shopPanel'); atmEl = el('atmPanel');
    shopMsg = el('shopMsg'); atmMsg = el('atmMsg');
    motelEl = el('motelPanel'); motelMsg = el('motelMsg');
    var motelClose = el('motelClose');
    if (motelClose) motelClose.addEventListener('click', closePanels);
    var rentBtn = el('motelRent'), renewBtn = el('motelRenew');
    if (rentBtn) rentBtn.addEventListener('click', function () {
      var res = motelRent();
      if (res.pending) { showMsg(motelMsg, 'Đã gửi yêu cầu thuê phòng lên máy chủ…'); return; }
      if (res.ok) showMsg(motelMsg, 'Đã thuê phòng trọ 50.000đ / 24h — hết hạn ' + new Date(res.expiresAt).toLocaleString('vi-VN') + '.');
      else showMsg(motelMsg, errText(res), true);
      renderMotel(); renderShop();
    });
    if (renewBtn) renewBtn.addEventListener('click', function () {
      var res = motelRenew();
      if (res.pending) { showMsg(motelMsg, 'Đã gửi yêu cầu gia hạn lên máy chủ…'); return; }
      if (res.ok) showMsg(motelMsg, 'Đã gia hạn phòng — hết hạn mới ' + new Date(res.expiresAt).toLocaleString('vi-VN') + '.');
      else showMsg(motelMsg, errText(res), true);
      renderMotel(); renderShop();
    });
    var shopClose = el('shopClose'), atmClose = el('atmClose');
    if (shopClose) shopClose.addEventListener('click', closePanels);
    if (atmClose) atmClose.addEventListener('click', closePanels);
    var shopBtn = el('shopBtn');
    if (shopBtn) shopBtn.addEventListener('click', function () {
      console.log('[economy] SHOP button clicked');
      openShopPanel();
    });
    // BUG FIX (M2 browser test): there was no ATM button on screen at all.
    // Standalone ATM button (same 56px round style as SHOP/CHAT) + a clear
    // "ATM — Gửi / Rút tiền" button inside the Shop panel.
    var atmBtn = el('atmBtn');
    if (atmBtn) atmBtn.addEventListener('click', function () {
      console.log('[economy] ATM button clicked');
      openAtmPanel();
    });
    var shopAtmBtn = el('shopAtmBtn');
    if (shopAtmBtn) shopAtmBtn.addEventListener('click', function () {
      console.log('[economy] Shop-panel ATM button clicked');
      openAtmPanel();
    });
    var amt = el('atmAmount');
    var dep = el('atmDeposit'), wd = el('atmWithdraw');
    function doAtm(action) {
      var amount = amt ? parseInt(amt.value, 10) : NaN;
      var res = atm(action, amount);
      if (res.pending) { showMsg(atmMsg, 'Đang gửi yêu cầu ' + (action === 'deposit' ? 'gửi ' : 'rút ') + fmt(amount) + '…'); return; }
      if (res.ok) {
        showMsg(atmMsg, (action === 'deposit' ? 'Đã gửi ' : 'Đã rút ') + fmt(amount) + '.');
        renderAtm(); renderShop();
      } else showMsg(atmMsg, errText(res), true);
    }
    if (dep) dep.addEventListener('click', function () { doAtm('deposit'); });
    if (wd) wd.addEventListener('click', function () { doAtm('withdraw'); });
  }

  // ---- public API ----
  window.Economy = {
    ITEMS: ITEMS, VEHICLES: VEHICLES,
    init: function (playerState, clock) {
      state = playerState; clockFn = clock || null;
      wallet = loadWallet();
      trySupabase();
      var g = starterGrant();
      if (g.ok) console.log('[economy] starter grant +80.000đ (once, local mode)');
      applyToState();
      wirePanels();
      return { mode: mode, granted: wallet.granted };
    },
    buy: buy, buyAsync: buyAsync, useItem: useItem, atm: atm,
    starterGrant: starterGrant, nearShop: nearShop, nearBank: nearBank,
    nearShowroom: nearShowroom, nearMotel: nearMotel,
    faintLoss: faintLoss, hospitalFee: hospitalFee, grant: grant,
    // M4 vehicles + motel (offline)
    buyVehicle: buyVehicle, mountVehicle: mountVehicle, dismountVehicle: dismountVehicle,
    refuel: refuel, repairBike: repairBike, rideDistance: rideDistance,
    ridingSpeed: ridingSpeed, getVehicleState: getVehicleState,
    getRiding: function () { return riding; },
    motelRent: motelRent, motelRenew: motelRenew, motelStatus: motelStatus,
    chestPut: chestPut, chestTake: chestTake,
    setOnlineMotelStatus: setOnlineMotelStatus,
    setOnlineInventory: function (inv) { onlineInventory = inv ? Object.assign({}, inv) : {}; },
    setOnlineAtmDayUsed: function (n) { onlineAtmDayUsed = n || 0; },
    setOnlineVehicles: function (vs) { onlineVehiclesState = vs || null; },
    showOnlineFeedback: function (target, msg, isErr) {
      var node = target === 'atm' ? atmMsg : (target === 'motel' ? motelMsg : shopMsg);
      if (node) showMsg(node, msg, isErr);
    },
    errText: errText,
    getWallet: function () { return wallet; },
    getMode: function () { return mode; },
    priceOf: priceOf, isDay: isDay,
    renderShop: renderShop, renderAtm: renderAtm, renderMotel: renderMotel,
    openShopPanel: openShopPanel, openAtmPanel: openAtmPanel,
    openMotelPanel: openMotelPanel, closePanels: closePanels
  };
  window.openShopPanel = openShopPanel;
  window.openAtmPanel = openAtmPanel;
  window.openMotelPanel = openMotelPanel;
})();
