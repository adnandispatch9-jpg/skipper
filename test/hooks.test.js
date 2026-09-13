import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { classify, recordHook, installHooks, uninstallHooks, hooksStatus } from '../src/hooks.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'skipper-hooks-'));
const ID = '11111111-2222-4333-8444-555555555555';

test('classifies hook payloads', () => {
  assert.equal(classify({ hook_event_name: 'Notification', notification_type: 'permission_prompt' }), 'permission');
  assert.equal(classify({ hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' }), 'permission');
  assert.equal(classify({ hook_event_name: 'Notification', notification_type: 'idle_prompt' }), 'idle');
  assert.equal(classify({ hook_event_name: 'Notification', notification_type: 'elicitation_dialog' }), 'question');
  assert.equal(classify({ hook_event_name: 'Stop' }), 'done');
  assert.equal(classify({ hook_event_name: 'Notification', notification_type: 'auth_success' }), null);
});

test('recordHook appends events and never throws on garbage', async () => {
  const dir = tmp();
  assert.equal(await recordHook('not json', dir), null);
  assert.equal(await recordHook(JSON.stringify({ hook_event_name: 'Stop' }), dir), null);
  await recordHook(JSON.stringify({ hook_event_name: 'Notification', session_id: ID, message: 'Claude needs your permission to use Bash' }), dir);
  const lines = readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, 'permission');
});

test('install is idempotent, keeps other settings and hooks, and uninstall removes only ours', async () => {
  const dir = tmp();
  const settingsFile = path.join(dir, 'settings.json');
  const original = { model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: '/usr/local/bin/other-hook' }] }] } };
  writeFileSync(settingsFile, JSON.stringify(original));

  await installHooks({ settingsFile, nodePath: '/opt/node', scriptPath: '/opt/skipper/bin/skipper.js' });
  await installHooks({ settingsFile, nodePath: '/opt/node', scriptPath: '/opt/skipper/bin/skipper.js' });
  const installed = JSON.parse(readFileSync(settingsFile, 'utf8'));
  assert.equal(installed.model, 'opus');
  assert.equal(installed.hooks.Stop.length, 2);
  assert.equal(installed.hooks.Notification.length, 1);
  assert.match(installed.hooks.Notification[0].hooks[0].command, /"\/opt\/node" "\/opt\/skipper\/bin\/skipper.js" hook/);
  assert.ok(existsSync(`${settingsFile}.skipper-backup`));
  assert.equal((await hooksStatus({ settingsFile })).installed, true);

  assert.equal((await uninstallHooks({ settingsFile })).removed, 2);
  assert.deepEqual(JSON.parse(readFileSync(settingsFile, 'utf8')), original);
  assert.equal((await hooksStatus({ settingsFile })).installed, false);
});

test('install works when settings.json does not exist yet', async () => {
  const settingsFile = path.join(tmp(), 'nested', 'settings.json');
  await installHooks({ settingsFile, nodePath: 'node', scriptPath: 'skipper.js' });
  assert.equal((await hooksStatus({ settingsFile })).installed, true);
});

test('the event log is rotated to its most recent lines once it grows too large', async () => {
  const { rotate } = await import('../src/hooks.js');
  const dir = tmp();
  const file = path.join(dir, 'events.jsonl');
  writeFileSync(file, Array.from({ length: 3000 }, (_, i) => JSON.stringify({ at: i, sessionId: ID, kind: 'done' })).join('\n') + '\n');
  assert.equal(await rotate(file, 1024), true);
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1000);
  assert.equal(JSON.parse(lines.at(-1)).at, 2999);
  assert.equal(await rotate(file, 10 * 1024 * 1024), false);
});
