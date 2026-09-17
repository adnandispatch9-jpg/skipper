import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { detectLanguage, ssml, transcribe, synthesize, speechConfig, localVoicePaths, SpeechError, VOICES } from '../src/speech.js';
import { writeConfig } from '../src/hooks.js';

const config = { key: 'k'.repeat(32), region: 'westeurope', voices: VOICES };

test('local voice discovers PATH tools and the platform venv layout', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'skipper-local-paths-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const bin = path.join(root, 'tools with spaces');
  const data = path.join(root, 'data');
  const windows = process.platform === 'win32';
  const suffix = windows ? '.exe' : '';
  const venvBin = path.join(data, 'voice-venv', windows ? 'Scripts' : 'bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(venvBin, { recursive: true });
  mkdirSync(path.join(data, 'models'), { recursive: true });
  const whisper = path.join(bin, `whisper-cli${suffix}`);
  const ffmpeg = path.join(bin, `ffmpeg${suffix}`);
  const edge = path.join(venvBin, `edge-tts${suffix}`);
  for (const file of [whisper, ffmpeg, edge, path.join(data, 'models', 'ggml-large-v3-turbo-q5_0.bin')]) {
    writeFileSync(file, 'discovery fixture; never executed');
  }
  const env = { [windows ? 'Path' : 'PATH']: bin };
  const paths = localVoicePaths(data, env);
  assert.equal(paths.whisper, whisper);
  assert.equal(paths.ffmpeg, ffmpeg);
  assert.equal(paths.edgeTts, edge);
  assert.equal((await speechConfig(data, env))?.provider, 'local');
  const overridden = localVoicePaths(data, { ...env,
    SKIPPER_WHISPER_BIN: '/explicit/whisper', SKIPPER_EDGE_TTS: '/explicit/tts',
    SKIPPER_WHISPER_MODEL: '/explicit/model' });
  assert.equal(overridden.whisper, '/explicit/whisper');
  assert.equal(overridden.edgeTts, '/explicit/tts');
  assert.equal(overridden.model, '/explicit/model');
});

test('edge-tts falls back to PATH and discovery skips directories', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'skipper-path-fallback-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  mkdirSync(path.join(first, `whisper-cli${suffix}`), { recursive: true });
  mkdirSync(second);
  writeFileSync(path.join(second, `whisper-cli${suffix}`), 'fixture');
  writeFileSync(path.join(second, `edge-tts${suffix}`), 'fixture');
  const found = localVoicePaths(root, { PATH: `${first}${path.delimiter}${second}` });
  assert.equal(found.whisper, path.join(second, `whisper-cli${suffix}`));
  assert.equal(found.edgeTts, path.join(second, `edge-tts${suffix}`));
});

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

test('Whisper encodes a window sized to the recording, not a fixed 30 seconds', async () => {
  const { wavSeconds, audioContext } = await import('../src/speech.js');
  const wav = (seconds, rate = 16000) => {
    const data = Math.round(seconds * rate) * 2;
    const b = Buffer.alloc(44 + data);
    b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'ascii');
    b.write('fmt ', 12, 'ascii'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
    b.write('data', 36, 'ascii'); b.writeUInt32LE(data, 40);
    return b;
  };
  assert.ok(Math.abs(wavSeconds(wav(3.7)) - 3.7) < 0.001);
  assert.equal(wavSeconds(Buffer.from('not audio at all, clearly not a wav file header')), null);
  // Short questions get a much smaller window, with room to spare (50 frames per second).
  assert.ok(audioContext(3.7) < 1500 && audioContext(3.7) > 3.7 * 50 + 200);
  assert.ok(audioContext(5.9) > 5.9 * 50 + 200);
  assert.equal(audioContext(0.4), 512);
  assert.equal(audioContext(45), 1500);
  assert.equal(audioContext(null), 0);
  // Uzbek keeps a wider window.
  assert.ok(audioContext(5.9, 'uz-UZ') >= 1000 && audioContext(5.9, 'uz-UZ') > audioContext(5.9));
});

test('local voice passes answer text as one argument, even when it starts with a dash', { skip: process.platform === 'win32' && 'needs a POSIX executable' }, async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const { mkdtempSync, writeFileSync, chmodSync, readFileSync } = await import('node:fs');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'skipper-tts-'));
  const argsFile = path.join(dir, 'args.json');
  const fake = path.join(dir, 'edge-tts');
  writeFileSync(fake, `#!${process.execPath}\nconst a=process.argv.slice(2);require('fs').writeFileSync(${JSON.stringify(argsFile)},JSON.stringify(a));require('fs').writeFileSync(a[a.indexOf('--write-media')+1],'mp3');\n`);
  chmodSync(fake, 0o755);
  const { synthesize: speak } = await import('../src/speech.js');
  const result = await speak({ provider: 'local', edgeTts: fake, voices: VOICES }, '--help me out', { language: 'en-US' });
  assert.equal(result.audio.toString(), 'mp3');
  const args = JSON.parse(readFileSync(argsFile, 'utf8'));
  assert.ok(args.includes('--text=--help me out'), JSON.stringify(args));
});
