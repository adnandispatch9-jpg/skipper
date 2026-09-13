import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'screens/activity_screen.dart';
import 'screens/connect_screen.dart';
import 'screens/home_screen.dart';
import 'screens/sessions_screen.dart';
import 'screens/settings_screen.dart';
import 'navigation.dart';
import 'state/providers.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(SystemUiOverlayStyle.light);
  runApp(const ProviderScope(child: SkipperApp()));
}

class SkipperApp extends ConsumerWidget {
  const SkipperApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: 'Skipper',
      debugShowCheckedModeBanner: false,
      theme: skipperTheme(Brightness.light),
      darkTheme: skipperTheme(Brightness.dark),
      themeMode: ref.watch(themeModeProvider),
      home: const RootGate(),
    );
  }
}

class RootGate extends ConsumerWidget {
  const RootGate({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pairing = ref.watch(pairingProvider);
    return pairing.when(
      loading: () => const Scaffold(body: SizedBox.shrink()),
      error: (_, _) => const ConnectScreen(),
      data: (info) => info == null ? const ConnectScreen() : const Shell(),
    );
  }
}

class Shell extends ConsumerStatefulWidget {
  const Shell({super.key});

  @override
  ConsumerState<Shell> createState() => _ShellState();
}

class _ShellState extends ConsumerState<Shell> with WidgetsBindingObserver {
  int _tab = 0;
  StreamSubscription? _alerts;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _alerts = ref.read(alertBusProvider).stream.listen(_showAlert);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _alerts?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState lifecycle) {
    final live = ref.read(liveProvider.notifier);
    if (lifecycle == AppLifecycleState.resumed) live.setPaused(false);
    if (lifecycle == AppLifecycleState.paused) live.setPaused(true);
  }

  void _showAlert(Map<String, dynamic> alert) {
    if (!mounted) return;
    final kind = alert['kind'];
    if (kind != 'permission' && kind != 'question' && kind != 'idle') return;
    final c = context.colors;
    final title = alert['title'] as String? ?? 'A session';
    final text = switch (kind) {
      'permission' => '$title needs permission',
      'question' => '$title asked you something',
      _ => '$title is waiting for you',
    };
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      behavior: SnackBarBehavior.floating,
      backgroundColor: kind == 'permission' ? c.permission : c.surface2,
      content: Text(text, style: TextStyle(color: kind == 'permission' ? const Color(0xFF1A0C04) : c.text, fontWeight: FontWeight.w600)),
      action: SnackBarAction(
        label: 'Open',
        textColor: kind == 'permission' ? const Color(0xFF1A0C04) : c.accent,
        onPressed: () => openSession(context, alert['sessionId'] as String),
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final needs = ref.watch(liveProvider.select((s) => s.needsYou.length));
    final pages = const [HomeScreen(), SessionsScreen(), SizedBox.shrink(), ActivityScreen(), SettingsScreen()];
    return Scaffold(
      body: IndexedStack(index: _tab, children: pages),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(color: c.surface, border: Border(top: BorderSide(color: c.border))),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 60,
            child: Row(children: [
              _TabButton(icon: Icons.home_outlined, label: 'Home', selected: _tab == 0, badge: needs, onTap: () => setState(() => _tab = 0)),
              _TabButton(icon: Icons.format_list_bulleted, label: 'Sessions', selected: _tab == 1, onTap: () => setState(() => _tab = 1)),
              Expanded(
                child: Center(
                  child: Semantics(
                    button: true,
                    label: 'Ask Skipper',
                    child: GestureDetector(
                      onTap: () => openVoice(context, listen: true),
                      child: Container(
                        width: 58,
                        height: 58,
                        transform: Matrix4.translationValues(0, -14, 0),
                        decoration: BoxDecoration(
                          color: c.accent,
                          shape: BoxShape.circle,
                          boxShadow: [BoxShadow(color: c.accent.withValues(alpha: 0.35), blurRadius: 24, offset: const Offset(0, 8)), BoxShadow(color: c.bg, spreadRadius: 6)],
                        ),
                        child: Icon(Icons.mic_rounded, color: c.onAccent, size: 28),
                      ),
                    ),
                  ),
                ),
              ),
              _TabButton(icon: Icons.show_chart, label: 'Activity', selected: _tab == 3, onTap: () => setState(() => _tab = 3)),
              _TabButton(icon: Icons.settings_outlined, label: 'Settings', selected: _tab == 4, onTap: () => setState(() => _tab = 4)),
            ]),
          ),
        ),
      ),
    );
  }
}

class _TabButton extends StatelessWidget {
  const _TabButton({required this.icon, required this.label, required this.selected, required this.onTap, this.badge = 0});
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final int badge;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final color = selected ? c.text : c.ended;
    return Expanded(
      child: InkResponse(
        onTap: onTap,
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Badge(isLabelVisible: badge > 0, label: Text('$badge'), backgroundColor: c.permission, child: Icon(icon, color: color, size: 22)),
          const SizedBox(height: 3),
          Text(label, style: TextStyle(fontSize: 11, color: color, fontWeight: selected ? FontWeight.w600 : FontWeight.w500)),
        ]),
      ),
    );
  }
}
