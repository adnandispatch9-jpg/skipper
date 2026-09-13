import 'package:flutter/material.dart';

import '../api/models.dart';
import '../core/format.dart';
import '../navigation.dart';
import '../theme.dart';

/// A "needs you" row: permission prompts show the command, waiting sessions show the question or last reply.
class AttentionRow extends StatelessWidget {
  const AttentionRow({super.key, required this.session, required this.now, this.first = false});
  final SessionSummary session;
  final int now;
  final bool first;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final permission = session.state == 'permission';
    final question = session.attention?.kind == 'question';
    final detail = permission
        ? (session.attention?.message ?? session.lastTool?.target ?? 'Waiting for permission')
        : (question ? (session.attention?.message ?? session.lastText) : session.lastText) ?? 'Finished its turn';
    return InkWell(
      onTap: () => openSession(context, session.id, conversation: !permission),
      child: Container(
        decoration: BoxDecoration(
          border: first ? null : Border(top: BorderSide(color: c.border.withValues(alpha: 0.6))),
          gradient: permission ? LinearGradient(colors: [c.permission.withValues(alpha: 0.12), c.permission.withValues(alpha: 0)]) : null,
        ),
        padding: const EdgeInsets.all(14),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: c.stateSoft(session.state), borderRadius: BorderRadius.circular(10)),
            child: Icon(permission ? Icons.shield_outlined : (question ? Icons.help_outline : Icons.reply_rounded), size: 18, color: c.stateColor(session.state)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(session.title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15), maxLines: 1, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 3),
              Text(
                detail,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: permission
                    ? TextStyle(fontFamily: 'Menlo', fontSize: 12.5, color: c.permission)
                    : TextStyle(color: c.muted, height: 1.35),
              ),
              const SizedBox(height: 3),
              Text('${session.project} · ${formatAgo(session.attention?.at ?? session.updatedAt, now)}', style: TextStyle(color: c.faint, fontSize: 12.5)),
            ]),
          ),
        ]),
      ),
    );
  }
}

class InFlightCard extends StatelessWidget {
  const InFlightCard({super.key, required this.session, required this.now});
  final SessionSummary session;
  final int now;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final sleeping = session.state == 'sleeping' && session.loop != null;
    final line = sleeping ? (session.loop!.reason ?? 'Waiting for the next wakeup') : (session.current ?? session.lastText ?? '');
    final meta = [
      session.project,
      if (session.background) 'background',
      if (session.agentsRunning > 0) '${session.agentsRunning} subagent${session.agentsRunning == 1 ? '' : 's'} running',
      if (session.prCount > 0) '${session.prCount} PR',
    ].join(' · ');
    return SurfaceCard(
      onTap: () => openSession(context, session.id),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(session.title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15), maxLines: 1, overflow: TextOverflow.ellipsis)),
          if (sleeping)
            Text(formatCountdown(session.loop!.wakeAt, now), style: TextStyle(fontFamily: 'Menlo', color: c.sleeping, fontWeight: FontWeight.w600))
          else if (session.turnStartedAt != null)
            Text('running ${formatDuration(now - session.turnStartedAt!)}', style: TextStyle(color: c.muted, fontSize: 12.5)),
        ]),
        if (line.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(line, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: c.muted, height: 1.35)),
        ],
        if (session.todoTotal > 0) ...[
          const SizedBox(height: 10),
          Segments(done: session.todoDone, total: session.todoTotal.clamp(1, 12), color: sleeping ? c.sleeping : c.working),
        ],
        const SizedBox(height: 10),
        Text(meta, style: TextStyle(color: c.faint, fontSize: 12.5)),
      ]),
    );
  }
}

class SessionRow extends StatelessWidget {
  const SessionRow({super.key, required this.session, required this.now, this.first = false});
  final SessionSummary session;
  final int now;
  final bool first;

  String _subtitle() {
    final parts = <String>[session.project];
    if (session.state == 'permission') {
      parts.add('Permission');
    } else if (session.attention?.kind == 'question') {
      parts.add('Asked you a question');
    }
    if (session.background && session.live) parts.add('Background');
    if (session.todoTotal > 0) parts.add('${session.todoDone}/${session.todoTotal}');
    if (session.agentsRunning > 0) parts.add('${session.agentsRunning} agent${session.agentsRunning == 1 ? '' : 's'}');
    if (session.prCount > 0) parts.add('${session.prCount} PR');
    return parts.join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final when = session.state == 'sleeping' && session.loop != null ? formatCountdown(session.loop!.wakeAt, now) : formatAgo(session.updatedAt, now);
    return InkWell(
      onTap: () => openSession(context, session.id),
      child: Container(
        constraints: const BoxConstraints(minHeight: 60),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(border: first ? null : Border(top: BorderSide(color: c.border.withValues(alpha: 0.6)))),
        child: Row(children: [
          StateDot(session.state),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(session.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
              Text(_subtitle(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 12.5, color: session.state == 'permission' ? c.permission : c.muted)),
            ]),
          ),
          const SizedBox(width: 8),
          Text(when, style: TextStyle(color: c.faint, fontSize: 12.5)),
        ]),
      ),
    );
  }
}

/// Groups rows in one rounded card with hairline separators.
class GroupCard extends StatelessWidget {
  const GroupCard({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      decoration: BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(14), border: Border.all(color: c.border)),
      clipBehavior: Clip.antiAlias,
      child: Material(type: MaterialType.transparency, child: Column(children: children)),
    );
  }
}

class ConnectionBanner extends StatelessWidget {
  const ConnectionBanner({super.key, required this.message, this.onRetry});
  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(color: c.waitingSoft, borderRadius: BorderRadius.circular(12)),
      child: Row(children: [
        Icon(Icons.wifi_off_rounded, color: c.waiting, size: 18),
        const SizedBox(width: 10),
        Expanded(child: Text(message, style: TextStyle(color: c.text, fontSize: 13))),
        if (onRetry != null) TextButton(onPressed: onRetry, child: const Text('Retry')),
      ]),
    );
  }
}
