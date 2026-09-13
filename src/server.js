import http from 'node:http';
import { watch, promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Notes, Tasks, ActionError, sendMessage } from './actions.js';
import { eventsFile, hooksStatus } from './hooks.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Every servable file is listed here; request paths never touch the filesystem.
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/logic.js': ['logic.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
};

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const WRITE_METHODS = new Set(['POST', 'PATCH', 'DELETE']);
const MAX_BODY = 64 * 1024;
const MAX_EVENT_CLIENTS = 64;
export const MESSAGE_LIMIT = { count: 5, windowMs: 60_000 };

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function isLoopback(host) {
  return LOOPBACK.has(host);
}

// Rejects DNS-rebinding requests: a loopback server only answers to loopback names.
export function hostAllowed(hostHeader, port) {
  if (typeof hostHeader !== 'string') return false;
  const allowed = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
  return allowed.includes(hostHeader.toLowerCase());
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function cookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

// Bodies over 1 KB are gzipped when the client accepts it: session lists are
// mostly repeated keys and shrink about 5x, which matters on a phone over Wi-Fi.
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const headers = { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra };
  if (body && body.length > 1024 && /\bgzip\b/.test(res.req?.headers['accept-encoding'] || '')) {
    body = gzipSync(body);
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  res.writeHead(status, headers);
  res.end(body);
}

export async function startServer({
  claudeDir,
  dataDir,
  host = '127.0.0.1',
  port = 4317,
  token = null,
  readOnly = false,
  claudeBin = 'claude',
  log = console.log,
}) {
  const skipperDir = dataDir ?? path.join(claudeDir, '..', '.skipper');
  const store = new Store(claudeDir, { eventsFile: eventsFile(skipperDir) });
  const settingsFile = path.join(claudeDir, 'settings.json');
  // The first scan of a large history can take seconds on a busy machine. The port
  // opens right away so the page loads; API requests wait for this scan.
  const ready = store.refresh();
  ready.catch(() => {});

  const remote = !isLoopback(host);
  const accessToken = remote ? token || crypto.randomBytes(18).toString('base64url') : null;
  const clients = new Set();

  const broadcast = () => {
    for (const res of clients) res.write('event: change\ndata: {}\n\n');
    for (const alert of store.drainAlerts()) {
      for (const res of clients) res.write(`event: alert\ndata: ${JSON.stringify(alert)}\n\n`);
    }
  };

  let pending = null;
  const scheduleRefresh = () => {
    if (pending) return;
    pending = setTimeout(async () => {
      pending = null;
      try {
        await ready;
        const changed = await store.refresh();
        if (changed || store.pendingAlerts.length) broadcast();
      } catch (error) {
        log(`refresh failed: ${error.message}`);
      }
    }, 300);
  };

  const watchers = [];
  try {
    await fs.mkdir(skipperDir, { recursive: true });
    watchers.push(watch(skipperDir, scheduleRefresh));
  } catch {}
  for (const sub of ['projects', 'sessions', 'tasks', 'teams']) {
    try {
      watchers.push(watch(path.join(claudeDir, sub), { recursive: true }, scheduleRefresh));
    } catch {
      // Directory may not exist yet; the interval below still picks it up.
    }
  }
  // Liveness (pids) and time-based states change without file events.
  const ticker = setInterval(scheduleRefresh, 5000);
  const keepAlive = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 25000);

  const notes = new Notes(skipperDir);
  const messageTimes = [];
  const tasks = new Tasks(claudeDir, store);

  async function readBody(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new ActionError(413, 'Request body too large');
      chunks.push(chunk);
    }
    if (!size) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new ActionError(400, 'Invalid JSON');
    }
  }

  // Writes need our custom header (forces a CORS preflight we never grant),
  // a JSON body, and a same-origin Origin header when the browser sends one.
  function checkWrite(req) {
    if (readOnly) throw new ActionError(403, 'Skipper was started with --read-only');
    if (req.headers['x-skipper'] !== '1') throw new ActionError(403, 'Missing X-Skipper header');
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new ActionError(415, 'Use application/json');
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      let originHost;
      try {
        originHost = new URL(origin).host;
      } catch {
        throw new ActionError(403, 'Bad origin');
      }
      if (originHost !== req.headers.host) throw new ActionError(403, 'Cross-origin request refused');
    } else if (origin === 'null') {
      throw new ActionError(403, 'Cross-origin request refused');
    }
  }

  const json = (res, status, data) => send(res, status, JSON.stringify(data));

  async function route(req, res, url) {
    const method = req.method;
    const parts = url.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));

    if (url.pathname.startsWith('/api/')) await ready;
    if (method === 'GET' || method === 'HEAD') {
      if (STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        const body = await fs.readFile(path.join(PUBLIC_DIR, file));
        const etag = `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 16)}"`;
        if (req.headers['if-none-match'] === etag) return send(res, 304, null, type, { 'Cache-Control': 'no-cache', ETag: etag });
        return send(res, 200, body, type, { 'Cache-Control': 'no-cache', ETag: etag });
      }
      if (url.pathname === '/api/usage') {
        const days = [1, 7, 14, 30].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 14;
        return json(res, 200, { now: Date.now(), ...store.usage({ days }) });
      }
      if (url.pathname === '/api/activity') {
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 300);
        return json(res, 200, { now: Date.now(), items: store.activity({ limit }) });
      }
      if (url.pathname === '/api/sessions') {
        return json(res, 200, { now: Date.now(), claudeDir, readOnly, hooks: await hooksStatus({ settingsFile }), sessions: store.list() });
      }
      if (parts[0] === 'api' && parts[1] === 'sessions' && parts.length === 3) {
        const session = store.get(parts[2]);
        if (!session) return json(res, 404, { error: 'Session not found' });
        return json(res, 200, { now: Date.now(), readOnly, session: { ...session, notes: await notes.list(session.id) } });
      }
      if (url.pathname === '/api/events') {
        if (clients.size >= MAX_EVENT_CLIENTS) return json(res, 503, { error: 'Too many open dashboards' });
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write('event: hello\ndata: {}\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      return json(res, 404, { error: 'Not found' });
    }

    if (!WRITE_METHODS.has(method)) {
      return send(res, 405, JSON.stringify({ error: 'Method not allowed' }), undefined, { Allow: 'GET, HEAD, POST, PATCH, DELETE' });
    }
    if (parts[0] !== 'api' || parts[1] !== 'sessions' || parts.length < 4) return json(res, 404, { error: 'Not found' });

    checkWrite(req);
    const session = store.get(parts[2]);
    if (!session) return json(res, 404, { error: 'Session not found' });
    const body = await readBody(req);
    const [, , , kind, itemId, extra] = parts;
    if (extra !== undefined) return json(res, 404, { error: 'Not found' });

    let result;
    if (kind === 'message' && method === 'POST' && itemId === undefined) {
      // Each message starts a process, so cap how often that can happen.
      const t = Date.now();
      while (messageTimes.length && t - messageTimes[0] > MESSAGE_LIMIT.windowMs) messageTimes.shift();
      if (messageTimes.length >= MESSAGE_LIMIT.count) {
        return send(res, 429, JSON.stringify({ error: 'Too many messages in a minute. Wait a moment and try again.' }), undefined, { 'Retry-After': '30' });
      }
      messageTimes.push(t);
      try {
        result = await sendMessage({ session, message: body.message, claudeBin });
      } catch (error) {
        // A rejected message (empty, too long) did not start anything; give the slot back.
        if (error instanceof ActionError && error.status < 500) messageTimes.splice(messageTimes.indexOf(t), 1);
        throw error;
      }
      log(`message sent to ${session.id}`);
    } else if (kind === 'notes' && method === 'POST' && itemId === undefined) {
      result = await notes.add(session.id, body.text);
    } else if (kind === 'notes' && method === 'PATCH' && itemId) {
      result = await notes.update(session.id, itemId, body.text);
    } else if (kind === 'notes' && method === 'DELETE' && itemId) {
      result = await notes.remove(session.id, itemId);
    } else if (kind === 'tasks' && method === 'POST' && itemId === undefined) {
      result = await tasks.create(session.id, body);
    } else if (kind === 'tasks' && method === 'PATCH' && itemId) {
      result = await tasks.update(session.id, itemId, body);
    } else if (kind === 'tasks' && method === 'DELETE' && itemId) {
      result = await tasks.remove(session.id, itemId);
    } else {
      return json(res, 404, { error: 'Not found' });
    }
    if (kind !== 'message') {
      await store.refresh();
      broadcast();
    }
    return json(res, 200, result);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://skipper.local');

      if (!remote && !hostAllowed(req.headers.host, server.address().port)) {
        return send(res, 421, 'Misdirected request', 'text/plain; charset=utf-8');
      }

      if (remote) {
        const given = url.searchParams.get('token');
        if (req.method === 'GET' && given && safeEqual(given, accessToken)) {
          return send(res, 302, '', 'text/plain', {
            Location: url.pathname,
            'Set-Cookie': `skipper_token=${encodeURIComponent(accessToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`,
          });
        }
        if (!safeEqual(cookie(req, 'skipper_token') ?? '', accessToken)) {
          return send(res, 401, 'Open the link with ?token=… printed in the Skipper terminal.', 'text/plain; charset=utf-8');
        }
      }

      await route(req, res, url);
    } catch (error) {
      if (error instanceof ActionError) return send(res, error.status, JSON.stringify({ error: error.message }));
      if (error instanceof URIError) return send(res, 400, JSON.stringify({ error: 'Bad request' }));
      log(`request failed: ${error.message}`);
      return send(res, 500, JSON.stringify({ error: 'Internal error' }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  await ready;

  const close = () =>
    new Promise((resolve) => {
      clearInterval(ticker);
      clearInterval(keepAlive);
      clearTimeout(pending);
      for (const w of watchers) w.close();
      for (const res of clients) res.end();
      server.close(() => resolve());
      // Open dashboard tabs hold keep-alive sockets; drop them so a restart is instant.
      server.closeAllConnections();
    });

  return { server, store, port: server.address().port, host, accessToken, close };
}
