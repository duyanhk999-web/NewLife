/* Đô Thị Ảo — server/schema.js
   Colyseus state schema (SRS §12.1) via @colyseus/schema v2 (defineTypes).
   PlayerState / NpcState field lists are exactly as specified in the M1 task,
   plus `avatar` on both (portrait key for the client). */
const { Schema, MapSchema, defineTypes } = require('@colyseus/schema');

class PlayerState extends Schema {}
defineTypes(PlayerState, {
  id: 'string',
  name: 'string',
  x: 'number',
  y: 'number',
  vx: 'number',
  vy: 'number',
  anim: 'string', // 'idle' | 'walk' | 'sprint' | 'fainted'
  job: 'string', // 'unemployed' | 'shipper' | 'taxi_driver' | 'doctor'
  hp: 'number',
  hunger: 'number',
  stamina: 'number',
  cash: 'number',
  bank: 'number',
  isFainted: 'boolean',
  vehicleId: 'string', // '' when not in a vehicle
  // M4 vehicles (§8.1): which vehicle is ridden ('bicycle' | 'motorbike'
  // | ''), fuel % (motorbike only, 100% = 8000 px) and durability %
  // (bicycle only, 100% = 50.000 px). 0 fuel / 0 durability = pushed.
  vehicleType: 'string',
  fuel: 'number',
  durability: 'number',
  // M4 taxi (§3.4.2): sessionId of the passenger aboard ('' = none).
  passengerId: 'string',
  // M4 motel (§8.2): ms epoch when the rented room expires (0 = no room).
  roomExpiresAt: 'number',
  // M3 Shipper (§6): active order mirrored in Colyseus state so the client
  // can draw the delivery arrow + countdown without a separate message.
  // 'none' when no order is active; deadline is a ms epoch.
  orderStatus: 'string', // 'none' | 'accepted'
  orderId: 'string',
  orderX: 'number',
  orderY: 'number',
  orderDeadline: 'number',
  orderReward: 'number',
  // Multi-shop Shipper (2026-11-25): where this order is picked up.
  orderPickupX: 'number',
  orderPickupY: 'number',
  orderPickupName: 'string',
  chatBubble: 'string',
  chatBubbleUntil: 'number', // ms epoch; bubble shows until then
  avatar: 'string', // 'shipper' | 'bread' | 'taxi' | 'police' | 'thug' | 'student' | 'hero' | ...
});

class NpcState extends Schema {}
defineTypes(NpcState, {
  id: 'string',
  type: 'string', // 'walker' | 'guide' | 'bot'
  name: 'string',
  x: 'number',
  y: 'number',
  targetX: 'number',
  targetY: 'number',
  avatar: 'string',
});

class CityRoomState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.npcs = new MapSchema();
    this.worldTime = 480; // 08:00, minutes 0..1440
    this.serverNow = 0;
  }
}
defineTypes(CityRoomState, {
  players: { map: PlayerState },
  npcs: { map: NpcState },
  worldTime: 'number',
  serverNow: 'float64', // ms epoch ('number' có thể mất chính xác)
});

module.exports = { PlayerState, NpcState, CityRoomState };
