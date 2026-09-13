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
    assert.equal((await fetch(`${url}/api/sessions`)).status, 401);
    const login = await fetch(`${url}/?token=secret-token`, { redirect: 'manual' });
    assert.equal(login.status, 302);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${url}/api/sessions`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${url}/api/sessions`, { headers: { cookie: 'skipper_token=wrong' } })).status, 401);
  } finally {
    await remote.close();
  }
});
