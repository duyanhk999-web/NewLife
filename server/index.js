/* Đô Thị Ảo — M1 Colyseus game server.
   Run:  node index.js        (PORT env or 2567)
   Plain JS, no build step. */
const http = require('http');
const { Server } = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const { CityRoom } = require('./rooms/CityRoom');
const stats = require('./stats');

function start(port) {
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, room: 'city', players: stats.humanPlayers }));
    } else if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Do Thi Ao — Colyseus city server. Connect a client to room "city".');
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });
  gameServer.define('city', CityRoom);

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`[server] Do Thi Ao city server listening on 0.0.0.0:${port} (env.PORT=${process.env.PORT || 'unset'}, room "city", maxClients 8)`);
  });
  return { httpServer, gameServer };
}

if (require.main === module) {
  start(parseInt(process.env.PORT || '2567', 10));
}

module.exports = { start };
