import 'dart:async';
import 'dart:convert';

class SseEvent {
  const SseEvent(this.type, this.data);
  final String type;
  final String data;

  Map<String, dynamic> get json {
    if (data.isEmpty) return const {};
    final decoded = jsonDecode(data);
    return decoded is Map<String, dynamic> ? decoded : const {};
  }

  @override
  String toString() => 'SseEvent($type, $data)';
}

/// Parses a Server-Sent Events byte stream into events (comments and pings are skipped).
Stream<SseEvent> parseSse(Stream<List<int>> bytes) async* {
  var type = 'message';
  final data = <String>[];
  await for (final line in bytes.transform(utf8.decoder).transform(const LineSplitter())) {
    if (line.isEmpty) {
      if (data.isNotEmpty) yield SseEvent(type, data.join('\n'));
      type = 'message';
      data.clear();
    } else if (line.startsWith(':')) {
      continue;
    } else if (line.startsWith('event:')) {
      type = line.substring(6).trim();
    } else if (line.startsWith('data:')) {
      data.add(line.substring(5).trimLeft());
    }
  }
  if (data.isNotEmpty) yield SseEvent(type, data.join('\n'));
}
