/* Cuộc Sống Ảo — server/migrate.js
   Runs supabase/migrations/*.sql automatically on boot when DATABASE_URL is
   configured. Tracks applied files in public._schema_migrations inside a
   transaction per file. Safe when DATABASE_URL is unset (no-op). */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'supabase', 'migrations');

let lastMigrationStatus = { configured: false, ok: false, applied: [], skipped: [], error: null };

async function runMigrations() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    lastMigrationStatus = { configured: false, ok: true, applied: [], skipped: [], error: null };
    console.log('[migrate] DATABASE_URL unset — skipping auto-migration');
    return lastMigrationStatus;
  }
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    lastMigrationStatus = { configured: true, ok: false, applied: [], skipped: [], error: 'MIGRATIONS_DIR_MISSING' };
    console.warn('[migrate] migrations directory not found:', MIGRATIONS_DIR);
    return lastMigrationStatus;
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = new Client({
    connectionString: connStr,
    ssl: connStr.includes('localhost') || connStr.includes('127.0.0.1')
      ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  const applied = [];
  const skipped = [];
  try {
    await client.connect();
    await client.query(`
      create table if not exists public._schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);
    const { rows } = await client.query('select filename from public._schema_migrations');
    const done = new Set(rows.map((r) => r.filename));

    for (const file of files) {
      if (done.has(file)) {
        skipped.push(file);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrate] applying ${file}...`);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into public._schema_migrations (filename) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
        console.log(`[migrate] applied ${file}`);
      } catch (err) {
        try { await client.query('rollback'); } catch (e) { /* ignore */ }
        throw new Error(`${file}: ${err.message}`);
      }
    }
    lastMigrationStatus = { configured: true, ok: true, applied, skipped, error: null };
    console.log(`[migrate] ready (applied: ${applied.length}, already: ${skipped.length})`);
    return lastMigrationStatus;
  } catch (err) {
    lastMigrationStatus = { configured: true, ok: false, applied, skipped, error: err.message };
    console.error('[migrate] failed:', err.message);
    return lastMigrationStatus;
  } finally {
    try { await client.end(); } catch (e) { /* ignore */ }
  }
}

function getMigrationStatus() {
  return lastMigrationStatus;
}

module.exports = { runMigrations, getMigrationStatus };
