import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../core/format.dart';
import '../navigation.dart';
import '../state/providers.dart';
import '../theme.dart';

class ActivityScreen extends ConsumerStatefulWidget {
  const ActivityScreen({super.key});

  @override
  ConsumerState<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends ConsumerState<ActivityScreen> {
  List<ActivityItem> _items = const [];
  String? _error;
  bool _loading = true;
  String _filter = 'all';
  Timer? _debounce;

  static const _filters = {
    'all': 'All',
    'needs': 'Needs you',
    'done': 'Finished',
    'agents': 'Subagents',
    'loops': 'Loops',
  };

  bool _matches(ActivityItem i) => switch (_filter) {
        'needs' => const {'permission', 'question', 'waiting'}.contains(i.kind),
        'done' => const {'turn', 'ended', 'pr', 'workflow'}.contains(i.kind),
        'agents' => i.kind.startsWith('agent'),
        'loops' => i.kind == 'loop',
        _ => true,
      };

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final client = ref.read(clientProvider);
    if (client == null) return;
    try {
      final items = await client.activity(limit: 150);
      if (mounted) setState(() => (_items = items, _error = null, _loading = false));
    } on SkipperException catch (e) {
      if (mounted) setState(() => (_error = e.message, _loading = false));
    }
  }

  IconData _icon(String kind) => switch (kind) {
        'permission' => Icons.shield_outlined,
        'question' => Icons.help_outline,
        'waiting' => Icons.reply_rounded,
        'turn' => Icons.check_circle_outline,
        'loop' => Icons.loop_rounded,
        'pr' => Icons.merge_type_rounded,
        'workflow' => Icons.account_tree_outlined,
        'ended' => Icons.stop_circle_outlined,
        _ => kind.startsWith('agent') ? Icons.smart_toy_outlined : Icons.circle_outlined,
      };

  Color _tint(SkipperColors c, String kind) => switch (kind) {
        'permission' => c.permission,
        'question' || 'waiting' => c.waiting,
        'turn' || 'pr' => c.working,
        'loop' => c.sleeping,
        _ => c.accent,
      };

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final now = ref.watch(liveProvider.select((s) => s.now));
    ref.listen(liveProvider.select((s) => s.sessions), (_, _) {
      _debounce?.cancel();
      _debounce = Timer(const Duration(seconds: 2), _load);
    });
    final visible = _items.where(_matches).toList();

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: EdgeInsets.fromLTRB(16, MediaQuery.paddingOf(context).top + 8, 16, 24),
        children: [
          const Text('Activity', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, letterSpacing: -0.5)),
          const SizedBox(height: 4),
          Text('What happened across every session', style: TextStyle(color: c.muted)),
          const SizedBox(height: 12),
          SizedBox(
            height: 34,
            child: ListView(scrollDirection: Axis.horizontal, children: [
              for (final entry in _filters.entries)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(entry.value),
                    selected: _filter == entry.key,
                    onSelected: (_) => setState(() => _filter = entry.key),
                    showCheckmark: false,
                    selectedColor: c.text,
                    backgroundColor: c.surface2,
                    side: BorderSide.none,
                    labelStyle: TextStyle(color: _filter == entry.key ? c.bg : c.text),
                    shape: const StadiumBorder(),
                  ),
                ),
            ]),
          ),
          const SizedBox(height: 12),
          if (_loading) const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator())),
          if (_error != null) Text(_error!, style: TextStyle(color: c.muted)),
          for (final item in visible)
            InkWell(
              onTap: () => openSession(context, item.sessionId),
              borderRadius: BorderRadius.circular(12),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(color: _tint(c, item.kind).withValues(alpha: 0.14), borderRadius: BorderRadius.circular(9)),
                    child: Icon(_icon(item.kind), size: 17, color: _tint(c, item.kind)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Row(children: [
                        Expanded(child: Text(item.label ?? item.kind, style: const TextStyle(fontWeight: FontWeight.w600))),
                        Text(formatAgo(item.at, now), style: TextStyle(color: c.faint, fontSize: 12.5)),
                      ]),
                      Text(item.title ?? '', style: TextStyle(color: c.muted, fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis),
                      if (item.text != null && item.text!.isNotEmpty)
                        Padding(padding: const EdgeInsets.only(top: 2), child: Text(item.text!, style: TextStyle(color: c.faint, fontSize: 13), maxLines: 2, overflow: TextOverflow.ellipsis)),
                    ]),
                  ),
                ]),
              ),
            ),
        ],
      ),
    );
  }
}
