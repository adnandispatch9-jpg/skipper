import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../navigation.dart';
import '../state/providers.dart';
import '../theme.dart';
import '../widgets/session_widgets.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final live = ref.watch(liveProvider);
    final pairing = ref.watch(pairingProvider).value;
    final needs = live.needsYou;
    final inFlight = live.inFlight;
    final liveCount = live.sessions.where((s) => s.live).length;
    final nextLoop = live.sessions.where((s) => s.loop != null).map((s) => s.loop!.wakeAt).fold<int?>(null, (a, b) => a == null || b < a ? b : a);
    final headline = needs.isEmpty ? 'All clear' : '${needs.length} need${needs.length == 1 ? 's' : ''} you';
    final summary = [
      pairing?.name ?? 'Your Mac',
      '$liveCount live',
      if (nextLoop != null) 'loop wakes in ${((nextLoop - live.now) / 60000).ceil().clamp(0, 9999)}m',
    ].join(' · ');

    return RefreshIndicator(
      onRefresh: () => ref.read(liveProvider.notifier).refresh(),
      child: ListView(
        padding: EdgeInsets.fromLTRB(16, MediaQuery.paddingOf(context).top + 8, 16, 24),
        children: [
          Text(headline, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700, letterSpacing: -0.5)),
          const SizedBox(height: 2),
          Row(children: [
            Container(width: 8, height: 8, decoration: BoxDecoration(color: live.status == LinkStatus.online ? c.working : c.waiting, shape: BoxShape.circle)),
            const SizedBox(width: 6),
            Expanded(child: Text(summary, style: TextStyle(color: c.muted, fontSize: 13), overflow: TextOverflow.ellipsis)),
          ]),
          const SizedBox(height: 16),
          if (live.status == LinkStatus.offline && live.error != null)
            ConnectionBanner(message: live.error!, onRetry: () => ref.read(liveProvider.notifier).refresh()),
          _AskCard(),
          const SizedBox(height: 20),
          if (needs.isNotEmpty) ...[
            const SectionLabel('Needs you'),
            const SizedBox(height: 10),
            GroupCard(children: [for (var i = 0; i < needs.length; i++) AttentionRow(session: needs[i], now: live.now, first: i == 0)]),
            const SizedBox(height: 20),
          ],
          if (inFlight.isNotEmpty) ...[
            const SectionLabel('In flight'),
            const SizedBox(height: 10),
            for (final s in inFlight) ...[InFlightCard(session: s, now: live.now), const SizedBox(height: 10)],
          ],
          if (needs.isEmpty && inFlight.isEmpty && live.status == LinkStatus.online)
            Padding(
              padding: const EdgeInsets.only(top: 40),
              child: Text('Nothing is running. Start a Claude Code session on your Mac and it shows up here.', textAlign: TextAlign.center, style: TextStyle(color: c.muted)),
            ),
        ],
      ),
    );
  }
}

class _AskCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    Widget chip(String label) => ActionChip(
          label: Text(label),
          onPressed: () => openVoice(context, ask: label == 'Brief me' ? 'Brief me: what needs me, what finished, what is running, and what is next?' : label),
          backgroundColor: c.surface2,
          side: BorderSide.none,
          labelStyle: TextStyle(color: c.text, fontWeight: FontWeight.w500),
          shape: const StadiumBorder(),
        );
    return Material(
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: Ink(
        decoration: BoxDecoration(
          gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [c.accentSoft, c.surface], stops: const [0, 0.7]),
          border: Border.all(color: c.accent.withValues(alpha: 0.25)),
          borderRadius: BorderRadius.circular(18),
        ),
        child: InkWell(
          onTap: () => openVoice(context, listen: true),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(color: c.accent, shape: BoxShape.circle),
                  child: Icon(Icons.mic_rounded, color: c.onAccent),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('Ask Skipper', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                    Text('Knows every session, agent and loop', style: TextStyle(color: c.muted, fontSize: 13)),
                  ]),
                ),
              ]),
              const SizedBox(height: 12),
              Wrap(spacing: 8, runSpacing: 8, children: [chip('Brief me'), chip('What finished?'), chip('Anything stuck?')]),
            ]),
          ),
        ),
      ),
    );
  }
}
