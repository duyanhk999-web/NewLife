/* Cuộc Sống Ảo — server/index.js
   Colyseus game server (PORT env or 2567). Runs DB auto-migrations on boot
   when DATABASE_URL is configured and exposes /health + public /config. */
const http = require('http');
const { Server } = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const { CityRoom } = require('./rooms/CityRoom');
const stats = require('./stats');
const { runMigrations, getMigrationStatus } = require('./migrate');
const sb = require('./supabase');

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function start(port) {
  const httpServer = http.createServer(async (req, res) => {
    setCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const urlPath = (req.url || '/').split('?')[0];
    if (urlPath === '/health') {
      const db = await sb.checkHealth();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        room: 'city',
        players: stats.humanPlayers,
        migrations: getMigrationStatus(),
        supabase: db,
      }));
    } else if (urlPath === '/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sb.getPublicConfig()));
    } else if (urlPath === '/' || urlPath === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Do Thi Ao — Colyseus city server. Connect a client to room "city".');
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const gameServer = new Server({
    // LAG FIX: tolerate ~12 s of silence before dropping a session
    // (default pingMaxRetries 2 ≈ 6 s). Mobile/VPN hiccups shorter than
    // that no longer kill the session; a truly dead client is still
    // dropped, and the room's allowReconnection(30) covers the gap.
    transport: new WebSocketTransport({ server: httpServer, pingInterval: 3000, pingMaxRetries: 4 }),
  });
  gameServer.define('city', CityRoom);

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`[server] Do Thi Ao city server listening on 0.0.0.0:${port} (env.PORT=${process.env.PORT || 'unset'}, room "city", maxClients 50)`);
  });
  return { httpServer, gameServer };
}

if (require.main === module) {
  const port = parseInt(process.env.PORT || '2567', 10);
  runMigrations()
    .catch((err) => console.error('[migrate] unexpected error:', err))
    .finally(() => start(port));
}

module.exports = { start };
