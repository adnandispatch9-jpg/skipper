// `skipper doctor`: checks the pieces a working setup depends on and says what
// to run when one is missing. Each check returns { ok, label, detail, fix }.

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { hooksStatus, readConfig, eventsFile } from './hooks.js';
import { serviceStatus } from './service.js';
import { speechConfig, localVoicePaths } from './speech.js';

export function checkNode(version = process.versions.node) {
  const major = Number(version.split('.')[0]);
  return major >= 20
    ? { ok: true, label: 'Node.js', detail: `v${version}` }
    : { ok: false, label: 'Node.js', detail: `v${version} is too old`, fix: 'Install Node.js 20 or newer' };
}

export async function checkClaudeDir(claudeDir) {
  try {
    const entries = await fs.readdir(path.join(claudeDir, 'projects'));
    return { ok: true, label: 'Claude Code data', detail: `${claudeDir} (${entries.length} project folders)` };
  } catch {
    return { ok: false, label: 'Claude Code data', detail: `nothing at ${claudeDir}/projects`, fix: 'Run Claude Code once, or pass --claude-dir' };
  }
}

export async function checkHooks(settingsFile) {
  const status = await hooksStatus({ settingsFile });
  return status.installed
    ? { ok: true, label: 'Permission alerts (hooks)', detail: 'installed' }
    : { ok: false, label: 'Permission alerts (hooks)', detail: 'not installed', fix: 'skipper hooks install' };
}

export async function checkEvents(dataDir, now = Date.now()) {
  try {
    const text = await fs.readFile(eventsFile(dataDir), 'utf8');
    const last = text.trim().split('\n').pop();
    const at = JSON.parse(last).at;
    const minutes = Math.round((now - at) / 60000);
    return { ok: true, label: 'Hook events', detail: `last one ${minutes < 1 ? 'just now' : `${minutes} min ago`}` };
  } catch {
    return { ok: false, label: 'Hook events', detail: 'none received yet', fix: 'Start a new Claude Code session after installing hooks' };
  }
}

export async function checkNative(dataDir, platform = process.platform) {
  const on = Boolean((await readConfig(dataDir)).nativeNotifications);
  if (platform !== 'darwin' && platform !== 'linux') return { ok: true, label: 'System notifications', detail: 'not supported on this platform' };
  return on
    ? { ok: true, label: 'System notifications', detail: 'on' }
    : { ok: true, optional: true, label: 'System notifications', detail: 'off', fix: 'skipper hooks native on' };
}

export async function checkVoice(dataDir, { env = process.env, exists = existsSync } = {}) {
  const label = 'Phone app voice';
  const config = await speechConfig(dataDir, env);
  if (config?.provider === 'azure') return { ok: true, label, detail: `Azure AI Speech (${config.region})` };
  if (config?.provider === 'local') return { ok: true, label, detail: 'local: Whisper on this Mac, answers voiced by edge-tts' };
  const local = localVoicePaths(dataDir, env);
  const missing = [!local.whisper && 'whisper-cli', !exists(local.model) && `model ${local.model}`, !exists(local.edgeTts) && `edge-tts at ${local.edgeTts}`].filter(Boolean);
  return { ok: true, optional: true, label, detail: missing.length ? `off (missing ${missing.join(', ')})` : 'off', fix: 'skipper voice setup --region <azure-region>, or install the local tools' };
}

export function checkService({ dashboardUp = false, status = serviceStatus() } = {}) {
  if (status.running) return { ok: true, label: 'Background service', detail: 'running' };
  if (status.installed) return { ok: false, label: 'Background service', detail: 'installed but not running', fix: 'skipper service install' };
  if (dashboardUp) return { ok: true, label: 'Background service', detail: 'not installed, but Skipper is already running another way' };
  return { ok: true, optional: true, label: 'Background service', detail: 'not installed', fix: 'skipper service install' };
}

export async function checkDashboard(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/sessions`, { headers: { host: `localhost:${port}` }, signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    return { ok: true, label: 'Dashboard', detail: `http://localhost:${port} (${data.sessions.length} sessions)` };
  } catch {
    return { ok: false, optional: true, label: 'Dashboard', detail: `nothing answering on port ${port}`, fix: `skipper, or skipper service install` };
  }
}

export function formatReport(checks) {
  const lines = checks.map((c) => {
    const mark = c.ok ? (c.optional ? '-' : '✓') : '✗';
    return `  ${mark} ${c.label.padEnd(26)} ${c.detail}${c.fix && (!c.ok || c.optional) ? `\n      → ${c.fix}` : ''}`;
  });
  const problems = checks.filter((c) => !c.ok && !c.optional).length;
  lines.push('', problems ? `  ${problems} problem${problems === 1 ? '' : 's'} found.` : '  Everything needed is in place.');
  return { text: lines.join('\n'), problems };
}
