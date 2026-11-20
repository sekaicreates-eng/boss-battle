// Boss Battle server: serves the game page and passes TikTok LIVE likes to it.
// One program: it listens to your LIVE (TikTok-Live-Connector) and talks to the game (WebSocket).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as TLC from 'tiktok-live-connector';

const { TikTokLiveConnection, WebcastEvent, ControlEvent } = TLC;

// Optional: some versions of the connector need a free sign key from eulerstream.com.
// Set it as an environment variable named EULER_API_KEY on your host if connecting fails.
if (process.env.EULER_API_KEY && TLC.SignConfig) {
  TLC.SignConfig.apiKey = process.env.EULER_API_KEY;
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  try {
    const html = fs.readFileSync(path.join(dir, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('index.html is missing next to server.js');
  }
});

const wss = new WebSocketServer({ server });
let status = 'Server ready. Enter your TikTok username and tap Connect.';

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(obj) {
  for (const client of wss.clients) send(client, obj);
}
function setStatus(text) {
  status = text;
  console.log(text);
  broadcast({ type: 'status', text });
}

let conn = null;
let currentUser = '';
let retryTimer = null;
let generation = 0;

function stop() {
  generation++;
  clearTimeout(retryTimer);
  if (conn) {
    try { conn.disconnect(); } catch (e) { /* already closed */ }
    conn = null;
  }
}

function start(name) {
  stop();
  currentUser = name;
  const mine = generation;
  conn = new TikTokLiveConnection(name);

  conn.on(WebcastEvent?.LIKE ?? 'like', (data) => {
    const who = data.user?.uniqueId || data.uniqueId || data.user?.nickname || data.nickname || 'viewer';
    const count = Number(data.likeCount) || 1;
    broadcast({ type: 'like', name: who, count });
  });

  conn.on(ControlEvent?.DISCONNECTED ?? 'disconnected', () => {
    if (mine !== generation) return;
    setStatus(`Disconnected from @${name}. Retrying in 5 seconds...`);
    retryTimer = setTimeout(() => { if (mine === generation) start(name); }, 5000);
  });

  conn.on(ControlEvent?.ERROR ?? 'error', (err) => {
    console.error('Connector error:', err?.message || err);
  });

  setStatus(`Connecting to @${name}...`);
  conn.connect()
    .then(() => {
      if (mine === generation) setStatus(`Connected to @${name}. Likes will appear in the game.`);
    })
    .catch((err) => {
      if (mine !== generation) return;
      console.error('Connect failed:', err?.message || err);
      setStatus(`Could not connect to @${name}. Are you live right now? Retrying in 10 seconds...`);
      retryTimer = setTimeout(() => { if (mine === generation) start(name); }, 10000);
    });
}

wss.on('connection', (ws) => {
  send(ws, { type: 'status', text: status });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.type !== 'connect' || typeof msg.user !== 'string') return;
    const name = msg.user.trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9_.]{1,40}$/.test(name)) {
      send(ws, { type: 'status', text: 'That username has characters TikTok does not allow.' });
      return;
    }
    if (name !== currentUser) start(name);
    else send(ws, { type: 'status', text: status });
  });
});

process.on('unhandledRejection', (err) => console.error('Unhandled:', err?.message || err));
process.on('uncaughtException', (err) => console.error('Uncaught:', err?.message || err));

server.listen(PORT, () => {
  console.log(`Boss Battle server on port ${PORT}`);
  if (process.env.TIKTOK_USERNAME) start(process.env.TIKTOK_USERNAME.replace(/^@/, ''));
});
