import 'dart:async';
import 'dart:collection';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:just_audio/just_audio.dart';
import 'package:record/record.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../core/format.dart';
import '../state/providers.dart';
import 'live_audio.dart';

enum VoicePhase { idle, listening, thinking, speaking }

class Proposal {
  const Proposal({required this.id, required this.sessionId, required this.text, this.status = 'pending'});
  final String id, sessionId, text;
  final String status; // pending | sending | sent | cancelled | failed

  Proposal withStatus(String status) => Proposal(id: id, sessionId: sessionId, text: text, status: status);
}

class VoiceTurn {
  const VoiceTurn({required this.role, this.text = '', this.status, this.error, this.proposals = const [], this.sessionIds = const []});
  final String role; // user | agent
  final String text;
  final String? status, error;
  final List<Proposal> proposals;
  final List<String> sessionIds;

  VoiceTurn copyWith({String? text, String? status, bool clearStatus = false, String? error, List<Proposal>? proposals, List<String>? sessionIds}) => VoiceTurn(
        role: role,
        text: text ?? this.text,
        status: clearStatus ? null : (status ?? this.status),
        error: error ?? this.error,
        proposals: proposals ?? this.proposals,
        sessionIds: sessionIds ?? this.sessionIds,
      );
}

class VoiceState {
  const VoiceState({this.phase = VoicePhase.idle, this.turns = const [], this.heard = '', this.speakAloud = true, this.micError, this.soundLevel = 0, this.language = 'auto', this.cloud = false, this.voices = const {}, this.voiceOptions = const {}, this.live = false});
  final VoicePhase phase;
  final List<VoiceTurn> turns;
  final String heard;
  final bool speakAloud;
  final String? micError;
  final double soundLevel;

  /// auto | uz-UZ | en-US
  final String language;

  /// True when the Mac has neural voices set up (needed for Uzbek).
  final bool cloud;

  /// Chosen voice per language (language -> voice id).
  final Map<String, String> voices;

  /// Voices the Mac offers, per language.
  final Map<String, List<VoiceOption>> voiceOptions;

  /// Hands-free conversation: the microphone stays open, and talking over Skipper interrupts it.
  final bool live;

  VoiceState copyWith({VoicePhase? phase, List<VoiceTurn>? turns, String? heard, bool? speakAloud, String? micError, bool clearMicError = false, double? soundLevel, String? language, bool? cloud, Map<String, String>? voices, Map<String, List<VoiceOption>>? voiceOptions, bool? live}) => VoiceState(
        phase: phase ?? this.phase,
        turns: turns ?? this.turns,
        heard: heard ?? this.heard,
        speakAloud: speakAloud ?? this.speakAloud,
        micError: clearMicError ? null : (micError ?? this.micError),
        soundLevel: soundLevel ?? this.soundLevel,
        language: language ?? this.language,
        cloud: cloud ?? this.cloud,
        voices: voices ?? this.voices,
        voiceOptions: voiceOptions ?? this.voiceOptions,
        live: live ?? this.live,
      );
}

/// Sessions whose titles appear in the answer, in the order they are mentioned.
List<String> mentionedSessions(String text, List<SessionSummary> sessions) {
  final lower = text.toLowerCase();
  final hits = <(int, String)>[];
  for (final s in sessions) {
    final title = s.title.toLowerCase();
    if (title.length < 4) continue;
    final index = lower.indexOf(title);
    if (index >= 0) hits.add((index, s.id));
  }
  hits.sort((a, b) => a.$1.compareTo(b.$1));
  return [for (final h in hits) h.$2].take(4).toList();
}

/// Silence detection for recordings: stop after this long below the threshold, once speech was heard.
const _silenceDb = -38.0;
const _silenceAfter = Duration(milliseconds: 1600);

class VoiceController extends Notifier<VoiceState> {
  final _speech = SpeechToText();
  final _tts = FlutterTts();
  final _recorder = AudioRecorder();
  final _player = AudioPlayer();
  final _queue = Queue<({String text, Future<List<int>?>? audio})>();
  StreamSubscription? _amplitude;
  String? _recordingPath;
  DateTime? _lastVoice;
  bool _heardVoice = false;
  bool _speechReady = false;
  bool _speaking = false;
  String? _conversationId;
  StreamSubscription? _answer;
  StreamSubscription<Uint8List>? _mic;
  final _vad = VoiceActivityDetector();
  Future<void> _utterances = Future.value();
  String _spokenLanguage = 'en-US';
  DateTime _levelShownAt = DateTime(0);

  bool get _live => state.live;

  /// Where the conversation rests between turns.
  VoicePhase get _rest => _live ? VoicePhase.listening : VoicePhase.idle;

  static const _speakKey = 'skipper.voice.speak';
  static const _languageKey = 'skipper.voice.language';
  static const _voiceKey = 'skipper.voice.speaker';

  @override
  VoiceState build() {
    ref.onDispose(() {
      _answer?.cancel();
      _mic?.cancel();
      _amplitude?.cancel();
      _speech.cancel();
      _tts.stop();
      _recorder.dispose();
      _player.dispose();
    });
    _initTts();
    SharedPreferences.getInstance().then((prefs) => state = state.copyWith(
          speakAloud: prefs.getBool(_speakKey) ?? true,
          language: prefs.getString(_languageKey) ?? 'auto',
          voices: {
            if (prefs.getString('$_voiceKey.uz-UZ') case final uz?) 'uz-UZ': uz,
            if (prefs.getString('$_voiceKey.en-US') case final en?) 'en-US': en,
          },
        ));
    _refreshCloud();
    return const VoiceState();
  }

  Future<void> _initTts() async {
    await _tts.setSharedInstance(true);
    await _tts.setIosAudioCategory(IosTextToSpeechAudioCategory.playback, [IosTextToSpeechAudioCategoryOptions.duckOthers], IosTextToSpeechAudioMode.spokenAudio);
    await _tts.setSpeechRate(0.52);
    await _tts.awaitSpeakCompletion(true);
  }

  Future<void> setSpeakAloud(bool value) async {
    state = state.copyWith(speakAloud: value);
    if (!value) await stopSpeaking();
    (await SharedPreferences.getInstance()).setBool(_speakKey, value);
  }

  Future<void> _refreshCloud() async {
    final client = ref.read(clientProvider);
    if (client == null) return;
    try {
      final info = await client.info();
      state = state.copyWith(cloud: info.cloudVoice, voiceOptions: info.voices);
    } catch (_) {}
  }

  Future<void> setVoice(String language, String voiceId) async {
    state = state.copyWith(voices: {...state.voices, language: voiceId});
    (await SharedPreferences.getInstance()).setString('$_voiceKey.$language', voiceId);
  }

  /// Plays a short sample with the chosen voice.
  Future<void> previewVoice(String language, String voiceId) async {
    final client = ref.read(clientProvider);
    if (client == null) return;
    await stopSpeaking();
    final sample = language == 'uz-UZ' ? 'Salom! Men sizning sessiyalaringiz haqida gapirib beraman.' : 'Hi! I will tell you what your sessions are doing.';
    final audio = client.speak(sample, voices: {language: voiceId}).then<List<int>?>((b) => b).catchError((_) => null);
    _queue.add((text: sample, audio: audio));
    if (!_speaking) _drain();
  }

  Future<void> setLanguage(String language) async {
    state = state.copyWith(language: language);
    (await SharedPreferences.getInstance()).setString(_languageKey, language);
  }

  /// Uzbek needs the Mac's recognizer; English alone can stay on the phone.
  bool get _useCloudInput => state.cloud && state.language != 'en-US';

  Future<bool> _ensureSpeech() async {
    if (_speechReady) return true;
    _speechReady = await _speech.initialize(
      onError: (error) => state = state.copyWith(phase: VoicePhase.idle, micError: 'Could not hear you (${error.errorMsg}). Try again.'),
      onStatus: (status) {
        if ((status == 'done' || status == 'notListening') && state.phase == VoicePhase.listening) _finishListening();
      },
    );
    if (!_speechReady) state = state.copyWith(micError: 'Allow microphone and speech recognition for Skipper in Settings.');
    return _speechReady;
  }

  Future<void> startListening() async {
    await stopSpeaking();
    await _answer?.cancel();
    await _refreshCloud();
    if (!_useCloudInput && state.language == 'uz-UZ') {
      state = state.copyWith(micError: 'Uzbek voice is not set up on your Mac yet. Open Settings in this app to see how.');
      return;
    }
    HapticFeedback.mediumImpact();
    if (_useCloudInput) return _startRecording();
    if (!await _ensureSpeech()) return;
    state = state.copyWith(phase: VoicePhase.listening, heard: '', clearMicError: true);
    await _speech.listen(
      onResult: (result) {
        state = state.copyWith(heard: result.recognizedWords);
        if (result.finalResult) _finishListening();
      },
      onSoundLevelChange: (level) => state = state.copyWith(soundLevel: level),
      listenOptions: SpeechListenOptions(
        partialResults: true,
        listenMode: ListenMode.dictation,
        pauseFor: const Duration(seconds: 2),
        listenFor: const Duration(minutes: 1),
        localeId: 'en_US',
        autoPunctuation: true,
        enableHapticFeedback: false,
      ),
    );
  }

  Future<void> _startRecording() async {
    if (!await _recorder.hasPermission()) {
      state = state.copyWith(micError: 'Allow the microphone for Skipper in Settings.');
      return;
    }
    _recordingPath = '${Directory.systemTemp.path}/skipper-question.wav';
    _heardVoice = false;
    _lastVoice = DateTime.now();
    await _recorder.start(const RecordConfig(encoder: AudioEncoder.wav, sampleRate: 16000, numChannels: 1, noiseSuppress: true, echoCancel: true), path: _recordingPath!);
    state = state.copyWith(phase: VoicePhase.listening, heard: '', clearMicError: true);
    final started = DateTime.now();
    _amplitude = _recorder.onAmplitudeChanged(const Duration(milliseconds: 120)).listen((amp) {
      state = state.copyWith(soundLevel: amp.current);
      final now = DateTime.now();
      if (amp.current > _silenceDb) {
        _heardVoice = true;
        _lastVoice = now;
      }
      final quiet = now.difference(_lastVoice!);
      if ((_heardVoice && quiet > _silenceAfter) || now.difference(started) > const Duration(seconds: 90) || (!_heardVoice && quiet > const Duration(seconds: 8))) {
        _finishListening();
      }
    });
  }

  bool _finishing = false;
  Future<void> _finishListening() async {
    if (_finishing || state.phase != VoicePhase.listening) return;
    _finishing = true;
    try {
      if (_recordingPath != null && await _recorder.isRecording()) {
        await _amplitude?.cancel();
        final path = await _recorder.stop();
        final heardVoice = _heardVoice;
        state = state.copyWith(phase: VoicePhase.thinking, heard: 'Recognizing…', soundLevel: 0);
        if (path == null || !heardVoice) {
          state = state.copyWith(phase: VoicePhase.idle, heard: '');
          return;
        }
        final client = ref.read(clientProvider);
        if (client == null) return;
        try {
          final bytes = await File(path).readAsBytes();
          final result = await client.transcribe(bytes, language: state.language == 'auto' ? null : state.language);
          state = state.copyWith(phase: VoicePhase.idle, heard: '');
          if (result.text.isEmpty) {
            state = state.copyWith(micError: 'I did not catch that. Try again.');
          } else {
            ask(result.text);
          }
        } on SkipperException catch (e) {
          state = state.copyWith(phase: VoicePhase.idle, heard: '', micError: e.message);
        }
        return;
      }
      await _speech.stop();
      final text = state.heard.trim();
      state = state.copyWith(phase: VoicePhase.idle, soundLevel: 0);
      if (text.isNotEmpty) ask(text);
    } finally {
      _finishing = false;
    }
  }

  /// Tapping the orb while listening sends what was heard so far.
  Future<void> stopListening() => _finishListening();

  Future<void> cancelListening() async {
    await _amplitude?.cancel();
    if (await _recorder.isRecording()) await _recorder.cancel();
    await _speech.cancel();
    state = state.copyWith(phase: VoicePhase.idle, heard: '', soundLevel: 0);
  }

  Future<void> ask(String text) async {
    final client = ref.read(clientProvider);
    if (client == null) return;
    await stopSpeaking();
    await _answer?.cancel();
    final turns = [...state.turns, VoiceTurn(role: 'user', text: text), const VoiceTurn(role: 'agent', status: 'Thinking')];
    state = state.copyWith(turns: turns, phase: VoicePhase.thinking, heard: '');
    final sentences = SentenceBuffer();
    final index = turns.length - 1;

    void update(VoiceTurn Function(VoiceTurn) change) {
      final list = [...state.turns];
      if (index < list.length) list[index] = change(list[index]);
      state = state.copyWith(turns: list);
    }

    _answer = client.ask(text, conversationId: _conversationId).listen(
      (event) {
        final data = event.json;
        switch (event.type) {
          case 'conversation':
            _conversationId = data['id'] as String?;
          case 'status':
            update((t) => t.copyWith(status: data['text'] as String?));
          case 'delta':
            final chunk = data['text'] as String? ?? '';
            update((t) => t.copyWith(text: t.text + chunk, clearStatus: true));
            for (final sentence in sentences.add(chunk)) {
              _speak(sentence);
            }
          case 'proposal':
            final proposal = Proposal(id: data['id'] as String, sessionId: data['sessionId'] as String, text: data['text'] as String);
            update((t) => t.copyWith(proposals: [...t.proposals, proposal]));
            HapticFeedback.selectionClick();
          case 'done':
            final rest = sentences.flush();
            if (rest.isNotEmpty) _speak(rest);
            final sessions = ref.read(liveProvider).sessions;
            update((t) => t.copyWith(clearStatus: true, sessionIds: mentionedSessions(t.text, sessions)));
            if (!_speaking && _queue.isEmpty) state = state.copyWith(phase: _rest);
          case 'error':
            update((t) => t.copyWith(clearStatus: true, error: data['message'] as String? ?? 'Something went wrong.'));
            state = state.copyWith(phase: _rest);
        }
      },
      onError: (Object error) {
        update((t) => t.copyWith(clearStatus: true, error: error is SkipperException ? error.message : 'Lost the connection to your Mac.'));
        state = state.copyWith(phase: _rest);
      },
    );
  }

  void _speak(String sentence) {
    if (!state.speakAloud) return;
    final client = ref.read(clientProvider);
    // Fetch each sentence's audio right away so playback does not wait between sentences.
    final audio = state.cloud && client != null ? client.speak(sentence, voices: state.voices).then<List<int>?>((b) => b).catchError((_) => null) : null;
    _queue.add((text: sentence, audio: audio));
    if (!_speaking) _drain();
  }

  Future<void> _drain() async {
    _speaking = true;
    var index = 0;
    while (_queue.isNotEmpty) {
      final item = _queue.removeFirst();
      if (state.phase != VoicePhase.listening) state = state.copyWith(phase: VoicePhase.speaking);
      final bytes = item.audio == null ? null : await item.audio;
      if (!_speaking) break;
      if (bytes != null && bytes.isNotEmpty) {
        final file = File('${Directory.systemTemp.path}/skipper-answer-${index++ % 8}.mp3');
        await file.writeAsBytes(bytes, flush: true);
        await _player.setFilePath(file.path);
        await _player.play();
        await _player.processingStateStream.firstWhere((s) => s == ProcessingState.completed || s == ProcessingState.idle);
      } else {
        await _tts.speak(item.text);
      }
    }
    _speaking = false;
    if (state.phase == VoicePhase.speaking) state = state.copyWith(phase: _rest);
  }

  Future<void> stopSpeaking() async {
    _queue.clear();
    _speaking = false;
    await _player.stop();
    if (!_live) await _tts.stop();
    if (state.phase == VoicePhase.speaking) state = state.copyWith(phase: _rest);
  }

  void _setProposal(String id, String status) {
    state = state.copyWith(turns: [
      for (final t in state.turns) t.copyWith(proposals: [for (final p in t.proposals) p.id == id ? p.withStatus(status) : p]),
    ]);
  }

  Future<void> confirm(Proposal proposal) async {
    final client = ref.read(clientProvider);
    if (client == null) return;
    _setProposal(proposal.id, 'sending');
    final target = ref.read(liveProvider).sessions.where((s) => s.id == proposal.sessionId).firstOrNull?.title;
    if (_live) _say(livePhrase('sending', _spokenLanguage));
    try {
      // Delivery can take a while; the conversation carries on meanwhile.
      await client.confirmProposal(proposal.id);
      _setProposal(proposal.id, 'sent');
      HapticFeedback.mediumImpact();
      if (_live) _say(livePhrase('sent', _spokenLanguage, target: target));
    } catch (_) {
      _setProposal(proposal.id, 'failed');
      if (_live) _say(livePhrase('failed', _spokenLanguage));
    }
  }

  void cancel(Proposal proposal) => _setProposal(proposal.id, 'cancelled');

  /// Something Skipper says on its own, outside an answer.
  void _say(String text) {
    if (text.isEmpty) return;
    _speak(text);
  }

  // ---- Live mode ----

  /// Live mode needs the Mac's recognizer, which hears both languages from a continuous stream.
  bool get canGoLive => state.cloud;

  /// The mic button: a hands-free conversation when the Mac can hear it, otherwise one question.
  Future<void> talk() async {
    await _refreshCloud();
    return state.cloud ? startLive() : startListening();
  }

  Future<void> startLive() async {
    if (_live) return;
    await stopSpeaking();
    await cancelListening();
    await _refreshCloud();
    if (!state.cloud) {
      state = state.copyWith(micError: 'Hands-free needs voice set up on your Mac. Tap the mic to talk instead.');
      return;
    }
    if (!await _recorder.hasPermission()) {
      state = state.copyWith(micError: 'Allow the microphone for Skipper in Settings.');
      return;
    }
    final Stream<Uint8List> stream;
    try {
      // Streaming is what turns on the iPhone's echo cancellation, so Skipper does not hear itself.
      stream = await _recorder.startStream(const RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: 16000,
        numChannels: 1,
        echoCancel: true,
        noiseSuppress: true,
        iosConfig: IosRecordConfig(categoryOptions: [IosAudioCategoryOption.defaultToSpeaker, IosAudioCategoryOption.allowBluetooth]),
      ));
    } catch (e) {
      state = state.copyWith(micError: 'Could not open the microphone.');
      return;
    }
    _vad.reset();
    HapticFeedback.mediumImpact();
    state = state.copyWith(live: true, phase: VoicePhase.listening, heard: '', clearMicError: true);
    _mic = stream.listen(_onMic, onError: (_) => stopLive(error: 'The microphone stopped.'), onDone: () {
      if (_live) stopLive();
    });
  }

  Future<void> stopLive({String? error}) async {
    if (!_live) return;
    state = state.copyWith(live: false, phase: VoicePhase.idle, heard: '', soundLevel: 0, micError: error);
    await _mic?.cancel();
    _mic = null;
    _vad.reset();
    try {
      if (await _recorder.isRecording()) await _recorder.stop();
    } catch (_) {}
  }

  void _onMic(Uint8List chunk) {
    if (!_live) return;
    _vad.strict = _speaking;
    for (final event in _vad.add(chunk)) {
      switch (event) {
        case SpeechStarted():
          if (_speaking) {
            // The user talked over Skipper: stop, and drop the rest of that answer.
            stopSpeaking();
            _answer?.cancel();
            _clearThinking();
            HapticFeedback.selectionClick();
          }
          state = state.copyWith(phase: VoicePhase.listening, heard: '');
        case SpeechEnded(:final pcm):
          _utterances = _utterances.then((_) => _handleUtterance(pcm));
      }
    }
    final now = DateTime.now();
    if (now.difference(_levelShownAt) > const Duration(milliseconds: 90)) {
      _levelShownAt = now;
      state = state.copyWith(soundLevel: _vad.levelDb);
    }
  }

  void _clearThinking() {
    state = state.copyWith(turns: [for (final t in state.turns) t.status != null ? t.copyWith(clearStatus: true) : t]);
  }

  Future<void> _handleUtterance(Uint8List pcm) async {
    if (!_live || pcmDuration(pcm) < const Duration(milliseconds: 350)) return;
    final client = ref.read(clientProvider);
    if (client == null) return;
    state = state.copyWith(phase: VoicePhase.thinking, heard: 'Recognizing…');
    final ({String text, String language}) result;
    try {
      result = await client.transcribe(pcm16ToWav(pcm), language: state.language == 'auto' ? null : state.language);
    } on SkipperException catch (e) {
      if (_live) state = state.copyWith(phase: VoicePhase.listening, heard: '', micError: e.message);
      return;
    }
    if (!_live) return;
    final text = result.text.trim();
    if (text.isEmpty) {
      if (state.phase == VoicePhase.thinking) state = state.copyWith(phase: VoicePhase.listening, heard: '');
      return;
    }
    _spokenLanguage = result.language;
    state = state.copyWith(heard: '', clearMicError: true);

    final pending = state.turns.lastOrNull?.proposals.where((p) => p.status == 'pending').lastOrNull;
    if (pending != null) {
      final intent = classifyReply(text);
      if (intent != ReplyIntent.other) {
        state = state.copyWith(turns: [...state.turns, VoiceTurn(role: 'user', text: text)], phase: VoicePhase.listening);
        if (intent == ReplyIntent.yes) {
          confirm(pending);
        } else {
          cancel(pending);
          _say(livePhrase('cancelled', _spokenLanguage));
        }
        return;
      }
    }
    ask(text);
  }

  void newConversation() {
    _answer?.cancel();
    stopSpeaking();
    _conversationId = null;
    state = state.copyWith(turns: const [], phase: VoicePhase.idle, heard: '');
  }
}

final voiceProvider = NotifierProvider<VoiceController, VoiceState>(VoiceController.new);
