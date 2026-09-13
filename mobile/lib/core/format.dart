/// Pure helpers shared by screens. No Flutter imports, so they are unit-tested directly.
library;

const stateLabels = {
  'permission': 'Needs permission',
  'waiting': 'Needs you',
  'working': 'Working',
  'sleeping': 'Sleeping',
  'ended': 'Ended',
};

String stateLabel(String state) => stateLabels[state] ?? state;

/// Sort order for "what needs me first".
int stateRank(String state) => const {'permission': 0, 'waiting': 1, 'working': 2, 'sleeping': 3}[state] ?? 4;

String formatAgo(int? atMs, int nowMs) {
  if (atMs == null) return '';
  final seconds = ((nowMs - atMs) / 1000).floor();
  if (seconds < 60) return 'just now';
  final minutes = seconds ~/ 60;
  if (minutes < 60) return '${minutes}m ago';
  final hours = minutes ~/ 60;
  if (hours < 24) return '${hours}h ago';
  return '${hours ~/ 24}d ago';
}

String formatDuration(int ms) {
  final minutes = (ms / 60000).floor();
  if (minutes < 1) return '${(ms / 1000).floor()}s';
  if (minutes < 60) return '${minutes}m';
  final hours = minutes ~/ 60;
  final rest = minutes % 60;
  return rest == 0 ? '${hours}h' : '${hours}h ${rest}m';
}

String formatCountdown(int untilMs, int nowMs) {
  final left = untilMs - nowMs;
  if (left <= 0) return 'now';
  final total = (left / 1000).ceil();
  final m = total ~/ 60;
  final s = total % 60;
  return '$m:${s.toString().padLeft(2, '0')}';
}

/// Connection details read from the dashboard's "Connect phone" code or typed in by hand.
class PairingInfo {
  const PairingInfo({required this.host, required this.port, required this.token, this.name});
  final String host;
  final int port;
  final String token;
  final String? name;

  Uri get baseUri => Uri(scheme: 'http', host: host, port: port);

  Map<String, dynamic> toJson() => {'host': host, 'port': port, 'token': token, 'name': name};

  static PairingInfo? fromJson(Map<String, dynamic> json) {
    final host = json['host'];
    final port = json['port'];
    final token = json['token'];
    if (host is! String || port is! int || token is! String) return null;
    return PairingInfo(host: host, port: port, token: token, name: json['name'] as String?);
  }

  /// Accepts `skipper://pair?host=…&port=…&token=…&name=…` and the dashboard's
  /// `http://192.168.1.5:4317/?token=…` link.
  static PairingInfo? parse(String raw) {
    final text = raw.trim();
    final uri = Uri.tryParse(text);
    if (uri == null) return null;
    final token = uri.queryParameters['token'];
    if (token == null || token.length < 8) return null;
    if (uri.scheme == 'skipper') {
      final host = uri.queryParameters['host'];
      final port = int.tryParse(uri.queryParameters['port'] ?? '');
      if (host == null || host.isEmpty || port == null) return null;
      return PairingInfo(host: host, port: port, token: token, name: uri.queryParameters['name']);
    }
    if ((uri.scheme == 'http' || uri.scheme == 'https') && uri.host.isNotEmpty) {
      return PairingInfo(host: uri.host, port: uri.hasPort ? uri.port : 4317, token: token);
    }
    return null;
  }
}

/// Splits streamed text into sentences that are ready to speak, keeping the unfinished tail.
class SentenceBuffer {
  final _pending = StringBuffer();

  /// Adds text and returns any complete sentences.
  List<String> add(String text) {
    _pending.write(text);
    final all = _pending.toString();
    final out = <String>[];
    var start = 0;
    final pattern = RegExp(r'[.!?]+["”’)]?(\s+|$)|\n{2,}');
    for (final match in pattern.allMatches(all)) {
      // Only cut when something follows, so "3.5" or a sentence still streaming stays whole.
      if (match.end == all.length && !all.endsWith('\n\n')) break;
      final sentence = all.substring(start, match.end).trim();
      if (sentence.isNotEmpty) out.add(sentence);
      start = match.end;
    }
    final rest = all.substring(start);
    _pending
      ..clear()
      ..write(rest);
    return out;
  }

  /// Returns whatever is left when the answer is complete.
  String flush() {
    final rest = _pending.toString().trim();
    _pending.clear();
    return rest;
  }
}
