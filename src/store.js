// Reads ~/.claude (read-only) and keeps an incrementally updated index of
// sessions. Transcripts are only ever read from the last byte offset we saw.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createSummary, applyRecord, sessionTitle } from './transcript.js';

const CHUNK = 1 << 20;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKING_WINDOW_MS = 45_000;
const QUIET_AFTER_MS = 10 * 60_000;
const LOOP_GRACE_MS = 5 * 60_000;

// A scheduled wakeup usually fires a little after its planned time, so a loop
// counts as sleeping until well past wakeAt, as long as no newer prompt arrived.
export function loopSleeping(loop, lastPromptAt, now) {
  if (!loop?.active || loop.wakeAt == null) return false;
  if (lastPromptAt != null && loop.at != null && lastPromptAt > loop.at) return false;
  const grace = Math.max(LOOP_GRACE_MS, (loop.delaySeconds || 0) * 500);
  return now < loop.wakeAt + grace;
}

export function isSessionId(value) {
  return typeof value === 'string' && SESSION_ID.test(value);
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function listDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export class Store {
  constructor(claudeDir, { now = Date.now, isAlive = pidAlive, eventsFile = null } = {}) {
    this.eventsFile = eventsFile;
    this.eventsOffset = 0;
    this.attention = new Map(); // sessionId -> latest permission/question hook event
    this.pendingAlerts = [];
    this.claudeDir = claudeDir;
    this.now = now;
    this.isAlive = isAlive;
    this.files = new Map(); // transcript path -> { offset, rest, summary, size, mtimeMs }
    this.extras = new Map(); // sessionId -> { subagents, workflows }
    this.live = new Map();
    this.tasks = new Map();
    this.teams = new Map();
    this.signature = '';
    this.workflowCache = new Map();
  }

  async refresh() {
    const projectsDir = path.join(this.claudeDir, 'projects');
    const seen = new Set();
    for (const project of await listDir(projectsDir)) {
      if (!project.isDirectory()) continue;
      const projectDir = path.join(projectsDir, project.name);
      for (const entry of await listDir(projectDir)) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const id = entry.name.slice(0, -'.jsonl'.length);
          if (!isSessionId(id)) continue;
          const file = path.join(projectDir, entry.name);
          seen.add(file);
          await this.#readTranscript(file, id);
        } else if (entry.isDirectory() && isSessionId(entry.name)) {
          await this.#readSessionDir(path.join(projectDir, entry.name), entry.name);
        }
      }
    }
    for (const file of this.files.keys()) if (!seen.has(file)) this.files.delete(file);

    await Promise.all([this.#readLive(), this.#readTasks(), this.#readTeams(), this.#readEvents()]);

    const signature = JSON.stringify(this.list().map((s) => [s.id, s.updatedAt, s.state, s.todoDone, s.todoTotal, s.agentsRunning, s.agentsTotal, s.prCount, s.loop?.wakeAt]));
    const changed = signature !== this.signature;
    this.signature = signature;
    return changed;
  }

  async #readTranscript(file, id) {
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      return;
    }
    let entry = this.files.get(file);
    if (!entry || stat.size < entry.offset) {
      entry = { offset: 0, rest: '', summary: createSummary(id), size: 0, mtimeMs: 0 };
      this.files.set(file, entry);
    }
    if (stat.size === entry.offset) return;

    const handle = await fs.open(file, 'r');
    try {
      const buffer = Buffer.alloc(CHUNK);
      while (entry.offset < stat.size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(CHUNK, stat.size - entry.offset), entry.offset);
        if (bytesRead === 0) break;
        entry.offset += bytesRead;
        const lines = (entry.rest + buffer.toString('utf8', 0, bytesRead)).split('\n');
        entry.rest = lines.pop();
        for (const line of lines) {
          if (!line) continue;
          try {
            applyRecord(entry.summary, JSON.parse(line));
          } catch {
            // Partial or malformed line: skip it.
          }
        }
      }
    } finally {
      await handle.close();
    }
    entry.size = stat.size;
    entry.mtimeMs = stat.mtimeMs;
  }

  async #readSessionDir(dir, id) {
    const extras = { subagents: new Map(), workflows: new Map() };
    for (const file of await listDir(path.join(dir, 'subagents'))) {
      if (!file.name.endsWith('.meta.json')) continue;
      const meta = await readJson(path.join(dir, 'subagents', file.name));
      if (!meta) continue;
      let lastActiveAt = null;
      try {
        lastActiveAt = (await fs.stat(path.join(dir, 'subagents', file.name.replace('.meta.json', '.jsonl')))).mtimeMs;
      } catch {}
      extras.subagents.set(meta.toolUseId || file.name, {
        name: meta.name || null,
        description: meta.description || null,
        agentType: meta.agentType || null,
        model: meta.model || null,
        worktreeBranch: meta.worktreeBranch || null,
        background: meta.requestShape === 'background',
        lastActiveAt,
      });
    }
    for (const file of await listDir(path.join(dir, 'workflows'))) {
      if (!file.name.endsWith('.json')) continue;
      const runFile = path.join(dir, 'workflows', file.name);
      let mtimeMs;
      try {
        mtimeMs = (await fs.stat(runFile)).mtimeMs;
      } catch {
        continue;
      }
      const cached = this.workflowCache.get(runFile);
      if (cached?.mtimeMs === mtimeMs) {
        extras.workflows.set(cached.key, cached.value);
        continue;
      }
      const run = await readJson(runFile);
      if (!run) continue;
      const key = run.runId || file.name;
      const value = {
        name: run.workflowName || 'workflow',
        description: run.summary || null,
        status: run.status || null,
        startedAt: run.startTime || Date.parse(run.timestamp) || null,
        durationMs: run.durationMs ?? null,
        agentCount: run.agentCount ?? null,
        totalTokens: run.totalTokens ?? null,
        phases: Array.isArray(run.phases) ? run.phases.map((p) => p?.title).filter(Boolean) : [],
      };
      this.workflowCache.set(runFile, { mtimeMs, key, value });
      extras.workflows.set(key, value);
    }
    this.extras.set(id, extras);
  }

  // Hook events are appended by `skipper hook`; read only what is new.
  async #readEvents() {
    if (!this.eventsFile) return;
    let stat;
    try {
      stat = await fs.stat(this.eventsFile);
    } catch {
      return;
    }
    const firstRead = this.eventsOffset === 0 && this.attention.size === 0 && !this.eventsRead;
    this.eventsRead = true;
    if (stat.size < this.eventsOffset) this.eventsOffset = 0;
    if (stat.size === this.eventsOffset) return;
    const handle = await fs.open(this.eventsFile, 'r');
    let text;
    try {
      const length = Math.min(stat.size - this.eventsOffset, 1 << 20);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, this.eventsOffset);
      const end = buffer.lastIndexOf(0x0a) + 1;
      text = buffer.toString('utf8', 0, end);
      this.eventsOffset += end;
    } finally {
      await handle.close();
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isSessionId(event.sessionId) || !Number.isFinite(event.at)) continue;
      if (event.kind === 'permission' || event.kind === 'question') this.attention.set(event.sessionId, event);
      // Replaying an old log on startup must not ring every bell at once.
      if (!firstRead && this.now() - event.at < 60_000) this.pendingAlerts.push(event);
    }
  }

  drainAlerts() {
    const alerts = this.pendingAlerts.splice(0);
    return alerts.map((event) => {
      const s = this.list().find((x) => x.id === event.sessionId);
      return { ...event, title: s?.title ?? event.sessionId.slice(0, 8), project: s?.project ?? null };
    });
  }

  #pendingAttention(s, live) {
    const event = this.attention.get(s.id);
    if (!event || !live) return null;
    // Any transcript activity after the prompt means it was answered.
    return (s.updatedAt ?? 0) <= event.at ? event : null;
  }

  async #readLive() {
    this.live = new Map();
    for (const file of await listDir(path.join(this.claudeDir, 'sessions'))) {
      if (!file.name.endsWith('.json')) continue;
      const info = await readJson(path.join(this.claudeDir, 'sessions', file.name));
      if (!info || !isSessionId(info.sessionId) || !this.isAlive(info.pid)) continue;
      this.live.set(info.sessionId, {
        pid: info.pid,
        kind: info.kind || null,
        entrypoint: info.entrypoint || null,
        startedAt: info.startedAt || null,
        status: typeof info.status === 'string' ? info.status : null,
      });
    }
  }

  async #readTasks() {
    this.tasks = new Map();
    const tasksDir = path.join(this.claudeDir, 'tasks');
    for (const dir of await listDir(tasksDir)) {
      if (!dir.isDirectory()) continue;
      const items = [];
      for (const file of await listDir(path.join(tasksDir, dir.name))) {
        if (!file.name.endsWith('.json')) continue;
        const task = await readJson(path.join(tasksDir, dir.name, file.name));
        if (!task || typeof task !== 'object') continue;
        items.push({
          id: String(task.id ?? file.name.replace(/\.json$/, '')),
          subject: String(task.subject ?? task.content ?? 'Untitled task'),
          description: typeof task.description === 'string' ? task.description : null,
          activeForm: typeof task.activeForm === 'string' ? task.activeForm : null,
          status: ['pending', 'in_progress', 'completed'].includes(task.status) ? task.status : 'pending',
          owner: typeof task.owner === 'string' ? task.owner : null,
          blockedBy: Array.isArray(task.blockedBy) ? task.blockedBy.map(String) : [],
        });
      }
      items.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      this.tasks.set(dir.name, items);
    }
  }

  async #readTeams() {
    this.teams = new Map();
    const teamsDir = path.join(this.claudeDir, 'teams');
    for (const dir of await listDir(teamsDir)) {
      const config = await readJson(path.join(teamsDir, dir.name, 'config.json'));
      if (!config || !isSessionId(config.leadSessionId)) continue;
      const members = Array.isArray(config.members) ? config.members : [];
      this.teams.set(config.leadSessionId, {
        name: String(config.name ?? dir.name),
        members: members.map((m) => ({ name: String(m.name ?? m.agentId ?? 'member'), agentType: m.agentType ?? null, model: m.model ?? null })),
      });
    }
  }

  // Task lists are keyed by session id, session-<first 8>, or the team name.
  taskListName(id) {
    const candidates = [id, `session-${id.slice(0, 8)}`, this.teams.get(id)?.name];
    return candidates.find((name) => name && this.tasks.has(name)) || null;
  }

  #tasksFor(id) {
    const name = this.taskListName(id);
    return name ? this.tasks.get(name) : [];
  }

  #state(s, live) {
    const now = this.now();
    if (!live) return 'ended';
    if (this.#pendingAttention(s, live)) return 'permission';
    const loopPending = loopSleeping(s.loop, s.lastPromptAt, now);
    if (live.status === 'busy') return 'working';
    if (live.status === 'idle') return loopPending ? 'sleeping' : 'waiting';
    if (loopPending && s.lastKind === 'turn-end') return 'sleeping';
    if (s.lastKind !== 'turn-end' || now - (s.updatedAt ?? 0) < WORKING_WINDOW_MS) return 'working';
    return 'waiting';
  }

  #agents(s, live) {
    const metas = this.extras.get(s.id)?.subagents || new Map();
    return [...s.agents.values()].map((agent) => {
      const meta = metas.get(agent.toolUseId) || {};
      let status = agent.status;
      if (status === 'running' && !live) status = 'stopped';
      else if (status === 'running' && meta.lastActiveAt && this.now() - meta.lastActiveAt > QUIET_AFTER_MS) status = 'quiet';
      return { ...agent, ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v != null)), status };
    });
  }

  #workflows(s, live) {
    const runs = [...(this.extras.get(s.id)?.workflows.values() || [])];
    const names = new Set(runs.map((r) => r.name));
    for (const wf of s.workflows.values()) {
      if (!names.has(wf.name)) runs.push({ ...wf, status: wf.status === 'running' && !live ? 'stopped' : wf.status });
    }
    return runs.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  }

  #summaries() {
    const byId = new Map();
    for (const { summary } of this.files.values()) {
      if (summary.updatedAt == null) continue;
      const existing = byId.get(summary.id);
      if (!existing || summary.updatedAt > existing.updatedAt) byId.set(summary.id, summary);
    }
    return byId;
  }

  list() {
    const out = [];
    for (const s of this.#summaries().values()) {
      const live = this.live.get(s.id);
      const agents = this.#agents(s, Boolean(live));
      const tasks = this.#tasksFor(s.id);
      const plan = tasks.length ? tasks : s.todos;
      const current = plan.find((t) => t.status === 'in_progress');
      out.push({
        id: s.id,
        title: sessionTitle(s),
        cwd: s.cwd,
        project: s.cwd ? path.basename(s.cwd) || s.cwd : 'unknown',
        branch: s.gitBranch,
        model: s.model,
        state: this.#state(s, live),
        live: Boolean(live),
        startedAt: s.startedAt,
        updatedAt: s.updatedAt,
        todoTotal: plan.length,
        todoDone: plan.filter((t) => t.status === 'completed').length,
        current: current ? current.activeForm || current.content || current.subject : null,
        lastText: s.lastText ? s.lastText.slice(0, 240) : null,
        agentsRunning: agents.filter((a) => a.status === 'running').length,
        agentsTotal: agents.length,
        loop: live && loopSleeping(s.loop, s.lastPromptAt, this.now()) ? { wakeAt: s.loop.wakeAt, reason: s.loop.reason } : null,
        prCount: s.prs.size,
        costUsd: s.cost?.usd ?? null,
        team: this.teams.get(s.id)?.name ?? null,
        attention: (() => {
          const event = this.#pendingAttention(s, live);
          return event ? { kind: event.kind, message: event.message, at: event.at } : null;
        })(),
      });
    }
    return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  get(id) {
    if (!isSessionId(id)) return null;
    const s = this.#summaries().get(id);
    if (!s) return null;
    const live = this.live.get(id);
    const base = this.list().find((x) => x.id === id);
    return {
      ...base,
      version: s.version,
      permissionMode: s.permissionMode,
      pid: live?.pid ?? null,
      entrypoint: live?.entrypoint ?? null,
      turns: s.turns,
      firstPrompt: s.firstPrompt,
      lastPrompt: s.lastPrompt,
      lastText: s.lastText,
      lastTextAt: s.lastTextAt,
      lastTool: s.lastTool,
      todos: s.todos,
      todosAt: s.todosAt,
      tasks: this.#tasksFor(id),
      agents: this.#agents(s, Boolean(live)).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)),
      workflows: this.#workflows(s, Boolean(live)),
      loopDetail: s.loop,
      prs: [...s.prs.values()],
      artifacts: [...s.artifacts.values()],
      cost: s.cost,
      team: this.teams.get(id) ?? null,
    };
  }
}
