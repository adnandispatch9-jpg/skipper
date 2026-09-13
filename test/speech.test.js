import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, statSync } from 'node:fs';
import { detectLanguage, ssml, transcribe, synthesize, speechConfig, SpeechError, VOICES } from '../src/speech.js';
import { writeConfig } from '../src/hooks.js';

const config = { key: 'k'.repeat(32), region: 'westeurope', voices: VOICES };

test('language guess picks Uzbek and English sentences apart', () => {
  assert.equal(detectLanguage('Hozir ikkita sessiya sizni kutyapti.'), 'uz-UZ');
  assert.equal(detectLanguage('Checkout flow redesign qaysi bosqichda?'), 'uz-UZ');
  assert.equal(detectLanguage("Toʻlov sahifasi ustida ishlayapti, rejaning uchdan biri tugadi."), 'uz-UZ');
  assert.equal(detectLanguage('Two sessions are waiting for you.'), 'en-US');
  assert.equal(detectLanguage('What is the docs session doing?'), 'en-US');
});

test('SSML escapes text and names the voice', () => {
  const xml = ssml('a < b & "c"', 'uz-UZ', 'uz-UZ-MadinaNeural');
  assert.match(xml, /<voice name="uz-UZ-MadinaNeural">/);
  assert.match(xml, /a &lt; b &amp; &quot;c&quot;/);
});

test('transcribe asks each language and keeps the most confident result', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, key: init.headers['Ocp-Apim-Subscription-Key'] });
    const uz = url.includes('language=uz-UZ');
    return { ok: true, status: 200, json: async () => ({ RecognitionStatus: 'Success', NBest: [{ Confidence: uz ? 0.91 : 0.42, Display: uz ? 'Qaysi sessiya kutyapti?' : 'Guy see cease yeah?' }] }) };
  };
  const result = await transcribe(config, Buffer.alloc(3200), { fetchImpl });
  assert.deepEqual(result, { text: 'Qaysi sessiya kutyapti?', language: 'uz-UZ', confidence: 0.91 });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.url.startsWith('https://westeurope.stt.speech.microsoft.com/') && c.key === config.key));
});

test('speech errors are clear and never leak the key', async () => {
  await assert.rejects(transcribe(null, Buffer.alloc(10)), (e) => e instanceof SpeechError && e.status === 503);
  await assert.rejects(transcribe(config, Buffer.alloc(0)), (e) => e.status === 400);
  await assert.rejects(transcribe(config, Buffer.alloc(5 * 1024 * 1024)), (e) => e.status === 413);
  const rejected = async () => ({ ok: false, status: 401 });
  await assert.rejects(synthesize(config, 'Salom', { fetchImpl: rejected }), (e) => e.status === 502 && !e.message.includes(config.key));
});

test('synthesize reads Uzbek with the Uzbek voice and returns MP3 bytes', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init };
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([0xff, 0xf3, 1, 2]).buffer };
  };
  const out = await synthesize(config, 'Ikkita sessiya sizni kutyapti.', { fetchImpl });
  assert.equal(out.language, 'uz-UZ');
  assert.equal(out.audio.length, 4);
  assert.match(sent.init.body, /uz-UZ-MadinaNeural/);
  assert.equal(sent.init.headers['X-Microsoft-OutputFormat'], 'audio-24khz-48kbitrate-mono-mp3');
});

test('the key comes from the environment or a private config file', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'skipper-speech-'));
  assert.equal(await speechConfig(dir, {}), null);
  await writeConfig(dir, { azureSpeech: { key: 'abc', region: 'eastus' } });
  assert.equal((await speechConfig(dir, {})).region, 'eastus');
  if (process.platform !== 'win32') assert.equal(statSync(path.join(dir, 'config.json')).mode & 0o777, 0o600);
  assert.equal((await speechConfig(dir, { AZURE_SPEECH_KEY: 'x', AZURE_SPEECH_REGION: 'y' })).key, 'x');
});

test('Whisper language detection is read from its log', async () => {
  const { parseDetectedLanguage } = await import('../src/speech.js');
  assert.equal(parseDetectedLanguage('whisper_full_with_state: auto-detected language: en (p = 0.97)'), 'en');
  assert.equal(parseDetectedLanguage('whisper_full_with_state: auto-detected language: tr (p = 0.56)'), 'tr');
  assert.equal(parseDetectedLanguage('nothing here'), null);
});
