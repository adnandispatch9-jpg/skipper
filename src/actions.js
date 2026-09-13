// Everything Skipper is allowed to change. Each action validates its own
// inputs; nothing here builds a path or a command from unchecked request data.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { isSessionId } from './store.js';

export const LIMITS = { message: 20_000, note: 10_000, subject: 300, description: 10_000 };
const TASK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const STATUSES = new Set(['pending', 'in_progress', 'completed']);

export class ActionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function text(value, limit, field, { required = true } = {}) {
  if (value == null && !required) return undefined;
  if (typeof value !== 'string') throw new ActionError(400, `${field} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new ActionError(400, `${field} cannot be empty`);
  if (trimmed.length > limit) throw new ActionError(413, `${field} is longer than ${limit} characters`);
  return trimmed;
}

async function writeJsonAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, file);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

/* ---------- notes (Skipper's own data, never inside ~/.claude) ---------- */

export class Notes {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'notes.json');
    this.queue = Promise.resolve();
  }

  #mutate(fn) {
    const run = this.queue.then(async () => {
      const all = await readJson(this.file, {});
      const result = fn(all);
      await writeJsonAtomic(this.file, all);
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  async list(sessionId) {
    const all = await readJson(this.file, {});
    return Array.isArray(all[sessionId]) ? all[sessionId] : [];
  }

  add(sessionId, body) {
    const value = text(body, LIMITS.note, 'Note');
    return this.#mutate((all) => {
      const note = { id: crypto.randomUUID(), text: value, createdAt: Date.now(), updatedAt: Date.now() };
      (all[sessionId] ||= []).push(note);
      return note;
    });
  }

  update(sessionId, noteId, body) {
    const value = text(body, LIMITS.note, 'Note');
    return this.#mutate((all) => {
      const note = (all[sessionId] || []).find((n) => n.id === noteId);
      if (!note) throw new ActionError(404, 'Note not found');
      Object.assign(note, { text: value, updatedAt: Date.now() });
      return note;
    });
  }

  remove(sessionId, noteId) {
    return this.#mutate((all) => {
      const notes = all[sessionId] || [];
      const index = notes.findIndex((n) => n.id === noteId);
      if (index === -1) throw new ActionError(404, 'Note not found');
      notes.splice(index, 1);
      if (!notes.length) delete all[sessionId];
      return { ok: true };
    });
  }
}

/* ---------- Claude Code task lists (~/.claude/tasks/<list>/<id>.json) ---------- */

export class Tasks {
  constructor(claudeDir, store) {
    this.root = path.join(claudeDir, 'tasks');
    this.store = store;
  }

  // Existing list for the session, else the team's list name, else session-<8>.
  #dir(sessionId) {
    if (!isSessionId(sessionId)) throw new ActionError(404, 'Session not found');
    const existing = this.store.taskListName(sessionId);
    const team = this.store.teams.get(sessionId)?.name;
    const name = existing || (team && TASK_ID.test(team) ? team : `session-${sessionId.slice(0, 8)}`);
    return path.join(this.root, name);
  }

  #file(dir, taskId) {
    if (!TASK_ID.test(String(taskId))) throw new ActionError(404, 'Task not found');
    return path.join(dir, `${taskId}.json`);
  }

  async #all(dir) {
    let names = [];
    try {
      names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json'));
    } catch {}
    const tasks = [];
    for (const name of names) {
      const task = await readJson(path.join(dir, name), null).catch(() => null);
      if (task) tasks.push(task);
    }
    return tasks;
  }

  async create(sessionId, input) {
    const dir = this.#dir(sessionId);
    const subject = text(input?.subject, LIMITS.subject, 'Subject');
    const description = text(input?.description ?? '', LIMITS.description, 'Description', { required: false }) || '';
    const ids = (await this.#all(dir)).map((t) => Number(t.id)).filter(Number.isInteger);
    const id = String((ids.length ? Math.max(...ids) : 0) + 1);
    const task = { id, subject, description, activeForm: subject, status: 'pending', blocks: [], blockedBy: [] };
    await writeJsonAtomic(this.#file(dir, id), task);
    return task;
  }

  async update(sessionId, taskId, input) {
    const dir = this.#dir(sessionId);
    const file = this.#file(dir, taskId);
    const task = await readJson(file, null);
    if (!task) throw new ActionError(404, 'Task not found');
    const subject = text(input?.subject, LIMITS.subject, 'Subject', { required: false });
    const description = text(input?.description, LIMITS.description, 'Description', { required: false });
    if (subject !== undefined) {
      if (!subject) throw new ActionError(400, 'Subject cannot be empty');
      task.subject = subject;
    }
    if (description !== undefined) task.description = description;
    if (input?.status !== undefined) {
      if (!STATUSES.has(input.status)) throw new ActionError(400, 'Unknown status');
      task.status = input.status;
    }
    await writeJsonAtomic(file, task);
    return task;
  }

  async remove(sessionId, taskId) {
    const dir = this.#dir(sessionId);
    const file = this.#file(dir, taskId);
    const all = await this.#all(dir);
    if (!all.some((t) => String(t.id) === String(taskId))) throw new ActionError(404, 'Task not found');
    const dependents = all.filter((t) => Array.isArray(t.blockedBy) && t.blockedBy.map(String).includes(String(taskId)) && t.status !== 'completed');
    if (dependents.length) {
      throw new ActionError(409, `Task #${taskId} blocks #${dependents.map((t) => t.id).join(', #')}`);
    }
    await fs.unlink(file);
    return { ok: true };
  }
}

/* ---------- messaging Claude through the official CLI ---------- */

export async function sendMessage({ session, message, claudeBin = 'claude', timeoutMs = 30_000 }) {
  const body = text(message, LIMITS.message, 'Message');
  if (claudeBin === null) return { ok: true, demo: true, output: 'Demo mode: nothing was sent.' };
  if (!session?.cwd) throw new ActionError(409, 'This session has no known working directory');
  try {
    if (!(await fs.stat(session.cwd)).isDirectory()) throw new Error();
  } catch {
    throw new ActionError(409, `Working directory no longer exists: ${session.cwd}`);
  }

  // argv only (no shell), and "--" so a message starting with "-" is never read as a flag.
  const args = ['--bg', '--resume', session.id, '--', body];
  return new Promise((resolve, reject) => {
    let output = '';
    let child;
    try {
      child = spawn(claudeBin, args, { cwd: session.cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    } catch (error) {
      reject(new ActionError(500, `Could not start Claude Code: ${error.message}`));
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      reject(new ActionError(504, 'Claude Code did not respond in time'));
    }, timeoutMs);
    const collect = (chunk) => {
      if (output.length < 8000) output += chunk;
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new ActionError(error.code === 'ENOENT' ? 501 : 500, error.code === 'ENOENT' ? 'The claude command was not found on PATH' : error.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const clean = output.replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (code === 0) resolve({ ok: true, output: clean });
      else reject(new ActionError(502, clean || `claude exited with code ${code}`));
    });
  });
}
