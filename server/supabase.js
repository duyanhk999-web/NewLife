/* Cuộc Sống Ảo — server/supabase.js
   Server-side Supabase Admin client (M5). Uses SUPABASE_URL and
   SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY). Never leaks the
   secret key. Gracefully returns null/no-ops when env vars are unset so local
   dev and server/test/test.js continue to work in-memory. */
const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');
const wsTransport = typeof WebSocket !== 'undefined' ? WebSocket : require('ws');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const admin = (SUPABASE_URL && SECRET_KEY)
  ? createClient(SUPABASE_URL, SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: wsTransport },
    })
  : null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function ensureUuid(v) {
  return (typeof v === 'string' && UUID_RE.test(v)) ? v : randomUUID();
}

function isConfigured() {
  return !!admin;
}

function getPublicConfig() {
  return {
    supabaseUrl: SUPABASE_URL || null,
    supabasePublishableKey: PUBLISHABLE_KEY || null,
  };
}

async function checkHealth() {
  if (!admin) return { configured: false, ok: false, error: 'ENV_UNSET' };
  try {
    const { data, error } = await admin.from('game_items').select('item_id').limit(1);
    if (error) return { configured: true, ok: false, error: error.message };
    return { configured: true, ok: true, itemsCount: Array.isArray(data) ? data.length : 0 };
  } catch (err) {
    return { configured: true, ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function verifyToken(accessToken) {
  if (!admin) return { user: null, error: 'SUPABASE_NOT_CONFIGURED' };
  if (!accessToken || typeof accessToken !== 'string') return { user: null, error: 'MISSING_TOKEN' };
  try {
    const { data, error } = await admin.auth.getUser(accessToken);
    if (error || !data || !data.user) {
      return { user: null, error: (error && error.message) || 'INVALID_TOKEN' };
    }
    return { user: data.user, error: null };
  } catch (err) {
    return { user: null, error: err && err.message ? err.message : 'VERIFY_FAILED' };
  }
}

async function loadPlayerState(userId, fallbackName, fallbackAvatar) {
  if (!admin || !userId) return null;
  // Ensure profile exists (starter cash = 0, starter_grant still goes through _onStarterGrant).
  await admin.from('profiles').upsert({
    user_id: userId,
    display_name: fallbackName || 'CongDan',
    avatar_key: fallbackAvatar || 'hero',
  }, { onConflict: 'user_id', ignoreDuplicates: true });

  const todayIso = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const [profRes, invRes, assetRes, grantRes, atmRes] = await Promise.all([
    admin.from('profiles').select('*').eq('user_id', userId).single(),
    admin.from('inventory').select('item_id, qty').eq('user_id', userId),
    admin.from('assets').select('asset_id, qty, metadata').eq('user_id', userId),
    admin.from('transaction_logs').select('id').eq('user_id', userId).eq('type', 'starter_grant').limit(1),
    admin.from('transaction_logs').select('amount').eq('user_id', userId).eq('type', 'atm').gte('created_at', todayIso),
  ]);

  if (profRes.error || !profRes.data) {
    throw new Error((profRes.error && profRes.error.message) || 'PROFILE_LOAD_FAILED');
  }

  const inventory = new Map();
  if (invRes.data) {
    for (const row of invRes.data) {
      if (row.qty > 0) inventory.set(row.item_id, row.qty);
    }
  }

  const vehicles = { bicycle: null, motorbike: null };
  let motel = null;
  if (assetRes.data) {
    for (const row of assetRes.data) {
      const m = row.metadata || {};
      if (row.asset_id === 'vehicle_bicycle' && row.qty > 0) {
        vehicles.bicycle = {
          fuel: 100,
          durability: typeof m.durability === 'number' ? m.durability : 100,
          x: typeof m.x === 'number' ? m.x : 1665,
          y: typeof m.y === 'number' ? m.y : 3120,
        };
      } else if (row.asset_id === 'vehicle_motorbike' && row.qty > 0) {
        vehicles.motorbike = {
          fuel: typeof m.fuel === 'number' ? m.fuel : 100,
          durability: 100,
          x: typeof m.x === 'number' ? m.x : 1665,
          y: typeof m.y === 'number' ? m.y : 3120,
        };
      } else if (row.asset_id === 'room_motel_01' && row.qty > 0) {
        const chest = new Map();
        if (m.chest && typeof m.chest === 'object') {
          for (const [k, v] of Object.entries(m.chest)) {
            if (v > 0) chest.set(k, v);
          }
        }
        motel = { expiresAt: Number(m.expiresAt) || 0, chest };
      }
    }
  }

  let atmToday = 0;
  if (atmRes.data) {
    for (const row of atmRes.data) atmToday += Math.abs(Number(row.amount) || 0);
  }

  return {
    profile: profRes.data,
    inventory,
    vehicles,
    motel,
    granted: !!(grantRes.data && grantRes.data.length > 0),
    atmToday,
  };
}

async function savePlayerSnapshot(userId, snap) {
  if (!admin || !userId || !snap) return;
  const tasks = [];

  if (snap.profile) {
    tasks.push(
      admin.from('profiles').update({
        display_name: snap.profile.display_name,
        avatar_key: snap.profile.avatar_key,
        cash: Math.max(0, Math.floor(snap.profile.cash || 0)),
        bank: Math.max(0, Math.floor(snap.profile.bank || 0)),
        job: snap.profile.job || 'unemployed',
        hp: Math.max(0, Math.min(100, Math.round(snap.profile.hp ?? 100))),
        hunger: Math.max(0, Math.min(100, Math.round(snap.profile.hunger ?? 100))),
        stamina: Math.max(0, Math.min(100, Math.round(snap.profile.stamina ?? 100))),
        x: Number(snap.profile.x) || 2400,
        y: Number(snap.profile.y) || 2625,
      }).eq('user_id', userId)
    );
  }

  if (snap.inventory) {
    for (const [itemId, qty] of snap.inventory) {
      tasks.push(
        admin.from('inventory').upsert({
          user_id: userId,
          item_id: itemId,
          qty: Math.max(0, Math.floor(qty || 0)),
        }, { onConflict: 'user_id,item_id' })
      );
    }
  }

  if (snap.vehicles) {
    if (snap.vehicles.bicycle) {
      tasks.push(
        admin.from('assets').upsert({
          user_id: userId,
          asset_id: 'vehicle_bicycle',
          qty: 1,
          metadata: {
            durability: snap.vehicles.bicycle.durability,
            x: snap.vehicles.bicycle.x,
            y: snap.vehicles.bicycle.y,
          },
        }, { onConflict: 'user_id,asset_id' })
      );
    }
    if (snap.vehicles.motorbike) {
      tasks.push(
        admin.from('assets').upsert({
          user_id: userId,
          asset_id: 'vehicle_motorbike',
          qty: 1,
          metadata: {
            fuel: snap.vehicles.motorbike.fuel,
            x: snap.vehicles.motorbike.x,
            y: snap.vehicles.motorbike.y,
          },
        }, { onConflict: 'user_id,asset_id' })
      );
    }
  }

  if (snap.motel) {
    const chestObj = {};
    if (snap.motel.chest) {
      for (const [k, v] of snap.motel.chest) {
        if (v > 0) chestObj[k] = v;
      }
    }
    tasks.push(
      admin.from('assets').upsert({
        user_id: userId,
        asset_id: 'room_motel_01',
        qty: 1,
        metadata: {
          expiresAt: snap.motel.expiresAt || 0,
          chest: chestObj,
        },
      }, { onConflict: 'user_id,asset_id' })
    );
  }

  const results = await Promise.all(tasks);
  for (const r of results) {
    if (r && r.error) console.warn('[supabase] save error:', r.error.message);
  }
}

async function logTransaction(userId, type, amount, balanceAfter, idempotencyKey, meta) {
  if (!admin || !userId) return;
  try {
    const { error } = await admin.from('transaction_logs').insert({
      user_id: userId,
      type,
      amount: Math.round(amount || 0),
      balance_after: Math.max(0, Math.round(balanceAfter || 0)),
      idempotency_key: ensureUuid(idempotencyKey),
      metadata: meta || {},
    });
    if (error && error.code !== '23505') {
      console.warn('[supabase] tx log error:', error.message);
    }
  } catch (err) {
    console.warn('[supabase] tx log exception:', err && err.message ? err.message : err);
  }
}

module.exports = {
  isConfigured,
  getPublicConfig,
  checkHealth,
  verifyToken,
  loadPlayerState,
  savePlayerSnapshot,
  logTransaction,
};
