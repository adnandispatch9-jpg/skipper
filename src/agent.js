// The voice agent: headless Claude Code with only Skipper's read-only tools.
// Each question starts `claude -p` and streams its answer back as small events.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import { mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectLanguage } from './speech.js';
import { compactSession } from './mcp.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'skipper.js');
const TOOL_PREFIX = 'mcp__skipper__';
const MAX_TURNS_KEPT = 8;
const CONVERSATION_TTL_MS = 60 * 60_000;
const ANSWER_TIMEOUT_MS = 120_000;

export const SYSTEM_PROMPT = `You are Skipper, a voice assistant for someone who runs many Claude Code sessions on their Mac. They talk to you from their phone and hear your answers read aloud.

You can see everything Skipper sees through your tools: every session and its state, plans, task lists, subagents, loops, workflows, background sessions, pull requests, recent activity and token usage.

How to answer:
- Each question comes with a snapshot of all live sessions (and the most recent ended ones) taken just now. Answer from it directly when it is enough; call tools only for detail it lacks (plans, subagents, conversations, activity, usage, older sessions). Never guess or invent state.
- Speak naturally and briefly: two to four short sentences unless asked for detail. No markdown, no bullet points, no code blocks, no emoji, no URLs, no session ids.
- Name sessions by their title. Say times in words ("for about 20 minutes", "at half past three").
- Put what needs the user first: permission prompts, then questions, then finished work, then what is still running.
- State meanings: permission = waiting for the user to approve a tool in the terminal; waiting = finished its turn and waiting for the user; working = running now; sleeping = a loop waiting for its next wakeup; ended = no longer running.
- If the user asks you to tell a session something, call propose_message with the exact text. Nothing is sent until they confirm, so say you have prepared it for them to confirm.
- You cannot approve permission prompts; say they must be answered in the terminal on the Mac.
- Answer in the language the user spoke. The user often speaks Uzbek: then answer in natural, fluent Uzbek in Latin script (oʻ, gʻ), keeping session titles, project names and technical terms as they are. Otherwise answer in English.`;

export function agentArgs({ mcpConfig, model }) {
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--no-session-persistence', '--strict-mcp-config', '--mcp-config', typeof mcpConfig === 'string' ? mcpConfig : JSON.stringify(mcpConfig),
    '--tools', '', '--allowedTools', `${TOOL_PREFIX}list_sessions,${TOOL_PREFIX}get_session,${TOOL_PREFIX}get_conversation,${TOOL_PREFIX}get_activity,${TOOL_PREFIX}get_usage,${TOOL_PREFIX}propose_message`,
    '--setting-sources', '', '--system-prompt', SYSTEM_PROMPT,
  ];
  if (model) args.push('--model', model);
  return args;
}

export function promptWithHistory(history, text, snapshot = null) {
  const parts = [];
  if (snapshot) parts.push(`Snapshot of sessions at ${new Date(snapshot.now).toISOString()} (times are epoch milliseconds):\n${JSON.stringify(snapshot.sessions)}`);
  if (history.length) parts.push(`Earlier in this voice conversation:\n${history.map((turn) => `${turn.role === 'user' ? 'User' : 'You'}: ${turn.text}`).join('\n')}`);
  if (!parts.length) return text;
  return `${parts.join('\n\n')}\n\nThe user now says: ${text}`;
}

const STATUS = {
  list_sessions: 'Looking at your sessions',
  get_session: 'Reading a session',
  get_conversation: 'Reading a conversation',
  get_activity: 'Checking recent activity',
  get_usage: 'Checking usage',
  propose_message: 'Preparing a message',
};

// Turns one stream-json line into zero or more agent events.
export function eventsFromLine(line) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return [];
  }
  if (record.type === 'stream_event') {
    const delta = record.event?.delta;
    if (record.event?.type === 'content_block_delta' && delta?.type === 'text_delta' && delta.text) return [{ type: 'delta', text: delta.text }];
    return [];
  }
  if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
    const out = [];
    for (const block of record.message.content) {
      if (block.type !== 'tool_use' || !String(block.name).startsWith(TOOL_PREFIX)) continue;
      const name = block.name.slice(TOOL_PREFIX.length);
      out.push({ type: 'status', text: STATUS[name] || 'Looking' });
      if (name === 'propose_message' && block.input?.session_id && typeof block.input.text === 'string') {
        out.push({ type: 'proposal', sessionId: block.input.session_id, text: block.input.text.slice(0, 4000) });
      }
    }
    return out;
  }
  if (record.type === 'result') {
    return [{ type: 'result', text: typeof record.result === 'string' ? record.result : null, error: record.is_error ? String(record.result || 'The agent failed') : null }];
  }
  return [];
}

export class Agent {
  constructor({ claudeBin = 'claude', baseUrl, agentKey, model = process.env.SKIPPER_AGENT_MODEL || 'haiku', now = Date.now, spawnImpl = spawn, snapshot = null }) {
    Object.assign(this, { claudeBin, baseUrl, agentKey, model, now, spawnImpl, snapshot });
    this.conversations = new Map(); // id -> { turns, at }
    this.proposals = new Map(); // id -> { sessionId, text, at }
  }

  #conversation(id) {
    const t = this.now();
    for (const [key, value] of this.conversations) if (t - value.at > CONVERSATION_TTL_MS) this.conversations.delete(key);
    for (const [key, value] of this.proposals) if (t - value.at > CONVERSATION_TTL_MS) this.proposals.delete(key);
    const key = typeof id === 'string' && /^[\w-]{8,64}$/.test(id) ? id : crypto.randomUUID();
    if (!this.conversations.has(key)) this.conversations.set(key, { turns: [], at: t });
    return [key, this.conversations.get(key)];
  }

  takeProposal(id) {
    const proposal = this.proposals.get(id);
    this.proposals.delete(id);
    return proposal || null;
  }

  // The config carries the agent key, so it goes in a private file rather than on the
  // command line, where any local account could read it from the process list.
  #mcpConfigFile() {
    if (!this.mcpConfigPath) {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'skipper-agent-'));
      this.mcpConfigPath = path.join(dir, 'mcp.json');
      const config = { mcpServers: { skipper: { type: 'stdio', command: process.execPath, args: [BIN, 'mcp'], env: { SKIPPER_URL: this.baseUrl, SKIPPER_AGENT_KEY: this.agentKey } } } };
      writeFileSync(this.mcpConfigPath, JSON.stringify(config), { mode: 0o600 });
    }
    return this.mcpConfigPath;
  }

  // onEvent receives {type: 'conversation'|'status'|'delta'|'proposal'|'done'|'error', ...}.
  ask({ conversationId, text, onEvent, signal }) {
    const [id, conversation] = this.#conversation(conversationId);
    onEvent({ type: 'conversation', id });
    if (!this.claudeBin) {
      const answer = 'This is the demo, so there is no agent to ask. On your Mac, Skipper would read your sessions and answer here.';
      onEvent({ type: 'delta', text: answer });
      onEvent({ type: 'done', text: answer });
      return Promise.resolve();
    }
    const mcpConfig = this.#mcpConfigFile();
    // Smaller models are fast but less fluent in Uzbek; spend a little latency on quality there.
    const model = detectLanguage(text) === 'uz-UZ' ? process.env.SKIPPER_AGENT_MODEL_UZ || 'sonnet' : this.model;
    let snapshot = null;
    try {
      snapshot = this.snapshot?.() ?? null;
    } catch {}
    const args = [...agentArgs({ mcpConfig, model }), '--', promptWithHistory(conversation.turns, text, snapshot)];
    return new Promise((resolve) => {
      let child;
      try {
        // Spoken answers are short; extended thinking only adds seconds before the first word.
        child = this.spawnImpl(this.claudeBin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SKIPPER_URL: this.baseUrl, MAX_THINKING_TOKENS: process.env.SKIPPER_AGENT_THINKING ?? '0' } });
      } catch (error) {
        onEvent({ type: 'error', message: `Could not start Claude Code: ${error.message}` });
        resolve();
        return;
      }
      let answer = '';
      let buffer = '';
      let stderr = '';
      let finished = false;
      const finish = (event) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (event.type === 'done') {
          conversation.turns.push({ role: 'user', text }, { role: 'assistant', text: event.text });
          conversation.turns.splice(0, Math.max(0, conversation.turns.length - MAX_TURNS_KEPT * 2));
          conversation.at = this.now();
        }
        onEvent(event);
        resolve();
      };
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        finish({ type: 'error', message: 'The agent took too long to answer.' });
      }, ANSWER_TIMEOUT_MS);
      signal?.addEventListener('abort', () => {
        child.kill('SIGTERM');
        finish({ type: 'error', message: 'Stopped.' });
      });
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          for (const event of eventsFromLine(line)) {
            if (event.type === 'delta') {
              answer += event.text;
              onEvent(event);
            } else if (event.type === 'proposal') {
              const proposalId = crypto.randomUUID();
              this.proposals.set(proposalId, { sessionId: event.sessionId, text: event.text, at: this.now() });
              onEvent({ ...event, id: proposalId });
            } else if (event.type === 'result') {
              if (event.error) finish({ type: 'error', message: event.error });
              else finish({ type: 'done', text: (event.text ?? answer).trim() });
            } else {
              onEvent(event);
            }
          }
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-2000);
      });
      child.on('error', (error) => finish({ type: 'error', message: error.code === 'ENOENT' ? 'Claude Code is not installed on this Mac.' : error.message }));
      child.on('close', (code) => {
        if (code === 0 && answer) finish({ type: 'done', text: answer.trim() });
        else finish({ type: 'error', message: stderr.trim().split('\n').pop() || `Claude Code exited with code ${code}` });
      });
    });
  }
}
