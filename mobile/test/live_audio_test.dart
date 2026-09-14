import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:skipper_mobile/voice/live_audio.dart';

/// [ms] of a tone at roughly [db] dBFS (0 = silence).
Uint8List tone(int ms, double db, {int sampleRate = 16000}) {
  final samples = sampleRate * ms ~/ 1000;
  final data = ByteData(samples * 2);
  final amp = db <= -90 ? 0.0 : math.pow(10, db / 20) * math.sqrt2 * 32767;
  for (var i = 0; i < samples; i++) {
    data.setInt16(i * 2, (amp * math.sin(2 * math.pi * 220 * i / sampleRate)).round().clamp(-32768, 32767), Endian.little);
  }
  return data.buffer.asUint8List();
}

List<VadEvent> feed(VoiceActivityDetector vad, List<Uint8List> parts, {int chunk = 1100}) {
  final events = <VadEvent>[];
  for (final part in parts) {
    for (var i = 0; i < part.length; i += chunk) {
      events.addAll(vad.add(Uint8List.sublistView(part, i, math.min(i + chunk, part.length))));
    }
  }
  return events;
}

void main() {
  test('frame loudness follows the signal level', () {
    expect(frameDb(tone(20, -20)), closeTo(-20, 0.5));
    expect(frameDb(tone(20, -90)), -90);
  });

  test('detects an utterance after room noise and keeps the audio just before it', () {
    final vad = VoiceActivityDetector();
    final events = feed(vad, [tone(1000, -65), tone(900, -25), tone(1000, -65)]);
    expect(events.whereType<SpeechStarted>().length, 1);
    final ended = events.whereType<SpeechEnded>().single;
    final length = pcmDuration(ended.pcm).inMilliseconds;
    // speech + the pre-roll before it + the silence that ended it
    expect(length, greaterThan(900 + 250));
    expect(length, lessThan(900 + 320 + 200 + 900));
  });

  test('a short knock is not speech', () {
    final vad = VoiceActivityDetector();
    expect(feed(vad, [tone(600, -65), tone(100, -15), tone(1500, -65)]), isEmpty);
  });

  test('while Skipper talks, quieter leakage does not count as interrupting', () {
    final vad = VoiceActivityDetector()..strict = true;
    expect(feed(vad, [tone(600, -65), tone(1200, -40), tone(600, -65)]).whereType<SpeechStarted>(), isEmpty);
    expect(feed(vad, [tone(800, -18)]).whereType<SpeechStarted>().length, 1);
  });

  test('WAV header describes 16 kHz mono PCM', () {
    final pcm = tone(100, -20);
    final wav = pcm16ToWav(pcm);
    final h = ByteData.sublistView(wav);
    expect(String.fromCharCodes(wav.sublist(0, 4)), 'RIFF');
    expect(String.fromCharCodes(wav.sublist(8, 12)), 'WAVE');
    expect(h.getUint32(24, Endian.little), 16000);
    expect(h.getUint16(22, Endian.little), 1);
    expect(h.getUint32(40, Endian.little), pcm.length);
    expect(wav.length, 44 + pcm.length);
  });

  test('spoken yes and no in English and Uzbek', () {
    for (final yes in ['Yes', 'yeah send it', 'Ha', 'ha, yuboring', "jo'nat", 'Okay.', 'Mayli']) {
      expect(classifyReply(yes), ReplyIntent.yes, reason: yes);
    }
    for (final no in ['No', "no, don't send", "Yo'q", 'kerak emas', 'cancel', 'wait']) {
      expect(classifyReply(no), ReplyIntent.no, reason: no);
    }
    for (final other in ['', 'What is the checkout session doing right now?', 'tell the docs session to stop and open a PR instead please']) {
      expect(classifyReply(other), ReplyIntent.other, reason: other);
    }
  });

  test('confirmation phrases follow the language', () {
    expect(livePhrase('sent', 'en-US', target: 'Lutra'), 'Sent to Lutra.');
    expect(livePhrase('cancelled', 'uz-UZ'), 'Mayli, yubormadim.');
  });
}
