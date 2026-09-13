import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'skipper.js');

function sandbox() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'skipper-cli-'));
  const claude = path.join(root, 'claude');
  const data = path.join(root, 'data');
  mkdirSync(path.join(claude, 'projects'), { recursive: true });
  return { claude, data, env: { ...process.env, CLAUDE_CONFIG_DIR: claude, SKIPPER_DATA_DIR: data, PORT: '1' } };
}

const run = (args, env, input) => spawnSync(process.execPath, [bin, ...args], { env, input, encoding: 'utf8', timeout: 20000 });

test('--version and --help', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(run(['--version'], process.env).stdout.trim(), pkg.version);
  const help = run(['--help'], process.env);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /skipper hooks install/);
  assert.match(help.stdout, /skipper doctor/);
});

test('unknown options fail with a message', () => {
  const r = run(['--nope'], process.env);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown option: --nope/);
});

test('hooks install, status and uninstall use CLAUDE_CONFIG_DIR and keep other settings', () => {
  const { claude, env } = sandbox();
  writeFileSync(path.join(claude, 'settings.json'), JSON.stringify({ model: 'opus' }));
  assert.match(run(['hooks', 'install'], env).stdout, /Installed Notification and Stop hooks/);
  const settings = JSON.parse(readFileSync(path.join(claude, 'settings.json'), 'utf8'));
  assert.equal(settings.model, 'opus');
  assert.ok(settings.hooks.Notification[0].hooks[0].command.includes('skipper-hook'));
  assert.match(run(['hooks', 'status'], env).stdout, /installed/);
  assert.match(run(['hooks', 'uninstall'], env).stdout, /Removed Skipper hooks/);
  assert.equal(JSON.parse(readFileSync(path.join(claude, 'settings.json'), 'utf8')).hooks, undefined);
});

test('hook reads a payload from stdin and records it; garbage is ignored with exit 0', () => {
  const { data, env } = sandbox();
  const payload = JSON.stringify({ hook_event_name: 'Notification', session_id: '11111111-2222-4333-8444-555555555555', message: 'Claude needs your permission to use Bash: ls', notification_type: 'permission_prompt' });
  assert.equal(run(['hook'], env, payload).status, 0);
  const line = JSON.parse(readFileSync(path.join(data, 'events.jsonl'), 'utf8').trim());
  assert.equal(line.kind, 'permission');
  assert.equal(run(['hook'], env, 'not json').status, 0, 'a broken payload must never fail the session');
});

test('hooks native on/off writes the config', () => {
  const { data, env } = sandbox();
  run(['hooks', 'native', 'on'], env);
  assert.equal(JSON.parse(readFileSync(path.join(data, 'config.json'), 'utf8')).nativeNotifications, true);
  assert.equal(run(['hooks', 'native', 'maybe'], env).status, 1);
  run(['hooks', 'native', 'off'], env);
  assert.equal(JSON.parse(readFileSync(path.join(data, 'config.json'), 'utf8')).nativeNotifications, false);
});

test('doctor reports problems and exits non-zero when hooks are missing', () => {
  const { env } = sandbox();
  const r = run(['doctor'], env);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /✗ Permission alerts \(hooks\)/);
  assert.match(r.stdout, /→ skipper hooks install/);
  assert.ok(!existsSync(path.join(env.SKIPPER_DATA_DIR, 'events.jsonl')));
});
