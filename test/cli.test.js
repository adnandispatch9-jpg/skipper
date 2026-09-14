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

test('--log-dir writes startup output and errors to files', () => {
  const { env } = sandbox();
  const logs = path.join(env.SKIPPER_DATA_DIR, 'logs');
  const r = run(['--port', 'nope', '--log-dir', logs], env);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, '', 'nothing goes to the terminal');
  assert.match(readFileSync(path.join(logs, 'err.log'), 'utf8'), /Invalid port: nope/);
});

test('pair reset clears the saved network token', () => {
  const { data, env } = sandbox();
  mkdirSync(data, { recursive: true });
  writeFileSync(path.join(data, 'config.json'), JSON.stringify({ networkToken: 'old-token-1234567890' }));
  assert.match(run(['pair', 'reset'], env).stdout, /Network token cleared/);
  assert.equal(JSON.parse(readFileSync(path.join(data, 'config.json'), 'utf8')).networkToken, null);
});

test('a log file over 1 MB is started fresh when Skipper starts', { skip: process.platform === 'win32' && 'POSIX file descriptors' }, async () => {
  const { openSync, writeFileSync, statSync, closeSync } = await import('node:fs');
  const { spawn } = await import('node:child_process');
  const { env, claude } = sandbox();
  const log = path.join(claude, '..', 'out.log');
  writeFileSync(log, 'x'.repeat(1024 * 1024 + 10));
  const fd = openSync(log, 'a');
  const child = spawn(process.execPath, [bin, '--port', '0'], { env, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && statSync(log).size > 1024 * 1024) await new Promise((r) => setTimeout(r, 100));
  child.kill();
  assert.ok(statSync(log).size < 1024 * 1024, `log is still ${statSync(log).size} bytes`);
});
