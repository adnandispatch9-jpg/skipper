import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/models.dart';
import '../core/format.dart';
import '../state/providers.dart';
import '../theme.dart';
import '../widgets/session_widgets.dart';

class SessionsScreen extends ConsumerStatefulWidget {
  const SessionsScreen({super.key});

  @override
  ConsumerState<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends ConsumerState<SessionsScreen> {
  String _query = '';
  String? _project;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final live = ref.watch(liveProvider);
    final projects = <String>{for (final s in live.sessions.where((s) => s.live)) s.project}.toList()..sort();
    bool matches(SessionSummary s) =>
        (_project == null || s.project == _project) &&
        (_query.isEmpty || s.title.toLowerCase().contains(_query) || s.project.toLowerCase().contains(_query));
    final visible = live.sessions.where(matches).toList();
    final groups = <String, List<SessionSummary>>{};
    for (final s in visible) {
      final key = s.needsYou ? 'Needs you' : stateLabel(s.state);
      groups.putIfAbsent(key, () => []).add(s);
    }
    final order = ['Needs you', 'Working', 'Sleeping', 'Ended'];

    return RefreshIndicator(
      onRefresh: () => ref.read(liveProvider.notifier).refresh(),
      child: ListView(
        padding: EdgeInsets.fromLTRB(16, MediaQuery.paddingOf(context).top + 8, 16, 24),
        children: [
          const Text('Sessions', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, letterSpacing: -0.5)),
          const SizedBox(height: 12),
          TextField(
            onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
            decoration: InputDecoration(
              hintText: 'Search sessions',
              prefixIcon: const Icon(Icons.search, size: 20),
              filled: true,
              fillColor: c.surface2,
              isDense: true,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(11), borderSide: BorderSide.none),
            ),
          ),
          if (projects.length > 1) ...[
            const SizedBox(height: 10),
            SizedBox(
              height: 34,
              child: ListView(scrollDirection: Axis.horizontal, children: [
                for (final p in [null, ...projects])
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(p ?? 'All'),
                      selected: _project == p,
                      onSelected: (_) => setState(() => _project = p),
                      showCheckmark: false,
                      selectedColor: c.text,
                      backgroundColor: c.surface2,
                      side: BorderSide.none,
                      labelStyle: TextStyle(color: _project == p ? c.bg : c.text),
                      shape: const StadiumBorder(),
                    ),
                  ),
              ]),
            ),
          ],
          const SizedBox(height: 16),
          for (final key in order)
            if (groups[key] case final list?) ...[
              SectionLabel('$key · ${list.length}'),
              const SizedBox(height: 8),
              GroupCard(children: [
                for (var i = 0; i < (key == 'Ended' ? list.length.clamp(0, 30) : list.length); i++) SessionRow(session: list[i], now: live.now, first: i == 0),
              ]),
              const SizedBox(height: 16),
            ],
          if (visible.isEmpty && live.status == LinkStatus.online)
            Padding(padding: const EdgeInsets.only(top: 40), child: Text('No sessions match.', textAlign: TextAlign.center, style: TextStyle(color: c.muted))),
        ],
      ),
    );
  }
}
