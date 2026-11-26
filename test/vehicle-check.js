/* Cuộc Sống Ảo — test/vehicle-check.js (vehicles fix 2026-11-25)
   The user reported "lên xe hình như ko có tác dụng" (mounting seems to do
   nothing) and asked whether the bike/motorbike were even drawn yet.
   Findings locked in by this check:
   - the bicycle had NO image at all; the motorbike existed only as a
     decorative prop (5 static bikes at the showroom) — neither was ever
     drawn as the player's vehicle, and no sprite showed under the player
     while riding (speed DID change: 234/324 px/s, invisibly).
   This check verifies the fix end to end, headless (no browser, no PIXI):
   1. the PNGs exist, sane aspect, keyed out clean (no magenta left);
   2. shared/m3.js speeds: bicycle 234, motorbike 324, on foot 180;
   3. the OFFLINE economy flow, simulated for real by loading
      src/economy.js in Node with stubbed window/document/localStorage:
      fresh wallet -> 80.000đ grant -> buy bicycle (250k, parked at the
      showroom lot) -> mount within 80px -> speed 234 -> dismount parks
      the bike where the player stands -> mount from far away fails
      TOO_FAR; same for the motorbike (1M, speed 324);
   4. the wiring in src/main.js + index.html: ride sprite under the
      player, parked-vehicle sprites, radial "Lên xe", HUD indicator,
      LÊN XE / XUỐNG XE button.
   Run: node test/vehicle-check.js   (exit 0 = all PASS) */
'use strict';

var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var M3 = require(path.join(ROOT, 'shared/m3.js'));

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
var mainSrc = read('src/main.js');
var htmlSrc = read('index.html');

// ---- 1. the images -----------------------------------------------------------
var bikeDims = pngDims('assets/v3/prop-bicycle-full.png');
var motoDims = pngDims('assets/v3/prop-motorbike-full.png');
check('bicycle image exists (was missing entirely)', !!bikeDims, bikeDims && bikeDims.w + 'x' + bikeDims.h);
check('motorbike image exists', !!motoDims, motoDims && motoDims.w + 'x' + motoDims.h);
check('bicycle aspect sane (wide, high-angle)', !!bikeDims && bikeDims.w / bikeDims.h > 1 && bikeDims.w / bikeDims.h < 2,
  bikeDims && (bikeDims.w / bikeDims.h).toFixed(2));
check('motorbike aspect sane (tall, top-down)', !!motoDims && motoDims.w / motoDims.h > 0.3 && motoDims.w / motoDims.h < 1,
  motoDims && (motoDims.w / motoDims.h).toFixed(2));
check('bicycle raw FLUX image kept', fs.existsSync(path.join(ROOT, 'assets/v3/raw/prop-bicycle.png')));
check('bicycle in the sprite pipeline (make_v3_sprites.py)',
  read('assets/v3/make_v3_sprites.py').indexOf('"prop-bicycle": (180, 220, 850, 740)') >= 0);

// ---- 2. shared rules ----------------------------------------------------------
check('M3.vehicleSpeed bicycle = 234', M3.vehicleSpeed('bicycle', 100, 100) === 234);
check('M3.vehicleSpeed motorbike = 324', M3.vehicleSpeed('motorbike', 100, 100) === 324);
check('M3.vehicleSpeed on foot = 180', M3.vehicleSpeed('', 100, 100) === 180);
check('M3.vehicleSpeed bicycle with 0 durability = 180 (push)',
  M3.vehicleSpeed('bicycle', 100, 0) === 180);
check('M3.vehicleSpeed motorbike with 0 fuel = 180 (push)',
  M3.vehicleSpeed('motorbike', 0, 100) === 180);

// ---- 3. offline economy flow, simulated --------------------------------------
// Stub the browser globals economy.js needs at load + init time.
function stubEl() {
  return {
    addEventListener: function () {}, classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
    style: {}, textContent: '', innerHTML: '', disabled: false, value: '', appendChild: function () {},
  };
}
var lsData = {};
global.localStorage = {
  getItem: function (k) { return lsData[k] === undefined ? null : lsData[k]; },
  setItem: function (k, v) { lsData[k] = String(v); },
  removeItem: function (k) { delete lsData[k]; },
};
global.window = {
  localStorage: global.localStorage, M3: M3,
  addEventListener: function () {},
  location: { search: '' },
};
global.document = {
  getElementById: function () { return stubEl(); },
  createElement: function () { return stubEl(); },
  querySelector: function () { return null; },
  addEventListener: function () {},
};
var econCode = read('src/economy.js');
eval(econCode); // defines window.Economy
var Economy = global.window.Economy;
check('economy.js loads in Node with stubs', !!Economy && typeof Economy.init === 'function');

// Fake player state: start at the Showroom, then walk to the parked bike.
var st = { x: 1640, y: 3280, cash: 0, bank: 0, isFainted: false, vehicleId: null, fuel: 100, durability: 100 };
var initRes = Economy.init(st, null);
check('fresh wallet gets the 80.000đ starter grant', st.cash === 80000, 'cash=' + st.cash);
check('no vehicle owned at first', !Economy.getVehicleState().bicycle.owned && !Economy.getVehicleState().motorbike.owned);

// Bicycle: 250.000đ — grant the rest (the 80k starter alone cannot buy it).
Economy.grant(200000, 'test');
var buyBike = Economy.buyVehicle('bicycle');
check('buy bicycle at the Showroom works', buyBike.ok, JSON.stringify(buyBike));
check('bicycle costs 250.000đ', st.cash === 30000, 'cash=' + st.cash);
var vs = Economy.getVehicleState();
check('bicycle parked on the showroom lot (1960,3380)',
  vs.bicycle.owned && vs.bicycle.x === 1960 && vs.bicycle.y === 3380,
  vs.bicycle.owned ? '(' + vs.bicycle.x + ',' + vs.bicycle.y + ')' : 'not owned');
// Too far to mount from the Showroom door.
var farMount = Economy.mountVehicle('bicycle');
check('mount from 335px away fails TOO_FAR', !farMount.ok && farMount.error === 'TOO_FAR',
  JSON.stringify(farMount));
// Walk to the parked bike and mount.
st.x = 1960; st.y = 3380;
var mountBike = Economy.mountVehicle('bicycle');
check('mount within 80px works', mountBike.ok, JSON.stringify(mountBike));
check('riding bicycle after mount', Economy.getRiding() === 'bicycle');
check('speed is 234 px/s while riding the bicycle', Economy.ridingSpeed() === 234);
check('vehicle state says riding bicycle', Economy.getVehicleState().riding === 'bicycle');
// Dismount parks the bike where the player stands.
st.x = 2000; st.y = 3000;
var disBike = Economy.dismountVehicle();
check('dismount works', disBike.ok, JSON.stringify(disBike));
check('not riding after dismount', Economy.getRiding() === '');
check('bicycle re-parked at the dismount spot (2000,3000)',
  Economy.getVehicleState().bicycle.x === 2000 && Economy.getVehicleState().bicycle.y === 3000);
// Walk back to the Showroom door — the bike is now 367px away.
st.x = 1640; st.y = 3280;
var mountFar = Economy.mountVehicle('bicycle');
check('mount from the old spot fails TOO_FAR (bike moved)',
  !mountFar.ok && mountFar.error === 'TOO_FAR');
// Walk to the new spot and mount again.
st.x = 2000; st.y = 3000;
check('mount at the new spot works', Economy.mountVehicle('bicycle').ok);
check('dismount again to reset', Economy.dismountVehicle().ok);

// Motorbike: 1.000.000đ.
Economy.grant(1000000, 'test');
st.x = 1640; st.y = 3280;
var buyMoto = Economy.buyVehicle('motorbike');
check('buy motorbike at the Showroom works', buyMoto.ok, JSON.stringify(buyMoto));
check('motorbike parked on the showroom lot (1960,3380)',
  Economy.getVehicleState().motorbike.x === 1960 && Economy.getVehicleState().motorbike.y === 3380);
st.x = 1960; st.y = 3380;
check('mount motorbike works', Economy.mountVehicle('motorbike').ok);
check('riding motorbike after mount', Economy.getRiding() === 'motorbike');
check('speed is 324 px/s while riding the motorbike', Economy.ridingSpeed() === 324);
check('dismount motorbike works', Economy.dismountVehicle().ok);
check('speed back to 180 on foot', Economy.ridingSpeed() === 180);

// ---- 4. wiring: the vehicle must be VISIBLE ----------------------------------
check('bicycle texture in ASSET_FILES', /bicycle: 'assets\/v3\/prop-bicycle-full\.png'/.test(mainSrc));
check('ride sprite created under the player', /rideSpr = new PIXI\.Sprite\(PIXI\.Texture\.EMPTY\);/.test(mainSrc));
check('ride sprite added as a child of the player container',
  /player\.addChildAt\(rideSpr, 1\);/.test(mainSrc));
check('syncRideSprite runs every ticker tick', /syncRideSprite\(\); \/\/ VEHICLES FIX/.test(mainSrc));
check('syncParkedVehicles runs every ticker tick', /syncParkedVehicles\(\); \/\/ VEHICLES FIX/.test(mainSrc));
check('parked vehicle nodes created in buildWorld', /parkedVehicleNodes\[id\] = \{ c: c, spr: spr \};/.test(mainSrc));
check('parked vehicles carry a "Xe … của bạn" label',
  /lbl = text\(id === 'motorbike' \? 'Xe máy của bạn' : 'Xe đạp của bạn'/.test(mainSrc));
check('parked vehicles are tap targets (nearestTarget)',
  /parkedVehicleTargets\(\)\.forEach\(function \(t\) \{/.test(mainSrc));
check('radial menu offers "Lên xe" for a parked vehicle',
  /if \(target\.kind === 'vehicle'\) \{\s*setRadialButton\(0, 'Lên xe', 'mount', 0x27ae60, true\);/.test(mainSrc));
check('radial "mount" action calls Jobs.mountNearest',
  /if \(action === 'mount'\) \{[\s\S]*?Jobs\.mountNearest\(\)/.test(mainSrc));
check('HUD riding indicator exists (rideT)', /hudRefs\.rideT = text\('', HUD_BIG \? 13 : 13, 0x7dff9e, true\);/.test(mainSrc));
check('HUD riding indicator shows the speed', /' • ' \+ spd \+ ' px\/s • E: xuống xe'/.test(mainSrc));
check('LÊN XE / XUỐNG XE button exists in index.html', /<button id="rideBtn" type="button">LÊN XE<\/button>/.test(htmlSrc));
check('ride button wired to mount/dismount', /getElementById\('rideBtn'\)/.test(mainSrc) &&
  /if \(currentRidingId\(\)\) Jobs\.dismountCurrent\(\);/.test(mainSrc) &&
  /else Jobs\.mountNearest\(\);/.test(mainSrc));
check('ride button shows only near a parked bike or while riding',
  /function updateRideButton\(\)/.test(mainSrc) &&
  /parkedVehicleTargets\(\)\.some\(function \(t\) \{/.test(mainSrc));
check('E key still mounts/dismounts', /if \(playerState\.vehicleId\) Jobs\.dismountCurrent\(\);/.test(mainSrc));
check('online: vehicle status requested on join (returning players)',
  /ask for the owned-vehicle status too/.test(mainSrc) &&
  (mainSrc.match(/NetClient\.sendVehicle\('status', \{\}\)/g) || []).length >= 2);

// ---- summary ----------------------------------------------------------------
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
