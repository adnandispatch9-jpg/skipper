import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../navigation.dart';
import '../state/providers.dart';
import '../theme.dart';
import '../voice/voice_controller.dart';

class VoiceScreen extends ConsumerStatefulWidget {
  const VoiceScreen({super.key, this.listenOnOpen = false, this.askOnOpen});
  final bool listenOnOpen;
  final String? askOnOpen;

  @override
  ConsumerState<VoiceScreen> createState() => _VoiceScreenState();
}

class _VoiceScreenState extends ConsumerState<VoiceScreen> {
  final _scroll = ScrollController();
  final _typed = TextEditingController();
  bool _typing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final voice = ref.read(voiceProvider.notifier);
      if (widget.askOnOpen != null) {
        voice.ask(widget.askOnOpen!);
      } else if (widget.listenOnOpen) {
        voice.talk();
      }
    });
  }

  @override
  void dispose() {
    _scroll.dispose();
    _typed.dispose();
    super.dispose();
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final voice = ref.watch(voiceProvider);
    final controller = ref.read(voiceProvider.notifier);
    final sessions = ref.watch(liveProvider.select((s) => s.sessions));
    ref.listen(voiceProvider.select((v) => v.turns), (_, _) => _scrollToEnd());

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(icon: const Icon(Icons.close_rounded), tooltip: 'Close', onPressed: () {
          controller.stopLive();
          controller.cancelListening();
          controller.stopSpeaking();
          Navigator.of(context).pop();
        }),
        title: const Text('Skipper', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 17)),
        actions: [
          IconButton(
            tooltip: voice.speakAloud ? 'Mute answers' : 'Read answers aloud',
            icon: Icon(voice.speakAloud ? Icons.volume_up_rounded : Icons.volume_off_rounded, color: voice.speakAloud ? c.accent : c.muted),
            onPressed: () => controller.setSpeakAloud(!voice.speakAloud),
          ),
          IconButton(tooltip: 'New conversation', icon: const Icon(Icons.refresh_rounded), onPressed: controller.newConversation),
        ],
      ),
      body: Column(children: [
        Expanded(
          child: voice.turns.isEmpty
              ? _Empty(onAsk: controller.ask)
              : ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                  itemCount: voice.turns.length,
                  itemBuilder: (context, i) {
                    final turn = voice.turns[i];
                    if (turn.role == 'user') {
                      return Align(
                        alignment: Alignment.centerRight,
                        child: Container(
                          margin: const EdgeInsets.symmetric(vertical: 8),
                          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          decoration: BoxDecoration(color: c.accentSoft, borderRadius: const BorderRadius.only(topLeft: Radius.circular(18), topRight: Radius.circular(18), bottomLeft: Radius.circular(18), bottomRight: Radius.circular(4))),
                          child: Text(turn.text, style: const TextStyle(height: 1.4)),
                        ),
                      );
                    }
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        if (turn.status != null)
                          Row(children: [
                            SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 1.6, color: c.faint)),
                            const SizedBox(width: 8),
                            Text(turn.status!, style: TextStyle(color: c.faint, fontSize: 13)),
                          ]),
                        if (turn.text.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: SelectableText(turn.text, style: const TextStyle(fontSize: 16, height: 1.5))),
                        if (turn.error != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(turn.error!, style: TextStyle(color: c.danger))),
                        if (turn.sessionIds.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 10),
                            child: Wrap(spacing: 8, runSpacing: 8, children: [
                              for (final id in turn.sessionIds)
                                if (sessions.where((s) => s.id == id).firstOrNull case final s?)
                                  ActionChip(
                                    avatar: StateDot(s.state),
                                    label: Text(s.title, overflow: TextOverflow.ellipsis),
                                    onPressed: () => openSession(context, s.id),
                                    backgroundColor: c.surface2,
                                    side: BorderSide(color: c.border),
                                    shape: const StadiumBorder(),
                                  ),
                            ]),
                          ),
                        for (final p in turn.proposals) _ProposalCard(proposal: p, title: sessions.where((s) => s.id == p.sessionId).firstOrNull?.title),
                      ]),
                    );
                  },
                ),
        ),
        _Controls(
          voice: voice,
          typing: _typing,
          typed: _typed,
          onToggleTyping: () => setState(() => _typing = !_typing),
          onSubmitTyped: () {
            final text = _typed.text.trim();
            if (text.isEmpty) return;
            _typed.clear();
            controller.ask(text);
          },
        ),
      ]),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.onAsk});
  final ValueChanged<String> onAsk;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    const examples = ['Brief me on everything', 'Does anything need me?', 'What finished in the last hour?', 'How far along is each plan?'];
    return ListView(padding: const EdgeInsets.all(24), children: [
      const SizedBox(height: 24),
      const Text('Ask about any session', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: -0.4)),
      const SizedBox(height: 8),
      Text('Skipper can see every session, subagent, loop and background job on your Mac, and reads the answer aloud.', style: TextStyle(color: c.muted, height: 1.45)),
      const SizedBox(height: 20),
      for (final e in examples)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: SurfaceCard(onTap: () => onAsk(e), child: Row(children: [Expanded(child: Text(e)), Icon(Icons.arrow_forward_rounded, size: 18, color: c.faint)])),
        ),
    ]);
  }
}

class _ProposalCard extends ConsumerWidget {
  const _ProposalCard({required this.proposal, this.title});
  final Proposal proposal;
  final String? title;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final controller = ref.read(voiceProvider.notifier);
    final readOnly = ref.watch(liveProvider.select((s) => s.readOnly));
    final handsFree = ref.watch(voiceProvider.select((v) => v.live));
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: SurfaceCard(
        borderColor: proposal.status == 'pending' ? c.accent : c.border,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('SEND TO ${(title ?? 'SESSION').toUpperCase()}', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.7, color: c.accent)),
          const SizedBox(height: 8),
          Text('“${proposal.text}”', style: const TextStyle(height: 1.45)),
          if (handsFree && proposal.status == 'pending' && !readOnly)
            Padding(padding: const EdgeInsets.only(top: 8), child: Text('Say “yes” to send it or “no” to cancel.', style: TextStyle(color: c.muted, fontSize: 13))),
          const SizedBox(height: 12),
          switch (proposal.status) {
            'pending' when !readOnly => Row(children: [
                Expanded(child: OutlinedButton(onPressed: () => controller.cancel(proposal), style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(44)), child: const Text('Cancel'))),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => controller.confirm(proposal),
                    style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(44), backgroundColor: c.accent, foregroundColor: c.onAccent),
                    icon: const Icon(Icons.send_rounded, size: 18),
                    label: const Text('Send'),
                  ),
                ),
              ]),
            'sending' => Text('Sending…', style: TextStyle(color: c.muted)),
            'sent' => Text('Sent. Claude continues in the background.', style: TextStyle(color: c.working)),
            'failed' => Text('Could not send. Try again from the session.', style: TextStyle(color: c.danger)),
            'cancelled' => Text('Not sent.', style: TextStyle(color: c.muted)),
            _ => Text('Skipper is read-only on your Mac.', style: TextStyle(color: c.muted)),
          },
        ]),
      ),
    );
  }
}

class _Controls extends ConsumerWidget {
  const _Controls({required this.voice, required this.typing, required this.typed, required this.onToggleTyping, required this.onSubmitTyped});
  final VoiceState voice;
  final bool typing;
  final TextEditingController typed;
  final VoidCallback onToggleTyping, onSubmitTyped;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final controller = ref.read(voiceProvider.notifier);
    final listening = voice.phase == VoicePhase.listening;
    final caption = voice.live
        ? switch (voice.phase) {
            VoicePhase.listening => voice.micError ?? 'Listening. Just talk.',
            VoicePhase.thinking => voice.heard.isNotEmpty ? voice.heard : 'Thinking…',
            VoicePhase.speaking => 'Talk any time to interrupt',
            VoicePhase.idle => 'Listening. Just talk.',
          }
        : switch (voice.phase) {
      VoicePhase.listening => voice.heard.isEmpty ? 'Listening…' : '“${voice.heard}”',
      VoicePhase.thinking => 'Looking at your sessions…',
      VoicePhase.speaking => 'Tap to stop',
      VoicePhase.idle => voice.micError ?? 'Tap to talk',
    };
    return Container(
      decoration: BoxDecoration(color: c.surface, border: Border(top: BorderSide(color: c.border))),
      padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + MediaQuery.paddingOf(context).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        if (typing)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: TextField(
              controller: typed,
              autofocus: true,
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => onSubmitTyped(),
              decoration: InputDecoration(
                hintText: 'Type a question',
                filled: true,
                fillColor: c.surface2,
                isDense: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide.none),
                suffixIcon: IconButton(icon: Icon(Icons.send_rounded, color: c.accent), onPressed: onSubmitTyped),
              ),
            ),
          ),
        Text(caption, textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: voice.micError != null && voice.phase == VoicePhase.idle ? c.waiting : c.muted, fontSize: 13)),
        const SizedBox(height: 12),
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          _RoundButton(icon: typing ? Icons.mic_none_rounded : Icons.keyboard_rounded, label: typing ? 'Hide keyboard' : 'Type instead', onTap: onToggleTyping),
          const SizedBox(width: 22),
          Semantics(
            button: true,
            label: voice.live ? 'End the conversation' : (listening ? 'Send what you said' : 'Talk to Skipper'),
            child: GestureDetector(
              onTap: () {
                if (voice.live) {
                  controller.stopLive();
                  controller.stopSpeaking();
                  return;
                }
                switch (voice.phase) {
                  case VoicePhase.listening:
                    controller.stopListening();
                  case VoicePhase.speaking:
                    controller.stopSpeaking();
                  case _:
                    controller.talk();
                }
              },
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: listening || voice.live ? 132 : 76,
                height: 72,
                decoration: BoxDecoration(
                  color: listening || voice.live ? c.accentSoft : c.accent,
                  borderRadius: BorderRadius.circular(36),
                  boxShadow: [BoxShadow(color: c.accent.withValues(alpha: listening ? 0.18 : 0.3), spreadRadius: listening ? 8 : 0, blurRadius: listening ? 0 : 20)],
                ),
                child: voice.live
                    ? Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                        if (voice.phase == VoicePhase.listening) Expanded(child: _Waveform(level: voice.soundLevel, color: c.accent)),
                        if (voice.phase == VoicePhase.thinking) Icon(Icons.more_horiz_rounded, size: 32, color: c.accent),
                        if (voice.phase == VoicePhase.speaking) Icon(Icons.graphic_eq_rounded, size: 32, color: c.accent),
                        if (voice.phase == VoicePhase.idle) Icon(Icons.mic_rounded, size: 32, color: c.accent),
                      ])
                    : listening
                    ? _Waveform(level: voice.soundLevel, color: c.accent)
                    : Icon(
                        voice.phase == VoicePhase.speaking ? Icons.stop_rounded : (voice.phase == VoicePhase.thinking ? Icons.more_horiz_rounded : Icons.mic_rounded),
                        size: 32,
                        color: c.onAccent,
                      ),
              ),
            ),
          ),
          const SizedBox(width: 22),
          _RoundButton(icon: voice.live ? Icons.call_end_rounded : Icons.close_rounded, label: voice.live ? 'End the conversation' : 'Cancel', onTap: () {
            controller.stopLive();
            controller.cancelListening();
            controller.stopSpeaking();
          }),
        ]),
      ]),
    );
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Semantics(
      button: true,
      label: label,
      child: InkResponse(
        onTap: onTap,
        radius: 28,
        child: Container(width: 48, height: 48, decoration: BoxDecoration(color: c.surface2, shape: BoxShape.circle), child: Icon(icon, color: c.muted)),
      ),
    );
  }
}

/// Bars that follow the microphone level.
class _Waveform extends StatefulWidget {
  const _Waveform({required this.level, required this.color});
  final double level;
  final Color color;

  @override
  State<_Waveform> createState() => _WaveformState();
}

class _WaveformState extends State<_Waveform> with SingleTickerProviderStateMixin {
  late final _ticker = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat();

  @override
  void dispose() {
    _ticker.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // iOS reports roughly -50..10 dB; map it to 0..1.
    final energy = ((widget.level + 50) / 60).clamp(0.15, 1.0);
    return AnimatedBuilder(
      animation: _ticker,
      builder: (context, _) => Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        for (var i = 0; i < 13; i++)
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 2),
            width: 4,
            height: 8 + 32 * energy * (0.5 + 0.5 * math.sin(_ticker.value * 2 * math.pi + i * 0.7)).abs(),
            decoration: BoxDecoration(color: widget.color, borderRadius: BorderRadius.circular(2)),
          ),
      ]),
    );
  }
}
