// A tiny read-only MCP server (stdio, JSON-RPC 2.0) that gives the voice agent
// Skipper's view of every session. It reads from the running Skipper server over
// loopback, so answers always reflect live state. No dependencies.

import readline from 'node:readline';

const PROTOCOL_VERSION = '2025-06-18';

export const TOOLS = [
  {
    name: 'list_sessions',
    description: 'All Claude Code sessions Skipper knows, newest first: id, title, project, state (permission = needs permission, waiting = needs the user, working, sleeping = loop waiting for its next wakeup, ended), background flag, plan progress, current step, last tool, running subagents, loop wakeup, PR count and what needs attention.',
    inputSchema: { type: 'object', properties: { include_ended: { type: 'boolean', description: 'Also include ended sessions (default: only the 15 most recent ended ones).' } } },
  },
  {
    name: 'get_session',
    description: 'Full detail for one session: plan/todos, task list, subagents with status, workflows, loop, PRs, links, tokens, notes, last prompt and last reply.',
    inputSchema: { type: 'object', properties: { session_id: { type: 'string' } }, required: ['session_id'] },
  },
  {
    name: 'get_conversation',
    description: 'The recent readable conversation of one session: what the user said, what Claude replied, and which tools ran in between.',
    inputSchema: { type: 'object', properties: { session_id: { type: 'string' }, limit: { type: 'number', description: 'How many items (default 30, max 80).' } }, required: ['session_id'] },
  },
  {
    name: 'get_activity',
    description: 'What happened recently across all sessions, newest first: permission prompts, questions, finished turns, loop ticks, subagents started and finished, PRs, workflows, ended sessions.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'How many items (default 40, max 150).' } } },
  },
  {
    name: 'get_usage',
    description: 'Token usage per day, project and model for the last N days (1, 7, 14 or 30).',
    inputSchema: { type: 'object', properties: { days: { type: 'number' } } },
  },
  {
    name: 'propose_message',
    description: 'Propose sending a message to a session on the user\'s behalf. Nothing is sent: the user sees a confirmation card and decides. Use only when the user asks you to tell a session something.',
    inputSchema: { type: 'object', properties: { session_id: { type: 'string' }, text: { type: 'string', description: 'The exact message to send.' } }, required: ['session_id', 'text'] },
  },
];

const clamp = (value, min, max, fallback) => (Number.isFinite(Number(value)) ? Math.min(Math.max(Number(value), min), max) : fallback);
const ID = /^[0-9a-f-]{36}$/i;

export function createToolRunner({ baseUrl, agentKey, fetchImpl = fetch }) {
  const get = async (pathname) => {
    const res = await fetchImpl(`${baseUrl}${pathname}`, { headers: { 'X-Skipper-Agent-Key': agentKey } });
    if (!res.ok) throw new Error(`Skipper answered ${res.status}`);
    return res.json();
  };
  const compactSession = (s) => ({
    id: s.id, title: s.title, project: s.project, state: s.state, background: s.background, branch: s.branch,
    updatedAt: s.updatedAt, turnStartedAt: s.turnStartedAt, plan: s.todoTotal ? `${s.todoDone}/${s.todoTotal}` : null,
    current: s.current, lastTool: s.lastTool, agentsRunning: s.agentsRunning, agentsTotal: s.agentsTotal,
    loop: s.loop, prCount: s.prCount, team: s.team, attention: s.attention,
  });

  return async function run(name, args = {}) {
    switch (name) {
      case 'list_sessions': {
        const data = await get('/api/sessions');
        const live = data.sessions.filter((s) => s.state !== 'ended');
        const ended = data.sessions.filter((s) => s.state === 'ended');
        return { now: data.now, sessions: [...live, ...(args.include_ended ? ended : ended.slice(0, 15))].map(compactSession) };
      }
      case 'get_session': {
        if (!ID.test(String(args.session_id))) throw new Error('session_id must be a session id from list_sessions');
        return get(`/api/sessions/${args.session_id}`);
      }
      case 'get_conversation': {
        if (!ID.test(String(args.session_id))) throw new Error('session_id must be a session id from list_sessions');
        return get(`/api/sessions/${args.session_id}/conversation?limit=${clamp(args.limit, 1, 80, 30)}`);
      }
      case 'get_activity':
        return get(`/api/activity?limit=${clamp(args.limit, 1, 150, 40)}`);
      case 'get_usage':
        return get(`/api/usage?days=${[1, 7, 14, 30].includes(Number(args.days)) ? Number(args.days) : 7}`);
      case 'propose_message':
        if (!ID.test(String(args.session_id)) || typeof args.text !== 'string' || !args.text.trim()) throw new Error('Needs a session_id and the message text');
        return { proposed: true, note: 'The user now sees a confirmation card. Tell them briefly what you proposed; do not claim it was sent.' };
      default:
        throw new Error(`Unknown tool ${name}`);
    }
  };
}

export function handleRpc(message, run) {
  const reply = (result) => ({ jsonrpc: '2.0', id: message.id, result });
  switch (message.method) {
    case 'initialize':
      return reply({ protocolVersion: message.params?.protocolVersion || PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'skipper', version: '1' } });
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call':
      return run(message.params?.name, message.params?.arguments || {}).then(
        (data) => reply({ content: [{ type: 'text', text: JSON.stringify(data) }] }),
        (error) => reply({ content: [{ type: 'text', text: error.message }], isError: true }),
      );
    case 'ping':
      return reply({});
    default:
      if (message.id === undefined) return null; // notification
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
  }
}

export function serveStdio({ baseUrl = process.env.SKIPPER_URL, agentKey = process.env.SKIPPER_AGENT_KEY } = {}) {
  const run = createToolRunner({ baseUrl, agentKey });
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const response = await handleRpc(message, run);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}
