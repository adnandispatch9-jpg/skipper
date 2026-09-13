// Claude Code hooks integration. Claude runs `skipper hook` on Notification
// (permission prompts, idle prompts) and Stop events; the command appends one
// line to <dataDir>/events.jsonl, which the server turns into sounds and alerts.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const HOOK_EVENTS = ['Notification', 'Stop'];
const MARKER = 'skipper-hook';
const MAX_INPUT = 64 * 1024;

export function eventsFile(dataDir) {
  return path.join(dataDir, 'events.jsonl');
}

export function classify(input) {
  const event = input?.hook_event_name;
  if (event === 'Stop') return 'done';
  const type = String(input?.notification_type || '');
  const message = String(input?.message || '');
  if (type === 'permission_prompt' || /permission/i.test(message)) return 'permission';
  if (type === 'elicitation_dialog') return 'question';
  if (type === 'idle_prompt' || /waiting for your input/i.test(message)) return 'idle';
  return type === 'auth_success' ? null : 'attention';
}

// Never throws and never blocks Claude: a broken dashboard must not break a session.
export async function recordHook(rawInput, dataDir) {
  try {
    const input = JSON.parse(String(rawInput).slice(0, MAX_INPUT));
    const kind = classify(input);
    if (!kind || typeof input.session_id !== 'string') return null;
    const event = {
      at: Date.now(),
      sessionId: input.session_id,
      kind,
      message: typeof input.message === 'string' ? input.message.slice(0, 500) : null,
      cwd: typeof input.cwd === 'string' ? input.cwd : null,
    };
    await fs.mkdir(dataDir, { recursive: true });
    await fs.appendFile(eventsFile(dataDir), `${JSON.stringify(event)}\n`, { mode: 0o600 });
    return event;
  } catch {
    return null;
  }
}

function hookCommand(nodePath, scriptPath) {
  const quote = (p) => `"${p.replace(/(["\\$`])/g, '\\$1')}"`;
  return `${quote(nodePath)} ${quote(scriptPath)} hook # ${MARKER}`;
}

const isOurs = (hook) => typeof hook?.command === 'string' && hook.command.includes(MARKER);

async function readSettings(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`Could not read ${file}: ${error.message}`);
  }
}

async function writeSettings(file, settings) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.copyFile(file, `${file}.skipper-backup`);
  } catch {}
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  await fs.rename(tmp, file);
}

function removeOurs(settings) {
  let removed = 0;
  for (const event of Object.keys(settings.hooks || {})) {
    const groups = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const kept = [];
    for (const group of groups) {
      const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
      const rest = hooks.filter((h) => !isOurs(h));
      removed += hooks.length - rest.length;
      if (rest.length) kept.push({ ...group, hooks: rest });
    }
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
  return removed;
}

export async function installHooks({ settingsFile, nodePath, scriptPath }) {
  const settings = await readSettings(settingsFile);
  removeOurs(settings);
  settings.hooks ||= {};
  const command = hookCommand(nodePath, scriptPath);
  for (const event of HOOK_EVENTS) {
    (settings.hooks[event] ||= []).push({ hooks: [{ type: 'command', command, timeout: 10 }] });
  }
  await writeSettings(settingsFile, settings);
  return { installed: HOOK_EVENTS, command };
}

export async function uninstallHooks({ settingsFile }) {
  const settings = await readSettings(settingsFile);
  const removed = removeOurs(settings);
  if (removed) await writeSettings(settingsFile, settings);
  return { removed };
}

export async function hooksStatus({ settingsFile }) {
  try {
    const settings = await readSettings(settingsFile);
    const events = HOOK_EVENTS.filter((event) =>
      (settings.hooks?.[event] || []).some((group) => (group?.hooks || []).some(isOurs)),
    );
    return { installed: events.length === HOOK_EVENTS.length, events };
  } catch {
    return { installed: false, events: [] };
  }
}
