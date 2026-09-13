import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:skipper_mobile/core/sse.dart';

void main() {
  test('parses events split across chunks and skips pings', () async {
    final chunks = ['event: hello\ndata: {}\n\n: ping\n\nevent: del', 'ta\ndata: {"text":"Hi"}\n\n', 'event: done\ndata: {"text":"Hi there"}\n\n'];
    final events = await parseSse(Stream.fromIterable(chunks.map(utf8.encode))).toList();
    expect(events.map((e) => e.type), ['hello', 'delta', 'done']);
    expect(events[1].json['text'], 'Hi');
  });
}
