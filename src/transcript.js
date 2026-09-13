// Folds Claude Code transcript records (one JSON object per line) into a
// compact session summary. Pure and incremental: feed records in file order.

const TEXT_LIMIT = 600;
const AGENT_TOOLS = new Set(['Agent', 'Task']);

export function createSummary(sessionId) {
  return {
    id: sessionId,
    cwd: null,
    cwdCounts: new Map(), // the directory a session mostly works in names its project
    gitBranch: null,
    version: null,
    model: null,
    permissionMode: null,
    customTitle: null,
    agentName: null,
    aiTitle: null,
    firstPrompt: null,
    lastPrompt: null,
    lastPromptAt: null,
    startedAt: null,
    updatedAt: null,
    lastKind: null, // 'turn-end' once Claude hands control back to the user
    turns: 0,
    lastText: null,
    lastTextAt: null,
    lastTool: null,
    todos: [],
    todosAt: null,
    agents: new Map(),
    workflows: new Map(),
    loop: null,
    prs: new Map(),
    artifacts: new Map(),
    cost: null,
  };
}

function clip(text, limit = TEXT_LIMIT) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

function toMs(timestamp) {
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : null;
}

function isHttps(url) {
  return typeof url === 'string' && /^https:\/\//i.test(url);
}

function tag(text, name) {
  const match = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? match[1].trim() : null;
}

function applyNotification(s, text, at) {
  const toolUseId = tag(text, 'tool-use-id');
  const status = tag(text, 'status');
  if (!toolUseId || !status) return;
  const target = s.agents.get(toolUseId) || s.workflows.get(toolUseId);
  if (!target) return;
  target.status = status === 'completed' ? 'completed' : status === 'killed' ? 'stopped' : status;
  target.endedAt = at;
  const result = clip(tag(text, 'result') || tag(text, 'summary'), 400);
  if (result) target.result = result;
}

function applyToolUse(s, block, at) {
  const input = block.input || {};
  s.lastTool = { name: block.name, at };

  if (block.name === 'TodoWrite' && Array.isArray(input.todos)) {
    s.todos = input.todos.map((t) => ({
      content: clip(String(t.content ?? ''), 300),
      activeForm: clip(String(t.activeForm ?? ''), 300),
      status: ['pending', 'in_progress', 'completed'].includes(t.status) ? t.status : 'pending',
    }));
    s.todosAt = at;
  } else if (AGENT_TOOLS.has(block.name) && (input.prompt || input.description)) {
    s.agents.set(block.id, {
      toolUseId: block.id,
      description: clip(input.description, 160),
      agentType: input.subagent_type || 'general-purpose',
      name: clip(input.name, 80),
      model: input.model || null,
      background: Boolean(input.run_in_background),
      isolation: input.isolation || null,
      status: 'running',
      startedAt: at,
      endedAt: null,
      result: null,
    });
  } else if (block.name === 'Workflow') {
    const script = typeof input.script === 'string' ? input.script : '';
    s.workflows.set(block.id, {
      toolUseId: block.id,
      name: clip(input.name || script.match(/name:\s*['"`]([^'"`]+)['"`]/)?.[1] || 'workflow', 80),
      description: clip(script.match(/description:\s*['"`]([^'"`]+)['"`]/)?.[1], 200),
      status: 'running',
      startedAt: at,
      endedAt: null,
    });
  } else if (block.name === 'ScheduleWakeup') {
    if (input.stop) {
      s.loop = { active: false, at, reason: null, wakeAt: null };
    } else {
      const delay = Number(input.delaySeconds) || 0;
      s.loop = {
        active: true,
        at,
        reason: clip(input.reason, 240),
        delaySeconds: delay,
        wakeAt: at != null ? at + delay * 1000 : null,
      };
    }
  }
}

function applyUser(s, record, at) {
  const content = record.message?.content;
  if (typeof content === 'string') {
    if (content.includes('<task-notification>')) return applyNotification(s, content, at);
    if (!record.isMeta && !content.startsWith('<')) {
      s.firstPrompt ??= clip(content, 300);
      s.lastPrompt = clip(content, 300);
      s.lastPromptAt = at;
    }
    return;
  }
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      if (block.text.includes('<task-notification>')) applyNotification(s, block.text, at);
      else if (!record.isMeta && !block.text.startsWith('<')) {
        s.firstPrompt ??= clip(block.text, 300);
        s.lastPrompt = clip(block.text, 300);
        s.lastPromptAt = at;
      }
    } else if (block.type === 'tool_result') {
      const agent = s.agents.get(block.tool_use_id);
      const workflow = s.workflows.get(block.tool_use_id);
      if (agent) {
        if (block.is_error) Object.assign(agent, { status: 'failed', endedAt: at });
        else if (!agent.background) Object.assign(agent, { status: 'completed', endedAt: at });
      } else if (workflow && block.is_error) {
        Object.assign(workflow, { status: 'failed', endedAt: at });
      }
    }
  }
}

export function applyRecord(s, record) {
  if (!record || typeof record !== 'object' || record.isSidechain) return;
  const at = toMs(record.timestamp);
  if (at != null) {
    if (s.startedAt == null || at < s.startedAt) s.startedAt = at;
    if (s.updatedAt == null || at > s.updatedAt) s.updatedAt = at;
  }
  if (record.cwd) {
    const count = (s.cwdCounts.get(record.cwd) || 0) + 1;
    s.cwdCounts.set(record.cwd, count);
    if (!s.cwd || count > (s.cwdCounts.get(s.cwd) || 0)) s.cwd = record.cwd;
  }
  if (record.gitBranch) s.gitBranch = record.gitBranch;
  if (record.version) s.version = record.version;

  switch (record.type) {
    case 'custom-title':
      s.customTitle = clip(record.customTitle, 120);
      break;
    case 'agent-name':
      s.agentName = clip(record.agentName, 120);
      break;
    case 'ai-title':
      s.aiTitle = clip(record.aiTitle, 120);
      break;
    case 'last-prompt':
      s.lastPrompt = clip(record.lastPrompt, 300) ?? s.lastPrompt;
      break;
    case 'permission-mode':
      s.permissionMode = record.permissionMode || s.permissionMode;
      break;
    case 'pr-link':
      if (isHttps(record.prUrl)) {
        s.prs.set(record.prUrl, { url: record.prUrl, number: record.prNumber ?? null, repo: record.prRepository ?? null, at });
      }
      break;
    case 'frame-link':
      if (isHttps(record.frameUrl)) {
        s.artifacts.set(record.frameUrl, { url: record.frameUrl, title: clip(record.title, 120) || 'Artifact', at });
      }
      break;
    case 'cost-state':
      s.cost = {
        usd: Number(record.totalCostUSD) || 0,
        linesAdded: Number(record.totalLinesAdded) || 0,
        linesRemoved: Number(record.totalLinesRemoved) || 0,
      };
      break;
    case 'system':
      if (record.subtype === 'turn_duration') {
        s.turns += 1;
        s.lastKind = 'turn-end';
      }
      break;
    case 'assistant': {
      s.lastKind = 'activity';
      const message = record.message || {};
      if (message.model && !message.model.startsWith('<')) s.model = message.model;
      if (!Array.isArray(message.content)) break;
      for (const block of message.content) {
        if (block.type === 'text') {
          const text = clip(block.text);
          if (text) {
            s.lastText = text;
            s.lastTextAt = at;
          }
        } else if (block.type === 'tool_use') {
          applyToolUse(s, block, at);
        }
      }
      break;
    }
    case 'user':
      s.lastKind = 'activity';
      applyUser(s, record, at);
      break;
    default:
      break;
  }
}

export function sessionTitle(s) {
  return s.customTitle || s.agentName || s.aiTitle || s.firstPrompt || s.id.slice(0, 8);
}
