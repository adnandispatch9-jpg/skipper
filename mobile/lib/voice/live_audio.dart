import 'dart:math' as math;
import 'dart:typed_data';

/// What the detector noticed in the latest audio.
sealed class VadEvent {
  const VadEvent();
}

/// Someone started talking.
class SpeechStarted extends VadEvent {
  const SpeechStarted();
}

/// They stopped; [pcm] is the whole utterance (16-bit mono), including a little audio from just before it started.
class SpeechEnded extends VadEvent {
  const SpeechEnded(this.pcm);
  final Uint8List pcm;
}

/// Finds speech in a continuous 16-bit mono PCM stream.
///
/// The noise floor adapts to the room. While Skipper is talking, [strict] raises the bar so its own
/// voice leaking past echo cancellation is not taken for the user interrupting.
class VoiceActivityDetector {
  VoiceActivityDetector({
    this.sampleRate = 16000,
    this.frameMs = 20,
    this.startAfterMs = 200,
    this.strictStartAfterMs = 360,
    this.endAfterMs = 850,
    this.preRollMs = 320,
    this.maxUtteranceMs = 60000,
    this.marginDb = 12,
    this.strictMarginDb = 20,
    this.minThresholdDb = -48,
    this.strictMinThresholdDb = -34,
  });

  final int sampleRate, frameMs, startAfterMs, strictStartAfterMs, endAfterMs, preRollMs, maxUtteranceMs;
  final double marginDb, strictMarginDb, minThresholdDb, strictMinThresholdDb;

  /// True while Skipper is speaking.
  bool strict = false;

  double _floorDb = -60;
  double levelDb = -90;
  bool _inSpeech = false;
  int _loudMs = 0, _quietMs = 0, _speechMs = 0;
  final _pending = BytesBuilder(copy: false);
  final List<Uint8List> _preRoll = [];
  final _utterance = BytesBuilder(copy: false);

  int get _frameBytes => sampleRate * frameMs ~/ 1000 * 2;
  bool get inSpeech => _inSpeech;
  double get thresholdDb => strict ? math.max(_floorDb + strictMarginDb, strictMinThresholdDb) : math.max(_floorDb + marginDb, minThresholdDb);

  /// Feeds raw bytes from the microphone and returns anything that happened.
  List<VadEvent> add(Uint8List chunk) {
    final events = <VadEvent>[];
    _pending.add(chunk);
    var bytes = _pending.takeBytes();
    var offset = 0;
    while (bytes.length - offset >= _frameBytes) {
      final frame = Uint8List.sublistView(bytes, offset, offset + _frameBytes);
      offset += _frameBytes;
      final event = _frame(Uint8List.fromList(frame));
      if (event != null) events.add(event);
    }
    if (offset < bytes.length) _pending.add(Uint8List.sublistView(bytes, offset));
    return events;
  }

  /// Forgets any utterance in progress (for example after the user cancels).
  void reset() {
    _inSpeech = false;
    _loudMs = _quietMs = _speechMs = 0;
    _preRoll.clear();
    _utterance.clear();
  }

  VadEvent? _frame(Uint8List frame) {
    levelDb = frameDb(frame);
    final loud = levelDb > thresholdDb;
    if (!loud && !_inSpeech) {
      // Track the room: fall quickly to quieter levels, rise slowly so speech does not become "noise".
      _floorDb = levelDb < _floorDb ? _floorDb * 0.7 + levelDb * 0.3 : _floorDb * 0.995 + levelDb * 0.005;
    }

    if (!_inSpeech) {
      _preRoll.add(frame);
      while (_preRoll.length * frameMs > preRollMs + (strict ? strictStartAfterMs : startAfterMs)) {
        _preRoll.removeAt(0);
      }
      _loudMs = loud ? _loudMs + frameMs : 0;
      if (_loudMs >= (strict ? strictStartAfterMs : startAfterMs)) {
        _inSpeech = true;
        _quietMs = 0;
        _speechMs = _loudMs;
        for (final f in _preRoll) {
          _utterance.add(f);
        }
        _preRoll.clear();
        return const SpeechStarted();
      }
      return null;
    }

    _utterance.add(frame);
    _speechMs += frameMs;
    _quietMs = loud ? 0 : _quietMs + frameMs;
    if (_quietMs >= endAfterMs || _speechMs >= maxUtteranceMs) {
      final pcm = _utterance.takeBytes();
      reset();
      return SpeechEnded(pcm);
    }
    return null;
  }
}

/// Loudness of one frame of 16-bit little-endian PCM, in dBFS.
double frameDb(Uint8List frame) {
  final samples = frame.length ~/ 2;
  if (samples == 0) return -90;
  final data = ByteData.sublistView(frame);
  var sum = 0.0;
  for (var i = 0; i < samples; i++) {
    final s = data.getInt16(i * 2, Endian.little) / 32768.0;
    sum += s * s;
  }
  final rms = math.sqrt(sum / samples);
  return rms <= 0.00003 ? -90 : 20 * math.log(rms) / math.ln10;
}

/// Wraps 16-bit mono PCM in a WAV header so the Mac can transcribe it.
Uint8List pcm16ToWav(Uint8List pcm, {int sampleRate = 16000}) {
  final header = ByteData(44);
  void ascii(int at, String s) {
    for (var i = 0; i < s.length; i++) {
      header.setUint8(at + i, s.codeUnitAt(i));
    }
  }

  ascii(0, 'RIFF');
  header.setUint32(4, 36 + pcm.length, Endian.little);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  header.setUint32(16, 16, Endian.little);
  header.setUint16(20, 1, Endian.little); // PCM
  header.setUint16(22, 1, Endian.little); // mono
  header.setUint32(24, sampleRate, Endian.little);
  header.setUint32(28, sampleRate * 2, Endian.little);
  header.setUint16(32, 2, Endian.little);
  header.setUint16(34, 16, Endian.little);
  ascii(36, 'data');
  header.setUint32(40, pcm.length, Endian.little);
  return (BytesBuilder(copy: false)
        ..add(header.buffer.asUint8List())
        ..add(pcm))
      .takeBytes();
}

/// Duration of 16-bit mono PCM.
Duration pcmDuration(Uint8List pcm, {int sampleRate = 16000}) => Duration(microseconds: pcm.length ~/ 2 * 1000000 ~/ sampleRate);

enum ReplyIntent { yes, no, other }

const _yes = {
  'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'send', 'send it', 'go', 'go ahead', 'do it', 'please', 'correct', 'right', 'confirm', 'absolutely', 'of course',
  'ha', 'xa', 'hа', 'albatta', 'mayli', 'yubor', 'yubora qol', 'yuboring', "jo'nat", 'jonat', "jo'nating", 'jonating', 'boʻpti', "bo'pti", 'bopti', 'to\'g\'ri', 'togri', 'xo\'p', 'xop', 'hop', 'ha yubor', 'ha yuboring',
};
const _no = {
  'no', 'nope', 'nah', 'cancel', 'stop', "don't", 'dont', 'do not', 'not now', 'never mind', 'nevermind', 'wait', 'hold on', "don't send", 'dont send',
  "yo'q", 'yoq', 'yo‘q', 'yoʻq', 'kerak emas', 'kerakmas', 'yubormang', 'yuborma', "jo'natma", 'jonatma', 'bekor', 'bekor qil', 'toʻxta', "to'xta", 'toxta', 'shoshma',
};

/// Whether a short spoken reply accepts or declines the message Skipper just read back.
/// Anything longer or unclear is treated as a new request.
ReplyIntent classifyReply(String text) {
  final clean = text.toLowerCase().replaceAll(RegExp(r'[.,!?;:"“”«»]'), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();
  if (clean.isEmpty) return ReplyIntent.other;
  final words = clean.split(' ');
  if (words.length > 5) return ReplyIntent.other;
  bool hits(Set<String> phrases) => phrases.contains(clean) || words.any(phrases.contains) || phrases.any((p) => p.contains(' ') && clean.contains(p));
  // "No, don't send" and "yes... no wait" both mean no.
  if (hits(_no)) return ReplyIntent.no;
  if (hits(_yes)) return ReplyIntent.yes;
  return ReplyIntent.other;
}

/// Short things Skipper says itself, in the language the user is speaking.
String livePhrase(String key, String language, {String? target}) {
  final uz = language.startsWith('uz');
  return switch (key) {
    'sending' => uz ? 'Yuboryapman.' : 'Sending it.',
    'sent' => uz ? 'Yuborildi${target == null ? '' : ': $target'}.' : 'Sent${target == null ? '' : ' to $target'}.',
    'failed' => uz ? 'Yubora olmadim.' : 'I could not send it.',
    'cancelled' => uz ? 'Mayli, yubormadim.' : 'Okay, I did not send it.',
    _ => '',
  };
}
