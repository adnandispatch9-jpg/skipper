// Reads ~/.claude (read-only) and keeps an incrementally updated index of
// sessions. Transcripts are only ever read from the last byte offset we saw.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createSummary, applyRecord, applyUsage, sessionTitle } from './transcript.js';

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
    this.events = []; // recent hook events for the activity feed
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
    this.subagentFiles = new Map(); // subagent transcript -> { usage }
    this.metaCache = new Map(); // subagent meta.json path -> parsed metadata
  }

  async refresh() {
    this.seenAux = new Set();
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
    // Forget subagents and workflow runs whose files are gone, so long uptimes don't accumulate them.
    for (const cache of [this.subagentFiles, this.metaCache, this.workflowCache]) {
      for (const file of cache.keys()) if (!this.seenAux.has(file)) cache.delete(file);
    }

    await Promise.all([this.#readLive(), this.#readTasks(), this.#readTeams(), this.#readEvents()]);

    const signature = JSON.stringify(this.list().map((s) => [s.id, s.updatedAt, s.state, s.todoDone, s.todoTotal, s.agentsRunning, s.agentsTotal, s.prCount, s.loop?.wakeAt]));
    const changed = signature !== this.signature;
    this.signature = signature;
    return changed;
  }

  async #readTranscript(file, id) {
    await this.#readIncremental(this.files, file, () => ({ summary: createSummary(id) }), (entry, record) => applyRecord(entry.summary, record));
  }

  // Reads only the bytes appended since last time, one JSON record per line.
  async #readIncremental(cache, file, init, onRecord) {
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      return;
    }
    let entry = cache.get(file);
    if (!entry || stat.size < entry.offset) {
      entry = { offset: 0, rest: '', size: 0, mtimeMs: 0, ...init() };
      cache.set(file, entry);
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
            onRecord(entry, JSON.parse(line));
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
      // Subagent metadata is written once when the agent starts, so read it once.
      const metaPath = path.join(dir, 'subagents', file.name);
      this.seenAux.add(metaPath);
      let meta = this.metaCache.get(metaPath);
      if (!meta) {
        meta = await readJson(metaPath);
        if (meta) this.metaCache.set(metaPath, meta);
      }
      if (!meta) continue;
      let lastActiveAt = null;
      const log = path.join(dir, 'subagents', file.name.replace('.meta.json', '.jsonl'));
      this.seenAux.add(log);
      try {
        lastActiveAt = (await fs.stat(log)).mtimeMs;
      } catch {}
      await this.#readIncremental(this.subagentFiles, log, () => ({ sessionId: id, usage: new Map() }), (entry, record) => applyUsage(entry.usage, record));
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
      this.seenAux.add(runFile);
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
    let replay = !this.eventsRead;
    this.eventsRead = true;
    if (stat.size < this.eventsOffset) {
      // The hook rotated the log: re-read it for state, but do not ring old alerts again.
      this.eventsOffset = 0;
      this.events = [];
      replay = true;
    }
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
      this.events.push(event);
      if (this.events.length > 600) this.events.splice(0, this.events.length - 500);
      // Replaying an old log on startup must not ring every bell at once.
      if (!replay && this.now() - event.at < 60_000) this.pendingAlerts.push(event);
    }
  }

  drainAlerts() {
    const alerts = this.pendingAlerts.splice(0);
    return alerts.map((event) => {
      const s = this.list().find((x) => x.id === event.sessionId);
      const kind = this.#eventKind(event, this.#summaries().get(event.sessionId));
      return { ...event, kind, title: s?.title ?? event.sessionId.slice(0, 8), project: s?.project ?? null };
    });
  }

  #pendingAttention(s, live) {
    const event = this.attention.get(s.id);
    if (!event || !live) return null;
    // Any transcript activity after the prompt means it was answered.
    return (s.updatedAt ?? 0) <= event.at ? event : null;
  }

  // Claude Code reports a multiple-choice question as a generic "needs your permission"
  // notification. If Claude opened a question just before, call it a question.
  #eventKind(event, s) {
    if (event.kind !== 'permission' || !s?.askedAt?.length) return event.kind;
    return s.askedAt.some((t) => event.at - t >= -5_000 && event.at - t <= 120_000) ? 'question' : 'permission';
  }

  async #readLive() {
    // Build into a new map and swap at the end: readers must never see it half-filled.
    const live = new Map();
    const byFile = new Map();
    for (const file of await listDir(path.join(this.claudeDir, 'sessions'))) {
      if (!file.name.endsWith('.json')) continue;
      // A file being rewritten (or locked, on Windows) can fail to parse for a moment;
      // keep what it said last time instead of flickering the session to ended.
      const info = (await readJson(path.join(this.claudeDir, 'sessions', file.name))) ?? this.liveFiles?.get(file.name);
      if (!info || !isSessionId(info.sessionId) || !this.isAlive(info.pid)) continue;
      byFile.set(file.name, info);
      live.set(info.sessionId, {
        pid: info.pid,
        kind: info.kind || null,
        entrypoint: info.entrypoint || null,
        startedAt: info.startedAt || null,
        status: typeof info.status === 'string' ? info.status : null,
      });
    }
    this.live = live;
    this.liveFiles = byFile;
  }

  async #readTasks() {
    // Build into a new map and swap at the end: readers must never see it half-filled.
    const tasks = new Map();
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
      tasks.set(dir.name, items);
    }
    this.tasks = tasks;
  }

  async #readTeams() {
    // Build into a new map and swap at the end: readers must never see it half-filled.
    const teams = new Map();
    const teamsDir = path.join(this.claudeDir, 'teams');
    for (const dir of await listDir(teamsDir)) {
      const config = await readJson(path.join(teamsDir, dir.name, 'config.json'));
      if (!config || !isSessionId(config.leadSessionId)) continue;
      const members = Array.isArray(config.members) ? config.members : [];
      teams.set(config.leadSessionId, {
        name: String(config.name ?? dir.name),
        members: members.map((m) => ({ name: String(m.name ?? m.agentId ?? 'member'), agentType: m.agentType ?? null, model: m.model ?? null })),
      });
    }
    this.teams = teams;
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

  transcriptFile(id) {
    let best = null;
    for (const [file, { summary }] of this.files) {
      if (summary.id === id && (!best || (summary.updatedAt ?? 0) > (best.summary.updatedAt ?? 0))) best = { file, summary };
    }
    return best?.file ?? null;
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
        background: live?.kind === 'bg',
        startedAt: s.startedAt,
        updatedAt: s.updatedAt,
        todoTotal: plan.length,
        todoDone: plan.filter((t) => t.status === 'completed').length,
        current: current ? current.activeForm || current.content || current.subject : null,
        lastText: s.lastText ? s.lastText.slice(0, 240) : null,
        turnStartedAt: s.lastPromptAt ?? null,
        lastTool: s.lastTool ? { name: s.lastTool.name, target: s.lastTool.target ?? null, at: s.lastTool.at, pending: Boolean(s.lastTool.pending) } : null,
        agentsRunning: agents.filter((a) => a.status === 'running').length,
        agentsTotal: agents.length,
        loop: live && loopSleeping(s.loop, s.lastPromptAt, this.now()) ? { wakeAt: s.loop.wakeAt, reason: s.loop.reason } : null,
        prCount: s.prs.size,
        team: this.teams.get(s.id)?.name ?? null,
        attention: (() => {
          const event = this.#pendingAttention(s, live);
          return event ? { kind: this.#eventKind(event, s), message: event.message, at: event.at } : null;
        })(),
      });
    }
    return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  // One timeline across sessions, newest first. Built from data already on disk.
  activity({ limit = 100, since = this.now() - 7 * 86_400_000 } = {}) {
    const items = [];
    const summaries = this.#summaries();
    const titles = new Map();
    for (const s of summaries.values()) titles.set(s.id, { title: sessionTitle(s), project: s.cwd ? path.basename(s.cwd) : 'unknown' });
    const push = (sessionId, at, kind, text, detail = null) => {
      if (!Number.isFinite(at) || at < since) return;
      const meta = titles.get(sessionId) || { title: sessionId.slice(0, 8), project: null };
      items.push({ id: `${kind}:${sessionId}:${at}:${items.length}`, at, kind, text, detail, sessionId, title: meta.title, project: meta.project });
    };

    // Only the newest turn per session can show its message; older text is gone.
    const newestDone = new Map();
    for (const event of this.events) if (event.kind === 'done') newestDone.set(event.sessionId, event);
    for (const event of this.events) {
      const s = summaries.get(event.sessionId);
      const kind = this.#eventKind(event, s);
      if (kind === 'permission') push(event.sessionId, event.at, 'permission', 'Permission asked', event.message);
      else if (kind === 'question') push(event.sessionId, event.at, 'question', 'Claude asked you something', event.message);
      else if (event.kind === 'idle') push(event.sessionId, event.at, 'waiting', 'Waiting for your input', null);
      else if (event.kind === 'done') {
        // A turn that scheduled a wakeup shortly before it ended is a loop tick.
        const looped = s?.wakeups?.some((t) => t <= event.at && event.at - t < 5 * 60_000);
        const latest = newestDone.get(event.sessionId) === event;
        if (looped) push(event.sessionId, event.at, 'loop', 'Loop went to sleep', latest ? s.loop?.reason ?? null : null);
        else push(event.sessionId, event.at, 'turn', 'Turn finished', latest && s.lastText ? s.lastText.split('\n')[0].slice(0, 160) : null);
      }
    }
    for (const s of summaries.values()) {
      for (const agent of s.agents.values()) {
        const name = agent.name || agent.description || agent.agentType;
        push(s.id, agent.startedAt, 'agent-start', 'Subagent started', name);
        if (agent.endedAt && agent.status !== 'running') {
          push(s.id, agent.endedAt, agent.status === 'failed' ? 'agent-failed' : 'agent-done', agent.status === 'failed' ? 'Subagent failed' : 'Subagent finished', agent.result ? `${name} · ${agent.result.split('\n')[0].slice(0, 120)}` : name);
        }
      }
      for (const pr of s.prs.values()) push(s.id, pr.at, 'pr', 'Pull request opened', pr.repo && pr.number ? `${pr.repo}#${pr.number}` : pr.url);
      for (const artifact of s.artifacts.values()) push(s.id, artifact.at, 'artifact', 'Artifact published', artifact.title);
      for (const run of this.extras.get(s.id)?.workflows.values() || []) {
        if (run.startedAt && run.durationMs != null) push(s.id, run.startedAt + run.durationMs, 'workflow', `Workflow ${run.status || 'finished'}`, [run.name, run.agentCount != null ? `${run.agentCount} agents` : null].filter(Boolean).join(' · '));
      }
      if (!this.live.has(s.id) && s.updatedAt) push(s.id, s.updatedAt, 'ended', 'Session ended', s.cost?.linesAdded || s.cost?.linesRemoved ? `+${s.cost.linesAdded} −${s.cost.linesRemoved} lines` : null);
    }
    return items.sort((a, b) => b.at - a.at).slice(0, limit);
  }

  usage({ days = 14 } = {}) {
    const dayMs = 86_400_000;
    const today = new Date(this.now());
    today.setHours(0, 0, 0, 0);
    const start = today.getTime() - (days - 1) * dayMs;
    const prevStart = start - days * dayMs;
    const dayKey = (at) => {
      const d = new Date(at);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const perDay = new Map();
    for (let i = 0; i < days; i++) perDay.set(dayKey(start + i * dayMs + dayMs / 2), { day: dayKey(start + i * dayMs + dayMs / 2), output: 0, input: 0, byProject: {} });
    const totals = { output: 0, input: 0, cacheRead: 0, cacheWrite: 0, subagentOutput: 0, previousOutput: 0, responses: 0 };
    const byProject = new Map();
    const byModel = new Map();
    const family = (model) => (model?.match(/opus|sonnet|haiku|fable/i)?.[0].toLowerCase() ?? model ?? 'unknown');
    const summaries = this.#summaries();
    const projectOf = (id) => {
      const s = summaries.get(id);
      return s?.cwd ? path.basename(s.cwd) : 'unknown';
    };
    const count = (sessionId, u, subagent) => {
      if (u.at == null) return;
      if (u.at >= prevStart && u.at < start) totals.previousOutput += u.output;
      if (u.at < start) return;
      const input = u.input + u.cacheRead + u.cacheWrite;
      totals.output += u.output;
      totals.input += input;
      totals.cacheRead += u.cacheRead;
      totals.cacheWrite += u.cacheWrite;
      totals.responses += 1;
      if (subagent) totals.subagentOutput += u.output;
      const project = projectOf(sessionId);
      byProject.set(project, (byProject.get(project) || 0) + u.output);
      const model = family(u.model);
      byModel.set(model, (byModel.get(model) || 0) + u.output);
      const bucket = perDay.get(dayKey(u.at));
      if (bucket) {
        bucket.output += u.output;
        bucket.input += input;
        bucket.byProject[project] = (bucket.byProject[project] || 0) + u.output;
      }
    };
    for (const s of summaries.values()) for (const u of s.usage.values()) count(s.id, u, false);
    for (const entry of this.subagentFiles.values()) for (const u of entry.usage.values()) count(entry.sessionId, u, true);

    let sessions = 0;
    for (const s of summaries.values()) if (s.updatedAt >= start) sessions += 1;
    const ranked = (map) => [...map.entries()].map(([name, output]) => ({ name, output })).filter((r) => r.output > 0).sort((a, b) => b.output - a.output);
    return {
      days,
      totals: { ...totals, sessions },
      perDay: [...perDay.values()],
      byProject: ranked(byProject),
      byModel: ranked(byModel),
    };
  }

  #sessionTokens(s) {
    const t = { output: 0, input: 0, cacheRead: 0, subagentOutput: 0, responses: 0 };
    const add = (u, subagent) => {
      t.output += u.output;
      t.input += u.input + u.cacheRead + u.cacheWrite;
      t.cacheRead += u.cacheRead;
      t.responses += 1;
      if (subagent) t.subagentOutput += u.output;
    };
    for (const u of s.usage.values()) add(u, false);
    for (const entry of this.subagentFiles.values()) if (entry.sessionId === s.id) for (const u of entry.usage.values()) add(u, true);
    return t.responses ? t : null;
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
      cost: s.cost ? { linesAdded: s.cost.linesAdded, linesRemoved: s.cost.linesRemoved } : null,
      tokens: this.#sessionTokens(s),
      team: this.teams.get(id) ?? null,
    };
  }
}
