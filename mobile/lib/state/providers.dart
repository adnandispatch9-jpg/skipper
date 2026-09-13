import 'dart:async';
import 'dart:convert';

import 'package:bonsoir/bonsoir.dart';
import 'package:flutter/material.dart' show ThemeMode;
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../core/format.dart';

const _pairingKey = 'skipper.pairing';

/// The paired Mac, kept in the iOS Keychain.
class PairingNotifier extends AsyncNotifier<PairingInfo?> {
  static const _storage = FlutterSecureStorage(iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device));

  @override
  Future<PairingInfo?> build() async {
    try {
      final raw = await _storage.read(key: _pairingKey);
      if (raw == null) return null;
      return PairingInfo.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  /// Checks the details against the Mac before saving them.
  Future<ServerInfo> pair(PairingInfo info) async {
    final client = SkipperClient(info);
    try {
      final server = await client.info();
      final named = PairingInfo(host: info.host, port: info.port, token: info.token, name: server.name);
      await _storage.write(key: _pairingKey, value: jsonEncode(named.toJson()));
      state = AsyncData(named);
      return server;
    } finally {
      client.close();
    }
  }

  bool _relocating = false;

  /// The Mac moved (new Wi-Fi address or port): find Skipper on the network again and keep the
  /// saved token if a Mac there accepts it. Returns true when the pairing was updated.
  Future<bool> relocate({Duration searchFor = const Duration(seconds: 6)}) async {
    final current = state.value;
    if (current == null || _relocating) return false;
    _relocating = true;
    final discovery = BonsoirDiscovery(type: '_skipper._tcp');
    final candidates = <PairingInfo>[];
    StreamSubscription? sub;
    try {
      await discovery.initialize();
      sub = discovery.eventStream?.listen((event) {
        switch (event) {
          case BonsoirDiscoveryServiceFoundEvent():
            discovery.serviceResolver.resolveService(event.service);
          case BonsoirDiscoveryServiceResolvedEvent():
            final host = event.service.host?.replaceFirst(RegExp(r'\.$'), '');
            if (host != null) candidates.add(PairingInfo(host: host, port: event.service.port, token: current.token, name: current.name));
          default:
        }
      });
      await discovery.start();
      await Future<void>.delayed(searchFor);
      for (final candidate in candidates) {
        if (candidate.host == current.host && candidate.port == current.port) continue;
        final client = SkipperClient(candidate);
        try {
          await pair(candidate);
          return true;
        } catch (_) {
          // Wrong Mac or a different token; try the next one.
        } finally {
          client.close();
        }
      }
      return false;
    } catch (_) {
      return false;
    } finally {
      await sub?.cancel();
      await discovery.stop();
      _relocating = false;
    }
  }

  Future<void> forget() async {
    await _storage.delete(key: _pairingKey);
    state = const AsyncData(null);
  }
}

final pairingProvider = AsyncNotifierProvider<PairingNotifier, PairingInfo?>(PairingNotifier.new);

final clientProvider = Provider<SkipperClient?>((ref) {
  final pairing = ref.watch(pairingProvider).value;
  if (pairing == null) return null;
  final client = SkipperClient(pairing);
  ref.onDispose(client.close);
  return client;
});

/// Permission prompts, questions and finished turns pushed by the Mac.
final alertBusProvider = Provider<StreamController<Map<String, dynamic>>>((ref) {
  final bus = StreamController<Map<String, dynamic>>.broadcast();
  ref.onDispose(bus.close);
  return bus;
});

enum LinkStatus { connecting, online, offline }

class LiveState {
  const LiveState({this.sessions = const [], this.now = 0, this.readOnly = false, this.status = LinkStatus.connecting, this.error});
  final List<SessionSummary> sessions;
  final int now;
  final bool readOnly;
  final LinkStatus status;
  final String? error;

  List<SessionSummary> get needsYou => [...sessions.where((s) => s.needsYou)]..sort((a, b) => stateRank(a.state).compareTo(stateRank(b.state)));
  List<SessionSummary> get inFlight => sessions.where((s) => s.state == 'working' || s.state == 'sleeping').toList();
  int count(String state) => sessions.where((s) => s.state == state).length;

  LiveState copyWith({List<SessionSummary>? sessions, int? now, bool? readOnly, LinkStatus? status, String? error, bool clearError = false}) =>
      LiveState(
        sessions: sessions ?? this.sessions,
        now: now ?? this.now,
        readOnly: readOnly ?? this.readOnly,
        status: status ?? this.status,
        error: clearError ? null : (error ?? this.error),
      );
}

/// Keeps the session list live: one event stream, refetch on change, reconnect with backoff.
class LiveNotifier extends Notifier<LiveState> {
  StreamSubscription? _events;
  Timer? _debounce, _retry, _tick;
  int _failures = 0;
  bool _paused = false;
  int _clockOffset = 0;

  @override
  LiveState build() {
    final client = ref.watch(clientProvider);
    ref.onDispose(_stop);
    if (client != null) Future.microtask(() => _start(client));
    return const LiveState();
  }

  int get serverNow => DateTime.now().millisecondsSinceEpoch + _clockOffset;

  void _stop() {
    _events?.cancel();
    _debounce?.cancel();
    _retry?.cancel();
    _tick?.cancel();
    _events = null;
  }

  Future<void> refresh() async {
    final client = ref.read(clientProvider);
    if (client == null) return;
    try {
      final result = await client.sessions();
      _clockOffset = result.now - DateTime.now().millisecondsSinceEpoch;
      state = state.copyWith(sessions: result.sessions, now: result.now, readOnly: result.readOnly, status: LinkStatus.online, clearError: true);
    } on SkipperException catch (e) {
      state = state.copyWith(status: LinkStatus.offline, error: e.message);
      if (e.unauthorized) _stop();
    }
  }

  void _start(SkipperClient client) {
    _stop();
    if (_paused) return;
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => state = state.copyWith(now: serverNow));
    refresh();
    _events = client.events().listen(
      (event) {
        _failures = 0;
        if (event.type == 'change') {
          _debounce?.cancel();
          _debounce = Timer(const Duration(milliseconds: 250), refresh);
        } else if (event.type == 'alert') {
          final alert = event.json;
          if (alert['kind'] == 'permission' || alert['kind'] == 'question') HapticFeedback.heavyImpact();
          ref.read(alertBusProvider).add(alert);
          refresh();
        }
      },
      onError: (_) => _scheduleRetry(client),
      onDone: () => _scheduleRetry(client),
      cancelOnError: true,
    );
  }

  void _scheduleRetry(SkipperClient client) {
    if (_paused) return;
    _failures++;
    // After a couple of failed attempts, check whether the Mac is simply somewhere else on the Wi-Fi now.
    if (_failures == 2 || _failures % 6 == 0) ref.read(pairingProvider.notifier).relocate();
    state = state.copyWith(status: LinkStatus.offline);
    final seconds = [1, 2, 5, 10, 20, 30][(_failures - 1).clamp(0, 5)];
    _retry?.cancel();
    _retry = Timer(Duration(seconds: seconds), () => _start(client));
  }

  /// Called from the app lifecycle: close the stream in the background to save battery.
  void setPaused(bool paused) {
    _paused = paused;
    final client = ref.read(clientProvider);
    if (paused) {
      _stop();
    } else if (client != null) {
      _start(client);
    }
  }

}

final liveProvider = NotifierProvider<LiveNotifier, LiveState>(LiveNotifier.new);

/// Dark by default, like the dashboard; remembered on the phone.
class ThemeModeNotifier extends Notifier<ThemeMode> {
  static const _key = 'skipper.theme';

  @override
  ThemeMode build() {
    SharedPreferences.getInstance().then((prefs) {
      final saved = prefs.getString(_key);
      if (saved != null) state = ThemeMode.values.firstWhere((m) => m.name == saved, orElse: () => ThemeMode.dark);
    });
    return ThemeMode.dark;
  }

  Future<void> set(ThemeMode mode) async {
    state = mode;
    (await SharedPreferences.getInstance()).setString(_key, mode.name);
  }
}

final themeModeProvider = NotifierProvider<ThemeModeNotifier, ThemeMode>(ThemeModeNotifier.new);
