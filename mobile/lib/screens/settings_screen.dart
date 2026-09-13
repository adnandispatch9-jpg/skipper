import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../state/providers.dart';
import '../theme.dart';
import '../voice/voice_controller.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final pairing = ref.watch(pairingProvider).value;
    final live = ref.watch(liveProvider);
    final voice = ref.watch(voiceProvider);
    final mode = ref.watch(themeModeProvider);

    return ListView(
      padding: EdgeInsets.fromLTRB(16, MediaQuery.paddingOf(context).top + 8, 16, 24),
      children: [
        const Text('Settings', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, letterSpacing: -0.5)),
        const SizedBox(height: 20),
        const SectionLabel('Your Mac'),
        const SizedBox(height: 8),
        SurfaceCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Icon(Icons.laptop_mac_rounded, color: c.accent),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(pairing?.name ?? 'Mac', style: const TextStyle(fontWeight: FontWeight.w600)),
                  Text('${pairing?.host}:${pairing?.port}', style: TextStyle(color: c.muted, fontSize: 13)),
                ]),
              ),
              Text(
                switch (live.status) { LinkStatus.online => 'Connected', LinkStatus.offline => 'Offline', _ => 'Connecting' },
                style: TextStyle(color: live.status == LinkStatus.online ? c.working : c.waiting, fontSize: 13, fontWeight: FontWeight.w600),
              ),
            ]),
            if (live.readOnly) ...[
              const SizedBox(height: 10),
              Text('Skipper runs read-only on this Mac, so replies, notes and sending are turned off.', style: TextStyle(color: c.muted, fontSize: 13)),
            ],
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () async {
                final ok = await showDialog<bool>(
                  context: context,
                  builder: (context) => AlertDialog(
                    title: const Text('Forget this Mac?'),
                    content: const Text('You can connect again by scanning the code in Skipper.'),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
                      TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Forget')),
                    ],
                  ),
                );
                if (ok == true) await ref.read(pairingProvider.notifier).forget();
              },
              child: const Text('Forget this Mac'),
            ),
          ]),
        ),
        const SizedBox(height: 20),
        const SectionLabel('Voice'),
        const SizedBox(height: 8),
        SurfaceCard(
          padding: EdgeInsets.zero,
          child: SwitchListTile(
            title: const Text('Read answers aloud'),
            subtitle: Text('Uses the voice set in iOS Settings › Accessibility › Spoken Content', style: TextStyle(color: c.muted, fontSize: 12.5)),
            value: voice.speakAloud,
            activeTrackColor: c.accent,
            onChanged: (v) => ref.read(voiceProvider.notifier).setSpeakAloud(v),
          ),
        ),
        const SizedBox(height: 10),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'auto', label: Text('Auto')),
            ButtonSegment(value: 'uz-UZ', label: Text('Oʻzbekcha')),
            ButtonSegment(value: 'en-US', label: Text('English')),
          ],
          selected: {voice.language},
          showSelectedIcon: false,
          onSelectionChanged: (s) => ref.read(voiceProvider.notifier).setLanguage(s.first),
        ),
        const SizedBox(height: 8),
        Text(
          voice.cloud
              ? 'Uzbek and English are recognized and read with neural voices on your Mac. Answers come back in the language you speak.'
              : 'Uzbek voice is off. On your Mac run: skipper voice setup --region <region>. Until then English works on this iPhone.',
          style: TextStyle(color: c.muted, fontSize: 12.5),
        ),
        const SizedBox(height: 20),
        const SectionLabel('Appearance'),
        const SizedBox(height: 8),
        SegmentedButton<ThemeMode>(
          segments: const [
            ButtonSegment(value: ThemeMode.system, label: Text('System')),
            ButtonSegment(value: ThemeMode.light, label: Text('Light')),
            ButtonSegment(value: ThemeMode.dark, label: Text('Dark')),
          ],
          selected: {mode},
          showSelectedIcon: false,
          onSelectionChanged: (s) => ref.read(themeModeProvider.notifier).set(s.first),
        ),
        const SizedBox(height: 24),
        Text(
          voice.cloud
              ? 'Skipper talks only to your Mac. For Uzbek voice, your Mac sends recordings and answers to Azure AI Speech.'
              : 'Skipper talks only to your Mac over this Wi-Fi. Nothing is sent anywhere else.',
          textAlign: TextAlign.center,
          style: TextStyle(color: c.faint, fontSize: 12.5),
        ),
      ],
    );
  }
}
