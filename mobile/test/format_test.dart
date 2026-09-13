import 'package:flutter_test/flutter_test.dart';
import 'package:skipper_mobile/core/format.dart';

void main() {
  test('relative times, durations and countdowns', () {
    const now = 1000000000;
    expect(formatAgo(now - 30000, now), 'just now');
    expect(formatAgo(now - 5 * 60000, now), '5m ago');
    expect(formatAgo(now - 3 * 3600000, now), '3h ago');
    expect(formatDuration(45000), '45s');
    expect(formatDuration(52 * 60000), '52m');
    expect(formatDuration(125 * 60000), '2h 5m');
    expect(formatCountdown(now + 13 * 60000 + 2000, now), '13:02');
    expect(formatCountdown(now - 1, now), 'now');
  });

  test('pairing codes from the dashboard, the printed link, or garbage', () {
    final code = PairingInfo.parse('skipper://pair?host=192.168.1.5&port=4317&token=abcdefghijkl&name=MacBook%20Pro')!;
    expect(code.host, '192.168.1.5');
    expect(code.port, 4317);
    expect(code.name, 'MacBook Pro');
    expect(code.baseUri.toString(), 'http://192.168.1.5:4317');
    final link = PairingInfo.parse('http://192.168.1.5:4320/?token=abcdefghijkl')!;
    expect(link.port, 4320);
    expect(PairingInfo.parse('http://192.168.1.5:4320/'), isNull);
    expect(PairingInfo.parse('skipper://pair?host=x&token=short'), isNull);
    expect(PairingInfo.parse('hello'), isNull);
    expect(PairingInfo.fromJson(code.toJson())!.token, 'abcdefghijkl');
  });

  test('sentences are spoken as soon as they are complete', () {
    final buffer = SentenceBuffer();
    expect(buffer.add('Two sessions need you. Ship 4.'), ['Two sessions need you.']);
    expect(buffer.add('2 is waiting'), isEmpty);
    expect(buffer.add(' for permission! And'), ['Ship 4.2 is waiting for permission!']);
    expect(buffer.flush(), 'And');
    expect(buffer.flush(), '');
  });

  test('states sort permission first', () {
    final states = ['working', 'ended', 'permission', 'sleeping', 'waiting']..sort((a, b) => stateRank(a).compareTo(stateRank(b)));
    expect(states, ['permission', 'waiting', 'working', 'sleeping', 'ended']);
    expect(stateLabel('waiting'), 'Needs you');
  });
}
