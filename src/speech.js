// Voice for languages the phone cannot do on-device (Uzbek above all). The phone sends audio
// to the Mac. Two providers:
//  - azure: Azure AI Speech with a key (best Uzbek recognition; free tier 5 h + 0.5M chars a month)
//  - local: no account at all. Whisper (whisper.cpp) recognizes on the Mac, and the neural voices
//    are read with the edge-tts tool. Used automatically when those tools and the model are installed.

import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { readConfig } from './hooks.js';

/** Voices the listener can pick from, per language. */
export const VOICE_OPTIONS = {
  'uz-UZ': [
    { id: 'uz-UZ-MadinaNeural', name: 'Madina', gender: 'female' },
    { id: 'uz-UZ-SardorNeural', name: 'Sardor', gender: 'male' },
  ],
  'en-US': [
    { id: 'en-US-AvaMultilingualNeural', name: 'Ava', gender: 'female' },
    { id: 'en-US-AndrewMultilingualNeural', name: 'Andrew', gender: 'male' },
    { id: 'en-US-EmmaMultilingualNeural', name: 'Emma', gender: 'female' },
    { id: 'en-US-BrianMultilingualNeural', name: 'Brian', gender: 'male' },
  ],
};

export const VOICES = {
  'uz-UZ': 'uz-UZ-MadinaNeural',
  'en-US': 'en-US-AvaMultilingualNeural',
};
export const LANGUAGES = Object.keys(VOICES);
const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // about two minutes of 16 kHz mono WAV
const MAX_SPEAK_CHARS = 1200;

const WHISPER_PROMPT = 'Assalomu alaykum. Hozir sessiyalar holati haqida gaplashamiz: qaysi biri ishlayapti, qaysi biri ruxsat soʻrayapti.';

export function localVoicePaths(dataDir, env = process.env) {
  const whisper = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'].find((p) => existsSync(p)) || null;
  return {
    whisper: env.SKIPPER_WHISPER_BIN || whisper,
    model: env.SKIPPER_WHISPER_MODEL || path.join(dataDir, 'models', 'ggml-large-v3-turbo-q5_0.bin'),
    detectModel: [path.join(dataDir, 'models', 'ggml-base.bin'), path.join(os.homedir(), '.cache', 'whisper.cpp', 'ggml-base.bin')].find((p) => existsSync(p)) || null,
    edgeTts: env.SKIPPER_EDGE_TTS || path.join(dataDir, 'voice-venv', 'bin', 'edge-tts'),
    ffmpeg: ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => existsSync(p)) || 'ffmpeg',
  };
}

export async function speechConfig(dataDir, env = process.env) {
  if (env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION) return { provider: 'azure', key: env.AZURE_SPEECH_KEY, region: env.AZURE_SPEECH_REGION, voices: VOICES };
  const config = await readConfig(dataDir);
  const saved = config.azureSpeech;
  if (saved && typeof saved.key === 'string' && typeof saved.region === 'string') {
    return { provider: 'azure', key: saved.key, region: saved.region, voices: { ...VOICES, ...(saved.voices || {}) } };
  }
  const local = localVoicePaths(dataDir, env);
  if (config.localVoice !== false && local.whisper && existsSync(local.model) && existsSync(local.edgeTts)) {
    return { provider: 'local', ...local, voices: VOICES };
  }
  return null;
}

const run = (file, args, { timeout = 60_000 } = {}) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stderr })) : resolve({ stdout, stderr })));
  });

/** Whisper's language guess ("en", "tr", ...) from its log; the detection line is hidden by -np, so it is not passed. */
export function parseDetectedLanguage(log) {
  return /auto-detected language: (\w+)/.exec(log || '')?.[1] ?? null;
}

async function detectSpokenLanguage(config, input) {
  // A small model is enough to tell English apart and takes well under a second.
  const model = config.detectModel && existsSync(config.detectModel) ? config.detectModel : config.model;
  const result = await run(config.whisper, ['-m', model, '-l', 'auto', '-dl', '-f', input], { timeout: 30_000 }).catch((e) => ({ stdout: '', stderr: e.stderr || '' }));
  // Uzbek is often heard as Turkish or Kazakh; anything but English is treated as Uzbek.
  return parseDetectedLanguage(`${result.stdout}\n${result.stderr}`) === 'en' ? 'en-US' : 'uz-UZ';
}

async function transcribeLocal(config, audio, languages) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skipper-voice-'));
  try {
    const input = path.join(dir, 'question.wav');
    await fs.writeFile(input, audio);
    const whisper = (language, extra = []) =>
      run(config.whisper, ['-m', config.model, '-l', language, '-nt', '-np', '-f', input, ...extra], { timeout: 90_000 });
    let language = languages.length === 1 ? languages[0] : null;
    if (!language) language = await detectSpokenLanguage(config, input);
    const { stdout } = language === 'uz-UZ' ? await whisper('uz', ['--prompt', WHISPER_PROMPT]) : await whisper('en');
    return { text: stdout.replace(/\s+/g, ' ').trim(), language, confidence: 0.6 };
  } catch (error) {
    if (error instanceof SpeechError) throw error;
    throw new SpeechError(502, 'Speech recognition on your Mac failed. Run skipper voice status there.');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function synthesizeLocal(config, text, lang, voice) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skipper-voice-'));
  try {
    const output = path.join(dir, 'answer.mp3');
    await run(config.edgeTts, ['--voice', voice, `--text=${text}`, '--write-media', output], { timeout: 30_000 });
    return { audio: await fs.readFile(output), language: lang };
  } catch {
    throw new SpeechError(502, 'The voice service did not answer. Check the Mac is online.');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export function pickVoice(language, requested, config) {
  const options = VOICE_OPTIONS[language] || [];
  if (requested && options.some((o) => o.id === requested)) return requested;
  return config?.voices?.[language] || options[0]?.id;
}

const UZBEK_LETTERS = /[oOgG][ʻ‘'`’]/;
const UZBEK_WORDS = /\b(va|bu|u|men|sen|biz|siz|ular|nima|qanday|qachon|qayerda|kerak|emas|bor|yo'q|yoʻq|holda|uchun|bilan|lekin|ham|endi|hozir|sessiya|ishlayapti|tugadi|kutyapti|ruxsat|savol|javob|qaysi|necha|daqiqa|soat)\b/gi;
const ENGLISH_WORDS = /\b(the|and|is|are|what|which|how|when|session|needs|waiting|working|finished|running|minutes|you|your|it|to|of)\b/gi;

/** Rough language guess for a sentence, so each one is read by the right voice. */
export function detectLanguage(text) {
  const uz = (text.match(UZBEK_WORDS) || []).length + (UZBEK_LETTERS.test(text) ? 2 : 0) + (/[qxʻ]/i.test(text) && /\b\w*(lar|ni|ga|da|dan|ning)\b/i.test(text) ? 1 : 0);
  const en = (text.match(ENGLISH_WORDS) || []).length;
  return uz > en ? 'uz-UZ' : 'en-US';
}

const escapeXml = (s) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

export function ssml(text, language, voice) {
  return `<speak version="1.0" xml:lang="${language}"><voice name="${voice}"><lang xml:lang="${language}">${escapeXml(text)}</lang></voice></speak>`;
}

export class SpeechError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function recognizeOnce(config, audio, language, fetchImpl) {
  const url = `https://${config.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${language}&format=detailed&profanity=raw`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': config.key, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', Accept: 'application/json' },
    body: audio,
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401 || res.status === 403) throw new SpeechError(502, 'The Azure Speech key on your Mac was rejected. Run skipper voice setup again.');
  if (res.status === 429) throw new SpeechError(429, 'The free Azure Speech allowance is used up for now.');
  if (!res.ok) throw new SpeechError(502, `Speech recognition failed (${res.status})`);
  const data = await res.json();
  const best = Array.isArray(data.NBest) ? data.NBest[0] : null;
  const text = (best?.Display || data.DisplayText || '').trim();
  return { language, text, confidence: data.RecognitionStatus === 'Success' && text ? Number(best?.Confidence ?? 0.5) : 0 };
}

/**
 * Turns a short WAV recording into text. With several languages the recording is
 * recognized in each and the most confident result wins.
 */
export async function transcribe(config, audio, { languages = LANGUAGES, fetchImpl = fetch } = {}) {
  if (!config) throw new SpeechError(503, 'Voice for Uzbek is not set up on your Mac. Run skipper voice setup.');
  if (!audio?.length) throw new SpeechError(400, 'No audio received');
  if (audio.length > MAX_AUDIO_BYTES) throw new SpeechError(413, 'That recording is too long. Keep it under two minutes.');
  const wanted = languages.filter((l) => LANGUAGES.includes(l));
  if (!wanted.length) throw new SpeechError(400, 'Unsupported language');
  if (config.provider === 'local') return transcribeLocal(config, audio, wanted);
  const results = await Promise.all(wanted.map((l) => recognizeOnce(config, audio, l, fetchImpl)));
  // Uzbek recognizers sometimes return an English transcription with good confidence; break near-ties toward the text's own language.
  results.sort((a, b) => b.confidence - a.confidence);
  const [first, second] = results;
  if (second && first.confidence - second.confidence < 0.08 && second.text && detectLanguage(second.text) === second.language && detectLanguage(first.text) !== first.language) {
    return { text: second.text, language: second.language, confidence: second.confidence };
  }
  return { text: first.text, language: first.language, confidence: first.confidence };
}

/** Speaks text with a neural voice. Returns MP3 bytes. */
export async function synthesize(config, text, { language, voice, fetchImpl = fetch } = {}) {
  if (!config) throw new SpeechError(503, 'Voice for Uzbek is not set up on your Mac. Run skipper voice setup.');
  const clean = String(text || '').trim().slice(0, MAX_SPEAK_CHARS);
  if (!clean) throw new SpeechError(400, 'Nothing to say');
  const lang = LANGUAGES.includes(language) ? language : detectLanguage(clean);
  const chosen = pickVoice(lang, voice, config);
  if (config.provider === 'local') return synthesizeLocal(config, clean, lang, chosen);
  const res = await fetchImpl(`https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': config.key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'skipper',
    },
    body: ssml(clean, lang, chosen),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401 || res.status === 403) throw new SpeechError(502, 'The Azure Speech key on your Mac was rejected. Run skipper voice setup again.');
  if (res.status === 429) throw new SpeechError(429, 'The free Azure Speech allowance is used up for now.');
  if (!res.ok) throw new SpeechError(502, `Speech synthesis failed (${res.status})`);
  return { audio: Buffer.from(await res.arrayBuffer()), language: lang };
}
