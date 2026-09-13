import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { checkNode, checkClaudeDir, checkEvents, checkService, formatReport } from '../src/doctor.js';

test('node version check', () => {
  assert.equal(checkNode('22.3.0').ok, true);
  assert.equal(checkNode('18.19.0').ok, false);
});

test('claude dir and hook event checks explain what is missing', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'skipper-doctor-'));
  assert.equal((await checkClaudeDir(dir)).ok, false);
  mkdirSync(path.join(dir, 'projects'));
  assert.equal((await checkClaudeDir(dir)).ok, true);
  assert.equal((await checkEvents(dir)).ok, false);
  writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify({ at: 1_000_000 })}\n`);
  assert.match((await checkEvents(dir, 1_000_000 + 5 * 60_000)).detail, /5 min ago/);
});

test('report counts only required problems and shows fixes', () => {
  const { text, problems } = formatReport([
    { ok: true, label: 'A', detail: 'fine' },
    { ok: false, label: 'B', detail: 'broken', fix: 'do this' },
    { ok: true, optional: true, label: 'C', detail: 'off', fix: 'turn on' },
  ]);
  assert.equal(problems, 1);
  assert.match(text, /✗ B/);
  assert.match(text, /→ do this/);
  assert.match(text, /→ turn on/);
});

test('service check does not push an install when Skipper already runs another way', () => {
  const none = { installed: false, running: false };
  assert.equal(checkService({ status: none, dashboardUp: true }).optional, undefined);
  assert.equal(checkService({ status: none, dashboardUp: false }).fix, 'skipper service install');
  assert.equal(checkService({ status: { installed: true, running: false } }).ok, false);
});

test('voice check says what is missing when voice is off', async () => {
  const { checkVoice } = await import('../src/doctor.js');
  const os = await import('node:os');
  const path = await import('node:path');
  const { mkdtempSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'skipper-voice-doc-'));
  const off = await checkVoice(dir, { env: { SKIPPER_WHISPER_BIN: '' }, exists: () => false });
  assert.equal(off.optional, true);
  assert.match(off.detail, /missing .*edge-tts/);
  const azure = await checkVoice(dir, { env: { AZURE_SPEECH_KEY: 'k'.repeat(32), AZURE_SPEECH_REGION: 'westeurope' } });
  assert.match(azure.detail, /Azure AI Speech \(westeurope\)/);
});
