import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/skipper.js', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'skipper-voice-status-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const env = { ...process.env, SKIPPER_DATA_DIR: root,
    AZURE_SPEECH_KEY: '', AZURE_SPEECH_REGION: '',
    SKIPPER_WHISPER_BIN: path.join(root, 'whisper-cli'),
    SKIPPER_WHISPER_MODEL: path.join(root, 'model.bin'),
    SKIPPER_EDGE_TTS: path.join(root, 'edge-tts') };
  return { root, env };
}
function status(env) {
  return spawnSync(process.execPath, [bin, 'voice', 'status'], {
    env, encoding: 'utf8', timeout: 20000,
  });
}
test('voice status reports the active local engine and configured paths', (t) => {
  const { env } = fixture(t);
  for (const name of ['SKIPPER_WHISPER_BIN', 'SKIPPER_WHISPER_MODEL', 'SKIPPER_EDGE_TTS']) {
    writeFileSync(env[name], 'fixture, not executed');
  }
  const result = status(env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Active voice engine: local/);
  assert.ok(result.stdout.includes(env.SKIPPER_WHISPER_MODEL));
  assert.match(result.stdout, /not a live audio check/);
});
test('voice status names missing local files', (t) => {
  const { env } = fixture(t);
  const result = status(env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Active voice engine: off/);
  assert.ok(result.stdout.includes(`${env.SKIPPER_WHISPER_MODEL} (missing)`));
  assert.ok(result.stdout.includes(`${env.SKIPPER_EDGE_TTS} (missing)`));
});
test('voice status uses environment Azure configuration without printing its key', (t) => {
  const { env } = fixture(t);
  env.AZURE_SPEECH_KEY = 'fixture-azure-key-do-not-print';
  env.AZURE_SPEECH_REGION = 'westus';
  const result = status(env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Active voice engine: azure/);
  assert.match(result.stdout, /Azure region: westus/);
  assert.ok(!result.stdout.includes(env.AZURE_SPEECH_KEY));
});
test('voice status reports explicitly disabled local voice', (t) => {
  const { root, env } = fixture(t);
  writeFileSync(path.join(root, 'config.json'), JSON.stringify({ localVoice: false }));
  for (const name of ['SKIPPER_WHISPER_BIN', 'SKIPPER_WHISPER_MODEL', 'SKIPPER_EDGE_TTS']) {
    writeFileSync(env[name], 'fixture, not executed');
  }
  const result = status(env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Active voice engine: off/);
  assert.match(result.stdout, /Local voice: disabled in config/);
});
