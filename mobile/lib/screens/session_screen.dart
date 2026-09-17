import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../core/format.dart';
import '../navigation.dart';
import '../state/providers.dart';
import '../theme.dart';

class SessionScreen extends ConsumerStatefulWidget {
  const SessionScreen({super.key, required this.sessionId, this.startOnConversation = false});
  final String sessionId;
  final bool startOnConversation;

  @override
  ConsumerState<SessionScreen> createState() => _SessionScreenState();
}

class _SessionScreenState extends ConsumerState<SessionScreen> {
  late int _tab = widget.startOnConversation ? 1 : 0;
  SessionDetail? _detail;
  Conversation _conversation = const Conversation();
  String? _error;
  int? _loadedFor;
  bool _sending = false;
  final _composer = TextEditingController();
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _composer.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final client = ref.read(clientProvider);
    if (client == null) return;
    try {
      final results = await Future.wait([client.session(widget.sessionId), client.conversation(widget.sessionId)]);
      if (!mounted) return;
      setState(() {
        _detail = results[0] as SessionDetail;
        _conversation = results[1] as Conversation;
        _loadedFor = _detail!.summary.updatedAt;
        _error = null;
      });
    } on SkipperException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _send() async {
    final text = _composer.text.trim();
    final client = ref.read(clientProvider);
    if (text.isEmpty || client == null || _sending) return;
    setState(() => _sending = true);
    try {
      await client.sendMessage(widget.sessionId, text);
      _composer.clear();
      HapticFeedback.mediumImpact();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Sent. Claude continues in the background on your Mac.')));
    } on SkipperException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final live = ref.watch(liveProvider);
    final summary = live.sessions.where((s) => s.id == widget.sessionId).firstOrNull ?? _detail?.summary;
    if (summary != null && _detail != null && summary.updatedAt != _loadedFor) {
      _loadedFor = summary.updatedAt;
      WidgetsBinding.instance.addPostFrameCallback((_) => _load());
    }

    return Scaffold(
      appBar: AppBar(
        actions: [
          IconButton(
            tooltip: 'Ask Skipper about this session',
            icon: Icon(Icons.mic_rounded, color: c.accent),
            onPressed: summary == null ? null : () => openVoice(context, ask: 'What is happening in "${summary.title}"?'),
          ),
        ],
      ),
      body: summary == null
          ? Center(child: _error != null ? Text(_error!, style: TextStyle(color: c.muted)) : const CircularProgressIndicator())
          : Column(children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(summary.title, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700, letterSpacing: -0.4, height: 1.2)),
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    StateChip(summary.state, stateLabel(summary.state)),
                    if (summary.background && summary.live) StateChip('ended', 'Background'),
                    Text(
                      [summary.project, if (summary.branch != null && summary.branch != 'HEAD') summary.branch!, if (summary.model != null) summary.model!.replaceFirst('claude-', '')].join(' · '),
                      style: TextStyle(color: c.muted, fontSize: 12.5),
                    ),
                  ]),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: CupertinoLikeSegments(
                      labels: const ['Overview', 'Conversation', 'Notes'],
                      selected: _tab,
                      onChanged: (i) => setState(() => _tab = i),
                    ),
                  ),
                ]),
              ),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: _load,
                  child: switch (_tab) {
                    0 => _Overview(summary: summary, detail: _detail, now: live.now),
                    1 => _ConversationList(conversation: _conversation, loading: _detail == null),
                    _ => _Notes(detail: _detail, sessionId: widget.sessionId, onChanged: _load),
                  },
                ),
              ),
              if (!live.readOnly)
                  Container(
                    decoration: BoxDecoration(color: c.surface, border: Border(top: BorderSide(color: c.border))),
                    padding: EdgeInsets.fromLTRB(12, 10, 12, 10 + MediaQuery.paddingOf(context).bottom),
                    child: Row(children: [
                      Expanded(
                        child: TextField(
                          controller: _composer,
                          minLines: 1,
                          maxLines: 5,
                          textInputAction: TextInputAction.send,
                          onSubmitted: (_) => _send(),
                          decoration: InputDecoration(
                            hintText: summary.state == 'waiting' ? 'Answer Claude…' : 'Tell Claude what to do next…',
                            filled: true,
                            fillColor: c.surface2,
                            isDense: true,
                            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide.none),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton.filled(
                        style: IconButton.styleFrom(backgroundColor: c.accent, foregroundColor: c.onAccent, fixedSize: const Size(44, 44)),
                        onPressed: _sending ? null : _send,
                        icon: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send_rounded, size: 20),
                      ),
                    ]),
                  ),
            ]),
    );
  }
}

class CupertinoLikeSegments extends StatelessWidget {
  const CupertinoLikeSegments({super.key, required this.labels, required this.selected, required this.onChanged});
  final List<String> labels;
  final int selected;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(color: c.surface2, borderRadius: BorderRadius.circular(11)),
      child: Row(children: [
        for (var i = 0; i < labels.length; i++)
          Expanded(
            child: GestureDetector(
              onTap: () => onChanged(i),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                height: 34,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: i == selected ? c.border : Colors.transparent, borderRadius: BorderRadius.circular(8)),
                child: Text(labels[i], style: TextStyle(fontSize: 13, fontWeight: i == selected ? FontWeight.w600 : FontWeight.w500, color: i == selected ? c.text : c.muted)),
              ),
            ),
          ),
      ]),
    );
  }
}

class _Overview extends StatelessWidget {
  const _Overview({required this.summary, required this.detail, required this.now});
  final SessionSummary summary;
  final SessionDetail? detail;
  final int now;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final todos = detail?.todos ?? const <Todo>[];
    final agents = detail?.agents ?? const <Subagent>[];
    final attention = summary.attention;
    return ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
      if (summary.state == 'permission' && attention != null) ...[
        SurfaceCard(
          borderColor: c.permission,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Icon(Icons.shield_outlined, color: c.permission, size: 18),
              const SizedBox(width: 8),
              Text('Claude needs permission', style: TextStyle(color: c.permission, fontWeight: FontWeight.w600)),
            ]),
            const SizedBox(height: 10),
            SelectableText(attention.message ?? '', style: const TextStyle(fontFamily: 'Menlo', fontSize: 13)),
            const SizedBox(height: 10),
            Text('Approve or deny it in the terminal on your Mac. This updates as soon as you answer.', style: TextStyle(color: c.muted, fontSize: 13)),
          ]),
        ),
        const SizedBox(height: 12),
      ],
      if (summary.current != null || summary.lastText != null || summary.lastTool != null)
        SurfaceCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SectionLabel('Now', trailing: Text(formatAgo(summary.updatedAt, now), style: TextStyle(color: c.faint, fontSize: 12.5))),
            const SizedBox(height: 8),
            Text(summary.current ?? summary.lastText ?? '', style: const TextStyle(height: 1.45), maxLines: 8, overflow: TextOverflow.ellipsis),
            if (summary.lastTool != null && summary.lastTool!.pending) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(color: c.bg, borderRadius: BorderRadius.circular(10), border: Border.all(color: c.border)),
                child: Row(children: [
                  Text(summary.lastTool!.name, style: TextStyle(color: c.muted, fontWeight: FontWeight.w600, fontSize: 12)),
                  const SizedBox(width: 8),
                  Expanded(child: Text(summary.lastTool!.target ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontFamily: 'Menlo', color: c.muted, fontSize: 12))),
                ]),
              ),
            ],
          ]),
        ),
      if (summary.loop != null) ...[
        const SizedBox(height: 12),
        SurfaceCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const SectionLabel('Loop'),
            const SizedBox(height: 8),
            Text(formatCountdown(summary.loop!.wakeAt, now), style: TextStyle(fontSize: 30, fontWeight: FontWeight.w700, color: c.sleeping, fontFamily: 'Menlo')),
            Text('until the next iteration', style: TextStyle(color: c.muted)),
            if (summary.loop!.reason != null) ...[const SizedBox(height: 8), Text(summary.loop!.reason!, style: const TextStyle(height: 1.4))],
          ]),
        ),
      ],
      if (todos.isNotEmpty) ...[
        const SizedBox(height: 12),
        SurfaceCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SectionLabel('Plan', trailing: Text('${todos.where((t) => t.status == 'completed').length} of ${todos.length}', style: TextStyle(color: c.muted, fontSize: 12.5))),
            const SizedBox(height: 10),
            for (final t in todos) _TodoRow(todo: t),
          ]),
        ),
      ],
      if (agents.isNotEmpty) ...[
        const SizedBox(height: 12),
        SurfaceCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SectionLabel('Subagents', trailing: Text('${agents.where((a) => a.status == 'running').length} running', style: TextStyle(color: c.muted, fontSize: 12.5))),
            const SizedBox(height: 8),
            for (final a in agents)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(children: [
                  StateDot(a.status == 'running' ? 'working' : (a.status == 'failed' ? 'permission' : 'ended')),
                  const SizedBox(width: 10),
                  Expanded(child: Text(a.name, maxLines: 1, overflow: TextOverflow.ellipsis)),
                  Text(
                    a.status == 'running' && a.startedAt != null ? formatDuration(now - a.startedAt!) : a.status,
                    style: TextStyle(color: c.faint, fontSize: 12.5),
                  ),
                ]),
              ),
          ]),
        ),
      ],
    ]);
  }
}

class _TodoRow extends StatelessWidget {
  const _TodoRow({required this.todo});
  final Todo todo;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final done = todo.status == 'completed';
    final active = todo.status == 'in_progress';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          width: 18,
          height: 18,
          margin: const EdgeInsets.only(top: 1),
          decoration: BoxDecoration(
            color: done ? c.working : Colors.transparent,
            borderRadius: BorderRadius.circular(6),
            border: done ? null : Border.all(color: active ? c.accent : c.border, width: 1.8),
          ),
          child: done ? Icon(Icons.check, size: 13, color: c.surface) : null,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(todo.content, style: TextStyle(color: done ? c.faint : c.text, decoration: done ? TextDecoration.lineThrough : null)),
            if (active && todo.activeForm != null && todo.activeForm != todo.content) Text(todo.activeForm!, style: TextStyle(color: c.accent, fontSize: 12.5)),
          ]),
        ),
      ]),
    );
  }
}

class _ConversationList extends StatelessWidget {
  const _ConversationList({required this.conversation, required this.loading});
  final Conversation conversation;
  final bool loading;

  String get _missingLabel {
    if (conversation.truncated) return 'This session is too long to load whole. Older messages are on your Mac.';
    final n = conversation.dropped;
    return 'Showing the latest messages. $n older ${n == 1 ? 'item is' : 'items are'} not loaded.';
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final items = conversation.messages;
    if (loading) return const Center(child: CircularProgressIndicator());
    if (items.isEmpty) return ListView(children: [Padding(padding: const EdgeInsets.all(32), child: Text('No messages yet.', textAlign: TextAlign.center, style: TextStyle(color: c.muted)))]);
    final reversed = items.reversed.toList();
    final notice = conversation.incomplete ? 1 : 0;
    return ListView.builder(
      reverse: true,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      itemCount: reversed.length + notice,
      itemBuilder: (context, i) {
        if (notice == 1 && i == reversed.length) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Semantics(
              label: _missingLabel,
              child: Text(_missingLabel, textAlign: TextAlign.center, style: TextStyle(color: c.muted, fontSize: 12.5)),
            ),
          );
        }
        final item = reversed[i];
        final child = switch (item.role) {
          'user' => Align(
              alignment: Alignment.centerRight,
              child: Container(
                constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.82),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(color: c.accentSoft, borderRadius: const BorderRadius.only(topLeft: Radius.circular(18), topRight: Radius.circular(18), bottomLeft: Radius.circular(18), bottomRight: Radius.circular(4))),
                child: _ClippableText(text: item.text, clipped: item.clipped, style: const TextStyle(height: 1.4)),
              ),
            ),
          'tools' => Align(
              alignment: Alignment.centerLeft,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(borderRadius: BorderRadius.circular(999), border: Border.all(color: c.border)),
                child: Text('${item.names.join(', ')} · ${item.count} tool${item.count == 1 ? '' : 's'}', style: TextStyle(color: c.muted, fontSize: 12.5)),
              ),
            ),
          _ => Align(alignment: Alignment.centerLeft, child: _ClippableText(text: item.text, clipped: item.clipped, style: const TextStyle(height: 1.5))),
        };
        return Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: child);
      },
    );
  }
}

/// A message, with a visible marker when the server only sent part of it. A silent
/// ellipsis reads as the end of the message, which is what people complained about.
class _ClippableText extends StatelessWidget {
  const _ClippableText({required this.text, required this.clipped, this.style});
  final String text;
  final bool clipped;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    if (!clipped) return SelectableText(text, style: style);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        SelectableText(text, style: style),
        const SizedBox(height: 6),
        Semantics(
          label: 'This message was shortened. The rest is on your Mac.',
          child: Text('Message shortened — the rest is on your Mac', style: TextStyle(color: c.muted, fontSize: 12, fontStyle: FontStyle.italic)),
        ),
      ],
    );
  }
}

class _Notes extends ConsumerStatefulWidget {
  const _Notes({required this.detail, required this.sessionId, required this.onChanged});
  final SessionDetail? detail;
  final String sessionId;
  final Future<void> Function() onChanged;

  @override
  ConsumerState<_Notes> createState() => _NotesState();
}

class _NotesState extends ConsumerState<_Notes> {
  final _input = TextEditingController();

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    final text = _input.text.trim();
    final client = ref.read(clientProvider);
    if (text.isEmpty || client == null) return;
    try {
      await client.addNote(widget.sessionId, text);
      _input.clear();
      await widget.onChanged();
    } on SkipperException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final notes = widget.detail?.notes ?? const <Note>[];
    final readOnly = ref.watch(liveProvider.select((s) => s.readOnly));
    return ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 24), children: [
      Text('Private notes. They stay in Skipper on your Mac and are never sent unless you choose to.', style: TextStyle(color: c.muted, fontSize: 13)),
      const SizedBox(height: 12),
      if (!readOnly)
        TextField(
          controller: _input,
          minLines: 2,
          maxLines: 6,
          decoration: InputDecoration(
            hintText: 'Write a note…',
            filled: true,
            fillColor: c.surface2,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
            suffixIcon: IconButton(icon: const Icon(Icons.add_rounded), onPressed: _add),
          ),
        ),
      const SizedBox(height: 12),
      for (final n in notes) ...[
        SurfaceCard(child: SelectableText(n.text, style: const TextStyle(height: 1.45))),
        const SizedBox(height: 8),
      ],
    ]);
  }
}
