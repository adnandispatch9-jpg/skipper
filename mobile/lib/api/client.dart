import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/format.dart';
import '../core/sse.dart';
import 'models.dart';

class SkipperException implements Exception {
  const SkipperException(this.message, {this.status});
  final String message;
  final int? status;

  bool get unauthorized => status == 401;

  @override
  String toString() => message;
}

/// Talks to one Skipper server on the local network.
class SkipperClient {
  SkipperClient(this.pairing, {http.Client? httpClient}) : _http = httpClient ?? http.Client();

  final PairingInfo pairing;
  final http.Client _http;

  /// A phone keeps idle connections open; after the Mac restarts, the first request on a dead one
  /// fails immediately. Retrying once on a fresh connection hides that.
  Future<T> _retry<T>(Future<T> Function() request) async {
    try {
      return await request();
    } on SkipperException {
      rethrow;
    } on TimeoutException {
      rethrow;
    } catch (_) {
      await Future<void>.delayed(const Duration(milliseconds: 300));
      return request();
    }
  }

  Map<String, String> get _headers => {'Authorization': 'Bearer ${pairing.token}', 'Accept': 'application/json'};

  Uri _uri(String path, [Map<String, String>? query]) => pairing.baseUri.replace(path: path, queryParameters: query);

  Future<Map<String, dynamic>> _getJson(String path, [Map<String, String>? query]) async {
    final http.Response res;
    try {
      res = await _retry(() => _http.get(_uri(path, query), headers: _headers).timeout(const Duration(seconds: 8)));
    } on TimeoutException {
      throw const SkipperException('Your Mac did not answer. Is it awake and on the same Wi-Fi?');
    } catch (_) {
      throw const SkipperException('Could not reach your Mac. Check that Skipper is running and both are on the same Wi-Fi.');
    }
    return _decode(res);
  }

  Map<String, dynamic> _decode(http.Response res) {
    if (res.statusCode == 401) throw SkipperException('This phone is not paired with Skipper any more. Scan the code again.', status: 401);
    Map<String, dynamic>? body;
    try {
      final decoded = jsonDecode(utf8.decode(res.bodyBytes));
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {}
    if (res.statusCode >= 400) {
      throw SkipperException(body?['error'] as String? ?? 'Skipper answered ${res.statusCode}', status: res.statusCode);
    }
    return body ?? const {};
  }

  Future<Map<String, String>> _writeHeaders() async => {..._headers, 'Content-Type': 'application/json', 'X-Skipper': '1'};

  Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async {
    try {
      final headers = await _writeHeaders();
      final res = await _retry(() => _http.post(_uri(path), headers: headers, body: jsonEncode(body)).timeout(const Duration(seconds: 30)));
      return _decode(res);
    } on SkipperException {
      rethrow;
    } catch (_) {
      throw const SkipperException('Could not reach your Mac.');
    }
  }

  Future<ServerInfo> info() async => ServerInfo.fromJson(await _getJson('/api/info'));

  Future<({int now, List<SessionSummary> sessions, bool readOnly})> sessions() async {
    final json = await _getJson('/api/sessions');
    final list = [for (final s in (json['sessions'] as List? ?? const [])) SessionSummary.fromJson(s as Map<String, dynamic>)];
    return (now: (json['now'] as num?)?.toInt() ?? DateTime.now().millisecondsSinceEpoch, sessions: list, readOnly: json['readOnly'] == true);
  }

  Future<SessionDetail> session(String id) async {
    final json = await _getJson('/api/sessions/$id');
    return SessionDetail.fromJson(json['session'] as Map<String, dynamic>);
  }

  Future<List<ConversationItem>> conversation(String id, {int limit = 80}) async {
    final json = await _getJson('/api/sessions/$id/conversation', {'limit': '$limit'});
    return [for (final m in (json['messages'] as List? ?? const [])) ?ConversationItem.fromJson(m)];
  }

  Future<List<ActivityItem>> activity({int limit = 100}) async {
    final json = await _getJson('/api/activity', {'limit': '$limit'});
    return [for (final i in (json['items'] as List? ?? const [])) ?ActivityItem.fromJson(i)];
  }

  Future<void> sendMessage(String sessionId, String message) => _post('/api/sessions/$sessionId/message', {'message': message});

  Future<void> addNote(String sessionId, String text) => _post('/api/sessions/$sessionId/notes', {'text': text});

  /// Recognizes a 16 kHz mono WAV recording on the Mac (Uzbek and English).
  Future<({String text, String language})> transcribe(List<int> wav, {String? language}) async {
    final http.Response res;
    try {
      res = await _retry(() => _http
          .post(_uri('/api/voice/transcribe', {'language': ?language}), headers: {..._headers, 'Content-Type': 'audio/wav', 'X-Skipper': '1'}, body: wav)
          .timeout(const Duration(seconds: 90)));
    } catch (_) {
      throw const SkipperException('Could not send the recording to your Mac.');
    }
    final json = _decode(res);
    return (text: (json['text'] as String? ?? '').trim(), language: json['language'] as String? ?? 'uz-UZ');
  }

  /// A sentence read by the Mac's neural voice, as MP3 bytes.
  Future<List<int>> speak(String text, {Map<String, String>? voices}) async {
    final http.Response res;
    final headers = await _writeHeaders();
    try {
      res = await _retry(() => _http
          .post(_uri('/api/voice/speak'), headers: headers, body: jsonEncode({'text': text, 'voices': ?voices}))
          .timeout(const Duration(seconds: 30)));
    } catch (_) {
      throw const SkipperException('Could not reach your Mac for the voice.');
    }
    if (res.statusCode != 200) _decode(res);
    return res.bodyBytes;
  }

  Future<void> confirmProposal(String proposalId) => _post('/api/agent/confirm', {'proposalId': proposalId});

  /// Live change and alert events. The stream ends when the connection drops.
  Stream<SseEvent> events() async* {
    final request = http.Request('GET', _uri('/api/events'))..headers.addAll({..._headers, 'Accept': 'text/event-stream'});
    final res = await _http.send(request);
    if (res.statusCode != 200) throw SkipperException('Live updates are unavailable (${res.statusCode})', status: res.statusCode);
    yield* parseSse(res.stream);
  }

  /// Asks the voice agent. Events: conversation, status, delta, proposal, done, error.
  Stream<SseEvent> ask(String text, {String? conversationId}) async* {
    final request = http.Request('POST', _uri('/api/agent/ask'))
      ..headers.addAll({...await _writeHeaders(), 'Accept': 'text/event-stream'})
      ..body = jsonEncode({'text': text, 'conversationId': ?conversationId});
    http.StreamedResponse res;
    try {
      res = await _http.send(request);
    } catch (_) {
      // Retry once on a fresh connection (a request object can only be sent once).
      try {
        await Future<void>.delayed(const Duration(milliseconds: 300));
        final again = http.Request('POST', request.url)
          ..headers.addAll(request.headers)
          ..body = request.body;
        res = await _http.send(again);
      } catch (_) {
        throw const SkipperException('Could not reach your Mac. Check that it is awake and on the same Wi-Fi.');
      }
    }
    if (res.statusCode != 200) {
      final body = await res.stream.bytesToString();
      String? error;
      try {
        error = (jsonDecode(body) as Map)['error'] as String?;
      } catch (_) {}
      throw SkipperException(error ?? 'Skipper answered ${res.statusCode}', status: res.statusCode);
    }
    yield* parseSse(res.stream);
  }

  void close() => _http.close();
}
