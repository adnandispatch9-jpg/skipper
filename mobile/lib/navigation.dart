import 'package:flutter/material.dart';

import 'screens/session_screen.dart';
import 'screens/voice_screen.dart';

void openSession(BuildContext context, String id, {bool conversation = false}) {
  Navigator.of(context).push(MaterialPageRoute(builder: (_) => SessionScreen(sessionId: id, startOnConversation: conversation)));
}

void openVoice(BuildContext context, {bool listen = false, String? ask}) {
  Navigator.of(context).push(MaterialPageRoute(fullscreenDialog: true, builder: (_) => VoiceScreen(listenOnOpen: listen, askOnOpen: ask)));
}
