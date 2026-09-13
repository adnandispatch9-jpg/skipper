import 'package:flutter_test/flutter_test.dart';
import 'package:skipper_mobile/api/models.dart';
import 'package:skipper_mobile/voice/voice_controller.dart';

SessionSummary s(String id, String title) => SessionSummary(id: id, title: title, project: 'p', state: 'working');

void main() {
  test('answers link the sessions they mention, in order', () {
    final sessions = [s('a', 'Checkout flow redesign'), s('b', 'Ship 4.2 to TestFlight'), s('c', 'cli')];
    expect(mentionedSessions('Ship 4.2 to TestFlight needs you, and the checkout flow redesign is working.', sessions), ['b', 'a']);
    expect(mentionedSessions('Nothing to report.', sessions), isEmpty);
    expect(mentionedSessions('The cli is fine.', sessions), isEmpty, reason: 'very short titles are too ambiguous');
  });

  test('models parse the server JSON and tolerate missing fields', () {
    final summary = SessionSummary.fromJson({'id': 'x', 'state': 'sleeping', 'loop': {'wakeAt': 5, 'reason': 'CI'}, 'attention': {'kind': 'question'}, 'background': true});
    expect(summary.title, 'Untitled');
    expect(summary.loop!.reason, 'CI');
    expect(summary.attention!.kind, 'question');
    expect(summary.background, isTrue);
    final item = ActivityItem.fromJson({'sessionId': 'x', 'at': 1, 'kind': 'pr', 'text': 'Pull request opened', 'detail': 'acme#1'})!;
    expect(item.label, 'Pull request opened');
    expect(item.text, 'acme#1');
    expect(ConversationItem.fromJson({'role': 'tools', 'names': ['Read', 3], 'count': 2})!.names, ['Read']);
  });
}
