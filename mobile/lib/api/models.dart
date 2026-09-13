/// Plain data classes for Skipper's JSON API. Parsing is forgiving: missing fields get defaults.
library;

T? _as<T>(Object? v) => v is T ? v : null;
int? _int(Object? v) => v is num ? v.toInt() : null;

class LastTool {
  const LastTool({required this.name, this.target, this.at, this.pending = false});
  final String name;
  final String? target;
  final int? at;
  final bool pending;

  static LastTool? fromJson(Object? json) {
    if (json is! Map) return null;
    final name = _as<String>(json['name']);
    if (name == null) return null;
    return LastTool(name: name, target: _as<String>(json['target']), at: _int(json['at']), pending: json['pending'] == true);
  }
}

class Attention {
  const Attention({required this.kind, this.message, this.at});
  final String kind;
  final String? message;
  final int? at;

  static Attention? fromJson(Object? json) {
    if (json is! Map || json['kind'] is! String) return null;
    return Attention(kind: json['kind'] as String, message: _as<String>(json['message']), at: _int(json['at']));
  }
}

class LoopInfo {
  const LoopInfo({required this.wakeAt, this.reason});
  final int wakeAt;
  final String? reason;

  static LoopInfo? fromJson(Object? json) {
    if (json is! Map || _int(json['wakeAt']) == null) return null;
    return LoopInfo(wakeAt: _int(json['wakeAt'])!, reason: _as<String>(json['reason']));
  }
}

class SessionSummary {
  const SessionSummary({
    required this.id,
    required this.title,
    required this.project,
    required this.state,
    this.live = false,
    this.background = false,
    this.branch,
    this.model,
    this.updatedAt,
    this.turnStartedAt,
    this.todoDone = 0,
    this.todoTotal = 0,
    this.current,
    this.lastText,
    this.lastTool,
    this.agentsRunning = 0,
    this.agentsTotal = 0,
    this.loop,
    this.prCount = 0,
    this.team,
    this.attention,
  });

  final String id, title, project, state;
  final bool live, background;
  final String? branch, model, current, lastText, team;
  final int? updatedAt, turnStartedAt;
  final int todoDone, todoTotal, agentsRunning, agentsTotal, prCount;
  final LastTool? lastTool;
  final LoopInfo? loop;
  final Attention? attention;

  bool get needsYou => state == 'permission' || state == 'waiting';

  factory SessionSummary.fromJson(Map<String, dynamic> json) => SessionSummary(
        id: json['id'] as String,
        title: _as<String>(json['title']) ?? 'Untitled',
        project: _as<String>(json['project']) ?? 'unknown',
        state: _as<String>(json['state']) ?? 'ended',
        live: json['live'] == true,
        background: json['background'] == true,
        branch: _as<String>(json['branch']),
        model: _as<String>(json['model']),
        updatedAt: _int(json['updatedAt']),
        turnStartedAt: _int(json['turnStartedAt']),
        todoDone: _int(json['todoDone']) ?? 0,
        todoTotal: _int(json['todoTotal']) ?? 0,
        current: _as<String>(json['current']),
        lastText: _as<String>(json['lastText']),
        lastTool: LastTool.fromJson(json['lastTool']),
        agentsRunning: _int(json['agentsRunning']) ?? 0,
        agentsTotal: _int(json['agentsTotal']) ?? 0,
        loop: LoopInfo.fromJson(json['loop']),
        prCount: _int(json['prCount']) ?? 0,
        team: _as<String>(json['team']),
        attention: Attention.fromJson(json['attention']),
      );
}

class Todo {
  const Todo({required this.content, required this.status, this.activeForm});
  final String content, status;
  final String? activeForm;

  static Todo? fromJson(Object? json) {
    if (json is! Map || json['content'] is! String) return null;
    return Todo(content: json['content'] as String, status: _as<String>(json['status']) ?? 'pending', activeForm: _as<String>(json['activeForm']));
  }
}

class Subagent {
  const Subagent({required this.name, required this.status, this.startedAt, this.endedAt, this.model});
  final String name, status;
  final int? startedAt, endedAt;
  final String? model;

  static Subagent? fromJson(Object? json) {
    if (json is! Map) return null;
    return Subagent(
      name: _as<String>(json['description']) ?? _as<String>(json['name']) ?? _as<String>(json['type']) ?? 'Subagent',
      status: _as<String>(json['status']) ?? 'running',
      startedAt: _int(json['startedAt']),
      endedAt: _int(json['endedAt']),
      model: _as<String>(json['model']),
    );
  }
}

class Note {
  const Note({required this.id, required this.text, this.at});
  final String id, text;
  final int? at;

  static Note? fromJson(Object? json) {
    if (json is! Map || json['id'] is! String || json['text'] is! String) return null;
    return Note(id: json['id'] as String, text: json['text'] as String, at: _int(json['updatedAt']) ?? _int(json['createdAt']));
  }
}

class SessionDetail {
  const SessionDetail({required this.summary, this.todos = const [], this.agents = const [], this.notes = const [], this.lastPrompt, this.cwd});
  final SessionSummary summary;
  final List<Todo> todos;
  final List<Subagent> agents;
  final List<Note> notes;
  final String? lastPrompt, cwd;

  factory SessionDetail.fromJson(Map<String, dynamic> json) => SessionDetail(
        summary: SessionSummary.fromJson(json),
        todos: [for (final t in _as<List>(json['todos']) ?? const []) ?Todo.fromJson(t)],
        agents: [for (final a in _as<List>(json['agents']) ?? const []) ?Subagent.fromJson(a)],
        notes: [for (final n in _as<List>(json['notes']) ?? const []) ?Note.fromJson(n)],
        lastPrompt: _as<String>(json['lastPrompt']),
        cwd: _as<String>(json['cwd']),
      );
}

/// One item in a session's readable conversation.
class ConversationItem {
  const ConversationItem({required this.role, this.text = '', this.names = const [], this.count = 0, this.at});
  final String role; // user | assistant | tools
  final String text;
  final List<String> names;
  final int count;
  final int? at;

  static ConversationItem? fromJson(Object? json) {
    if (json is! Map || json['role'] is! String) return null;
    return ConversationItem(
      role: json['role'] as String,
      text: _as<String>(json['text']) ?? '',
      names: [for (final n in _as<List>(json['names']) ?? const []) if (n is String) n],
      count: _int(json['count']) ?? 0,
      at: _int(json['at']),
    );
  }
}

class ActivityItem {
  const ActivityItem({required this.sessionId, required this.kind, required this.at, this.title, this.label, this.text});
  final String sessionId, kind;
  final int at;
  final String? title, label, text;

  static ActivityItem? fromJson(Object? json) {
    if (json is! Map || json['sessionId'] is! String || _int(json['at']) == null) return null;
    return ActivityItem(
      sessionId: json['sessionId'] as String,
      kind: _as<String>(json['kind']) ?? 'event',
      at: _int(json['at'])!,
      title: _as<String>(json['title']),
      label: _as<String>(json['text']),
      text: _as<String>(json['detail']),
    );
  }
}

class ServerInfo {
  const ServerInfo({required this.name, required this.readOnly, required this.agent, this.cloudVoice = false});
  final String name;
  final bool readOnly, agent, cloudVoice;

  factory ServerInfo.fromJson(Map<String, dynamic> json) => ServerInfo(
        name: _as<String>(json['name']) ?? 'Mac',
        readOnly: json['readOnly'] == true,
        agent: json['agent'] == true,
        cloudVoice: json['cloudVoice'] == true,
      );
}
