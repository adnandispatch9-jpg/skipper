import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync, writeFileSync, chmodSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { startServer, hostAllowed } from '../src/server.js';
import { writeDemo } from '../src/demo.js';

let app;
let base;
const dir = path.join(os.tmpdir(), `skipper-test-${process.pid}`);

before(async () => {
  await writeDemo(dir);
  app = await startServer({ claudeDir: dir, dataDir: path.join(dir, '.skipper'), port: 0, log: () => {} });
  base = `http://127.0.0.1:${app.port}`;
});

after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

test('lists demo sessions with every live state', async () => {
  const { sessions } = await (await fetch(`${base}/api/sessions`)).json();
  const states = new Set(sessions.map((s) => s.state));
  for (const state of ['working', 'waiting', 'sleeping', 'ended']) assert.ok(states.has(state), state);
});

test('session detail includes agents, tasks and team', async () => {
  const { sessions } = await (await fetch(`${base}/api/sessions`)).json();
  const checkout = sessions.find((s) => s.title === 'Checkout flow redesign');
  const { session } = await (await fetch(`${base}/api/sessions/${checkout.id}`)).json();
  assert.equal(session.agents.filter((a) => a.status === 'running').length, 2);
  assert.equal(session.agents.find((a) => a.name === 'apple-pay').worktreeBranch, 'worktree-apple-pay');
  const docs = sessions.find((s) => s.team === 'docs-theme');
  const detail = (await (await fetch(`${base}/api/sessions/${docs.id}`)).json()).session;
  assert.equal(detail.tasks.length, 5);
});

const write = (url, method, body, headers = {}) =>
  fetch(url, { method, headers: { 'content-type': 'application/json', 'x-skipper': '1', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

async function sessionByTitle(title) {
  const { sessions } = await (await fetch(`${base}/api/sessions`)).json();
  return sessions.find((s) => s.title === title);
}

test('writes require the X-Skipper header, JSON and same origin', async () => {
  const s = await sessionByTitle('Fix flaky webhook retries');
  const url = `${base}/api/sessions/${s.id}/notes`;
  assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"text":"x"}' })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'x-skipper': '1', 'content-type': 'text/plain' }, body: 'x' })).status, 415);
  assert.equal((await write(url, 'POST', { text: 'x' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await write(url, 'POST', { text: 'x' }, { origin: 'null' })).status, 403);
  assert.equal((await fetch(`${base}/api/sessions`, { method: 'PUT' })).status, 405);
});

test('notes can be added, edited and deleted', async () => {
  const s = await sessionByTitle('Fix flaky webhook retries');
  const url = `${base}/api/sessions/${s.id}/notes`;
  const note = await (await write(url, 'POST', { text: 'Check the migration first' }, { origin: base })).json();
  assert.equal((await write(`${url}/${note.id}`, 'PATCH', { text: 'Edited' })).status, 200);
  let detail = (await (await fetch(`${base}/api/sessions/${s.id}`)).json()).session;
  assert.deepEqual(detail.notes.map((n) => n.text), ['Edited']);
  assert.equal((await write(url, 'POST', { text: '   ' })).status, 400);
  assert.equal((await write(`${url}/${note.id}`, 'DELETE')).status, 200);
  detail = (await (await fetch(`${base}/api/sessions/${s.id}`)).json()).session;
  assert.equal(detail.notes.length, 0);
});

test('tasks can be created, edited, completed and deleted, respecting blockers', async () => {
  const docs = await sessionByTitle('Migrate docs to the new theme');
  const url = `${base}/api/sessions/${docs.id}/tasks`;
  const created = await (await write(url, 'POST', { subject: 'Announce the new docs' })).json();
  assert.equal(created.id, '6');
  assert.equal((await write(`${url}/6`, 'PATCH', { subject: 'Announce new docs', status: 'in_progress' })).status, 200);
  assert.equal((await write(`${url}/6`, 'PATCH', { status: 'bogus' })).status, 400);
  assert.equal((await write(`${url}/3`, 'DELETE')).status, 409, 'task 3 blocks 4 and 5');
  assert.equal((await write(`${url}/..%2F..%2Fsettings`, 'DELETE')).status, 404);
  assert.equal((await write(`${url}/6`, 'DELETE')).status, 200);
  const detail = (await (await fetch(`${base}/api/sessions/${docs.id}`)).json()).session;
  assert.equal(detail.tasks.length, 5);

  const fresh = await sessionByTitle('Fix flaky webhook retries');
  const first = await (await write(`${base}/api/sessions/${fresh.id}/tasks`, 'POST', { subject: 'Review migration' })).json();
  assert.equal(first.id, '1');
});

test('messages go to the claude CLI as argv, never through a shell', { skip: process.platform === 'win32' && 'needs a POSIX executable' }, async () => {
  const bin = path.join(dir, 'fake-claude.js');
  const log = path.join(dir, 'fake-claude.json');
  writeFileSync(bin, `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));\nconsole.log('Started background session ab12cd');\n`);
  chmodSync(bin, 0o755);
  const cwd = path.join(dir, 'work');
  mkdirSync(cwd, { recursive: true });

  const messenger = await startServer({ claudeDir: dir, dataDir: path.join(dir, '.skipper'), port: 0, claudeBin: bin, log: () => {} });
  try {
    const url = `http://127.0.0.1:${messenger.port}`;
    const s = await sessionByTitle('Fix flaky webhook retries');
    const session = messenger.store.get(s.id);
    // Point the session at a directory that exists on this machine.
    for (const entry of messenger.store.files.values()) if (entry.summary.id === s.id) entry.summary.cwd = cwd;
    assert.ok(session);
    const message = '--dangerously-skip-permissions; rm -rf ~ $(whoami)';
    const res = await write(`${url}/api/sessions/${s.id}/message`, 'POST', { message });
    assert.equal(res.status, 200);
    assert.match((await res.json()).output, /ab12cd/);
    const call = JSON.parse(readFileSync(log, 'utf8'));
    assert.deepEqual(call.argv, ['--bg', '--resume', s.id, '--', message]);
    assert.equal(realpathSync(call.cwd), realpathSync(cwd));

    const readOnly = await startServer({ claudeDir: dir, dataDir: path.join(dir, '.skipper'), port: 0, readOnly: true, log: () => {} });
    try {
      assert.equal((await write(`http://127.0.0.1:${readOnly.port}/api/sessions/${s.id}/notes`, 'POST', { text: 'x' })).status, 403);
    } finally {
      await readOnly.close();
    }
  } finally {
    await messenger.close();
  }
});

test('rejects path traversal and unknown ids', async () => {
  for (const id of ['..%2F..%2Fsettings', '..', 'not-a-session']) {
    assert.equal((await fetch(`${base}/api/sessions/${id}`)).status, 404, id);
  }
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
});

test('rejects foreign Host headers (DNS rebinding)', () => {
  assert.equal(hostAllowed('localhost:4317', 4317), true);
  assert.equal(hostAllowed('127.0.0.1:4317', 4317), true);
  assert.equal(hostAllowed('evil.example:4317', 4317), false);
  assert.equal(hostAllowed('localhost:9999', 4317), false);
  assert.equal(hostAllowed(undefined, 4317), false);
});

test('sends a strict content security policy', async () => {
  const res = await fetch(`${base}/`);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('network mode requires the access token', async () => {
  const remote = await startServer({ claudeDir: dir, host: '0.0.0.0', port: 0, token: 'secret-token', log: () => {} });
  const url = `http://127.0.0.1:${remote.port}`;
  try {
    // 127.0.0.1 with Host 127.0.0.1 is the Mac's own browser: no token needed.
    assert.equal((await fetch(`${url}/api/sessions`)).status, 200);
    const { request } = await import('node:http');
    const foreignHost = await new Promise((resolve) => request(`${url}/api/sessions`, { headers: { host: 'evil.example:80' } }, (res) => { res.resume(); resolve(res.statusCode); }).end());
    assert.equal(foreignHost, 401, 'a rebinding page cannot skip the token');
    const lan = (p, headers = {}) => new Promise((resolve) => request(`${url}${p}`, { headers: { host: '192.168.1.5:80', ...headers } }, (res) => { res.resume(); resolve(res); }).end());
    const login = await lan('/?token=secret-token');
    assert.equal(login.statusCode, 302);
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    assert.equal((await lan('/api/sessions', { cookie })).statusCode, 200);
    assert.equal((await lan('/api/sessions', { cookie: 'skipper_token=wrong' })).statusCode, 401);
  } finally {
    await remote.close();
  }
});

test('permission hook events put a session in the permission state until it moves on', async () => {
  const { sessions } = await (await fetch(`${base}/api/sessions`)).json();
  const release = sessions.find((s) => s.title === 'Ship 4.2 to TestFlight');
  assert.equal(release.state, 'permission');
  assert.match(release.attention.message, /fastlane/);

  const { recordHook } = await import('../src/hooks.js');
  const other = sessions.find((s) => s.title === 'Fix flaky webhook retries');

  // Listen like the browser does: the alert must arrive over Server-Sent Events.
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/events`, { signal: controller.signal });
  const reader = stream.body.getReader();
  const alert = (async () => {
    let text = '';
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) return null;
      text += decoder.decode(value, { stream: true });
      const match = text.match(/event: alert\ndata: (.+)\n/);
      if (match) return JSON.parse(match[1]);
    }
  })();

  await recordHook(JSON.stringify({ hook_event_name: 'Notification', session_id: other.id, message: 'Claude needs your permission to use Edit', notification_type: 'permission_prompt' }), path.join(dir, '.skipper'));
  const timeout = setTimeout(() => controller.abort(), 8000);
  const received = await alert.catch(() => null);
  clearTimeout(timeout);
  controller.abort();
  assert.ok(received, 'alert event was delivered');
  assert.equal(received.kind, 'permission');
  assert.equal(received.title, 'Fix flaky webhook retries');
  assert.equal(app.store.list().find((s) => s.id === other.id).state, 'permission');

  // New transcript activity after the prompt means it was answered.
  const entry = [...app.store.files.values()].find((e) => e.summary.id === other.id);
  entry.summary.updatedAt = Date.now() + 1000;
  assert.equal(app.store.list().find((s) => s.id === other.id).state === 'permission', false);
});

test('activity feed merges hook events, subagents, PRs, workflows and ended sessions', async () => {
  const { items } = await (await fetch(`${base}/api/activity`)).json();
  const kinds = new Set(items.map((i) => i.kind));
  for (const kind of ['permission', 'loop', 'turn', 'agent-start', 'agent-done', 'pr', 'workflow', 'ended']) assert.ok(kinds.has(kind), `missing ${kind}`);
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].at >= items[i].at, 'newest first');
  const loop = items.find((i) => i.kind === 'loop');
  assert.equal(loop.title, 'offline-sync-loop');
  assert.equal((await (await fetch(`${base}/api/activity?limit=3`)).json()).items.length, 3);
});

test('activity: only the newest finished turn of a session carries its message', async () => {
  const { recordHook } = await import('../src/hooks.js');
  const { sessions } = await (await fetch(`${base}/api/sessions`)).json();
  const docs = sessions.find((s) => s.title === 'Migrate docs to the new theme');
  for (let i = 0; i < 2; i++) {
    await recordHook(JSON.stringify({ hook_event_name: 'Stop', session_id: docs.id }), path.join(dir, '.skipper'));
    await new Promise((r) => setTimeout(r, 5));
  }
  await app.store.refresh();
  const turns = app.store.activity().filter((i) => i.sessionId === docs.id && i.kind === 'turn');
  assert.equal(turns.length, 2);
  assert.ok(turns[0].detail, 'newest has text');
  assert.equal(turns[1].detail, null, 'older has none');
});

test('message sends are rate limited', async () => {
  const { MESSAGE_LIMIT } = await import('../src/server.js');
  const demo = await startServer({ claudeDir: dir, dataDir: path.join(dir, '.skipper'), port: 0, claudeBin: null, log: () => {} });
  try {
    const url = `http://127.0.0.1:${demo.port}`;
    const s = await sessionByTitle('Fix flaky webhook retries');
    const statuses = [];
    for (let i = 0; i < MESSAGE_LIMIT.count + 2; i++) {
      statuses.push((await write(`${url}/api/sessions/${s.id}/message`, 'POST', { message: `hello ${i}` })).status);
    }
    assert.deepEqual(statuses.slice(0, MESSAGE_LIMIT.count), Array(MESSAGE_LIMIT.count).fill(200));
    assert.deepEqual(statuses.slice(MESSAGE_LIMIT.count), [429, 429]);
  } finally {
    await demo.close();
  }
});

test('usage counts each response once, includes subagents, and groups by day, project and model', async () => {
  const { applyUsage } = await import('../src/transcript.js');
  const usage = new Map();
  const rec = (output) => ({ type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'msg_1', model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: output } } });
  applyUsage(usage, rec(5));
  applyUsage(usage, rec(120));
  applyUsage(usage, rec(120));
  assert.equal(usage.size, 1);
  assert.equal(usage.get('msg_1').output, 120);

  const res = await (await fetch(`${base}/api/usage?days=14`)).json();
  assert.equal(res.perDay.length, 14);
  assert.ok(res.totals.output > 0 && res.totals.subagentOutput > 0, 'subagents counted');
  assert.equal(res.perDay.reduce((sum, d) => sum + d.output, 0), res.totals.output);
  assert.deepEqual(res.byModel.map((m) => m.name).sort(), ['haiku', 'opus', 'sonnet']);
  assert.ok(res.byProject.find((p) => p.name === 'storefront'));
  assert.equal((await (await fetch(`${base}/api/usage?days=999`)).json()).days, 14, 'unknown ranges fall back to 14');
});

test('session detail includes its own token totals, subagents included', async () => {
  const s = await sessionByTitle('Checkout flow redesign');
  const { session } = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  assert.ok(session.tokens.output > 0);
  assert.ok(session.tokens.subagentOutput > 0 && session.tokens.subagentOutput < session.tokens.output);
  assert.equal(session.tokens.responses > 0, true);
});

test('deleted subagent transcripts are forgotten', async () => {
  const { Store } = await import('../src/store.js');
  const { cpSync, rmSync: rm, readdirSync } = await import('node:fs');
  const copy = path.join(os.tmpdir(), `skipper-prune-${process.pid}`);
  cpSync(dir, copy, { recursive: true });
  try {
    const store = new Store(copy);
    await store.refresh();
    const before = store.subagentFiles.size;
    assert.ok(before > 0);
    const project = readdirSync(path.join(copy, 'projects')).find((p) => p.endsWith('storefront'));
    const sessionDir = readdirSync(path.join(copy, 'projects', project), { withFileTypes: true }).find((e) => e.isDirectory());
    rm(path.join(copy, 'projects', project, sessionDir.name, 'subagents'), { recursive: true, force: true });
    await store.refresh();
    assert.equal(store.subagentFiles.size, 0);
    assert.equal(store.metaCache.size, 0);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});

test('static files use ETags and large bodies are gzipped only when accepted', async () => {
  const { request } = await import('node:http');
  const { gunzipSync } = await import('node:zlib');
  const raw = (pathname, headers = {}) => new Promise((resolve, reject) => {
    request(`${base}${pathname}`, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject).end();
  });
  const first = await raw('/app.js');
  assert.equal(first.status, 200);
  assert.equal(first.headers['content-encoding'], undefined);
  assert.ok(first.headers.etag);
  const cached = await raw('/app.js', { 'If-None-Match': first.headers.etag });
  assert.equal(cached.status, 304);
  assert.equal(cached.body.length, 0);
  const zipped = await raw('/api/sessions', { 'Accept-Encoding': 'gzip, br' });
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.ok(Array.isArray(JSON.parse(gunzipSync(zipped.body)).sessions));
});

test('close does not wait for open dashboard connections', async () => {
  const { request, Agent } = await import('node:http');
  const extra = await startServer({ claudeDir: dir, dataDir: path.join(dir, '.skipper'), port: 0, log: () => {} });
  const agent = new Agent({ keepAlive: true });
  await new Promise((resolve) => request(`http://127.0.0.1:${extra.port}/api/sessions`, { agent }, (res) => { res.resume(); res.on('end', resolve); }).end());
  const stream = request(`http://127.0.0.1:${extra.port}/api/events`, { agent: false });
  await new Promise((resolve) => { stream.on('response', resolve); stream.on('error', () => {}); stream.end(); });
  const started = Date.now();
  await extra.close();
  assert.ok(Date.now() - started < 1000, `close took ${Date.now() - started}ms`);
  agent.destroy();
});

test('usage downloads as CSV for the selected range', async () => {
  const res = await fetch(`${base}/api/usage.csv?days=7`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv/);
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="skipper-usage-7d-\d{4}-\d{2}-\d{2}\.csv"$/);
  const lines = (await res.text()).trim().split('\r\n');
  assert.equal(lines[0], 'day,output_tokens,input_tokens');
  assert.equal(lines.length, 8, 'a header and one row per day');
  const json = await (await fetch(`${base}/api/usage?days=7`)).json();
  assert.deepEqual(lines.slice(1), json.perDay.map((d) => `${d.day},${d.output},${d.input}`));
});

test('CSV fields are quoted and cannot run as spreadsheet formulas', async () => {
  const { csvField } = await import('../src/server.js');
  assert.equal(csvField(1200), '1200');
  assert.equal(csvField(-5), '-5');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvField('@sum'), "'@sum");
});

test('background sessions are marked so they are not mistaken for terminals', async () => {
  const { sessions } = await (await fetch(`${base}/api/sessions`)).json();
  const loop = sessions.find((s) => s.title === 'offline-sync-loop');
  assert.equal(loop.background, true);
  assert.equal(sessions.find((s) => s.title === 'Checkout flow redesign').background, false);
  assert.equal(sessions.filter((s) => !s.live).every((s) => s.background === false), true);
});

test('voice requests are rate limited to protect the speech key', async () => {
  const speak = () => fetch(`${base}/api/voice/speak`, { method: 'POST', headers: { 'X-Skipper': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hi' }) });
  const statuses = [];
  for (let i = 0; i < 31; i++) statuses.push((await speak()).status);
  assert.ok(statuses.slice(0, 30).every((s) => s !== 429), `limited too early: ${statuses}`);
  assert.equal(statuses[30], 429);
});
