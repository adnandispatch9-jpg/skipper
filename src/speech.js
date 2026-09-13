// Cloud voice for languages the phone cannot do on-device (Uzbek above all), through
// Azure AI Speech. The key lives only on the Mac; the phone sends audio here.
// Free tier: 5 audio hours of recognition and 0.5M characters of neural voice a month.

import { readConfig } from './hooks.js';

export const VOICES = {
  'uz-UZ': 'uz-UZ-MadinaNeural',
  'en-US': 'en-US-AvaMultilingualNeural',
};
export const LANGUAGES = Object.keys(VOICES);
const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // about two minutes of 16 kHz mono WAV
const MAX_SPEAK_CHARS = 1200;

export async function speechConfig(dataDir, env = process.env) {
  if (env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION) return { key: env.AZURE_SPEECH_KEY, region: env.AZURE_SPEECH_REGION, voices: VOICES };
  const saved = (await readConfig(dataDir)).azureSpeech;
  if (saved && typeof saved.key === 'string' && typeof saved.region === 'string') {
    return { key: saved.key, region: saved.region, voices: { ...VOICES, ...(saved.voices || {}) } };
  }
  return null;
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
export async function synthesize(config, text, { language, fetchImpl = fetch } = {}) {
  if (!config) throw new SpeechError(503, 'Voice for Uzbek is not set up on your Mac. Run skipper voice setup.');
  const clean = String(text || '').trim().slice(0, MAX_SPEAK_CHARS);
  if (!clean) throw new SpeechError(400, 'Nothing to say');
  const lang = LANGUAGES.includes(language) ? language : detectLanguage(clean);
  const res = await fetchImpl(`https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': config.key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'skipper',
    },
    body: ssml(clean, lang, config.voices[lang]),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401 || res.status === 403) throw new SpeechError(502, 'The Azure Speech key on your Mac was rejected. Run skipper voice setup again.');
  if (res.status === 429) throw new SpeechError(429, 'The free Azure Speech allowance is used up for now.');
  if (!res.ok) throw new SpeechError(502, `Speech synthesis failed (${res.status})`);
  return { audio: Buffer.from(await res.arrayBuffer()), language: lang };
}
