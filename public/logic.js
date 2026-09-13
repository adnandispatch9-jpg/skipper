// Pure helpers shared by the page and the tests: no DOM access, no clock reads.
'use strict';

const DAY_MS = 86_400_000;

function formatAgo(ms, nowMs) {
  if (!ms) return '';
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < DAY_MS / 1000) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * DAY_MS / 1000) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatCountdown(ms, nowMs) {
  const s = Math.round((ms - nowMs) / 1000);
  if (s <= 0) return 'waking…';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function duration(ms) {
  if (!ms || ms < 0) return '—';
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const hrs = Math.floor(m / 60);
  return hrs < 48 ? `${hrs}h ${m % 60}m` : `${Math.round(hrs / 24)}d`;
}

function safeHref(url) {
  return typeof url === 'string' && /^https:\/\//i.test(url) ? url : null;
}

function toolName(name) {
  const mcp = String(name).match(/^mcp__(.+?)__(.+)$/);
  return mcp ? `${mcp[1]} · ${mcp[2]}` : name;
}

function plain(text) {
  return String(text || '').replace(/^#{1,6}\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}

function splitAsk(message) {
  const text = message || '';
  const match = text.match(/^(.*?(?:to use|to run)\s+[\w-]+):\s*(.+)$/i);
  return match ? { lead: match[1], command: match[2] } : { lead: text, command: null };
}

function dayBucketAt(at, t) {
  if (t - at < 3_600_000) return 'Last hour';
  const today = new Date(t).setHours(0, 0, 0, 0);
  if (at >= today) return 'Earlier today';
  if (at >= today - DAY_MS) return 'Yesterday';
  return 'Earlier';
}

// Loop ticks of one session within the same time group collapse into one row,
// even when several loops interleave.
function groupActivity(items, bucket) {
  const out = [];
  const loops = new Map();
  for (const item of items) {
    if (item.kind === 'loop') {
      const key = `${item.sessionId}:${bucket(item.at)}`;
      const group = loops.get(key);
      if (group) {
        group.count += 1;
        group.firstAt = item.at;
        if (!group.detail && item.detail) group.detail = item.detail;
        continue;
      }
      const row = { ...item, count: 1, firstAt: item.at };
      loops.set(key, row);
      out.push(row);
      continue;
    }
    out.push({ ...item, count: 1, firstAt: item.at });
  }
  return out;
}

// Shell command that reopens a session where it ran. Quotes the path for POSIX shells.
function resumeCommand(session) {
  if (!session?.id) return null;
  const resume = `claude --resume ${session.id}`;
  if (!session.cwd) return resume;
  const quoted = /^[\w@%+=:,./~-]+$/.test(session.cwd) ? session.cwd : `'${session.cwd.replace(/'/g, `'\\''`)}'`;
  return `cd ${quoted} && ${resume}`;
}

// 1234 -> "1.2k", 1840000 -> "1.84M". Keeps three significant digits.
function formatTokens(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v < 1000) return String(Math.round(v));
  const units = [['B', 1e9], ['M', 1e6], ['k', 1e3]];
  for (const [unit, size] of units) {
    if (v >= size) {
      const x = v / size;
      return `${x >= 100 ? Math.round(x) : x >= 10 ? x.toFixed(1).replace(/\.0$/, '') : x.toFixed(2).replace(/\.?0+$/, '')}${unit}`;
    }
  }
  return String(v);
}

// A rounded axis maximum and three tick values for a bar chart.
function niceScale(max) {
  if (!(max > 0)) return { max: 1, ticks: [0, 0.5, 1] };
  const exp = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * exp).find((m) => m * 2 >= max) ?? 10 * exp;
  return { max: step * 2, ticks: [0, step, step * 2] };
}

// The next theme in menu order, wrapping back to the first.
function nextTheme(current, themes) {
  const ids = themes.map(([id]) => id);
  const index = ids.indexOf(current);
  return ids[(index + 1) % ids.length] ?? ids[0];
}

// Why a working session has been silent: still running the tool it last started,
// or nothing to explain it. Null when it is not quiet.
function quietReason(session, nowMs, quietMs = 5 * 60_000) {
  if (!session || session.state !== 'working' || nowMs - session.updatedAt <= quietMs) return null;
  const tool = session.lastTool;
  if (tool && tool.pending) {
    return { kind: 'tool', since: tool.at, tool: tool.name, target: tool.target || null };
  }
  return { kind: 'silent', since: session.updatedAt };
}

// Tab icon for the attention state: the app icon with its status dot recolored,
// so a pinned tab shows at a glance when a session needs you.
const FAVICON_DOT = { clear: '#3ccf8e', waiting: '#f2b33d', permission: '#ef5a52' };
function faviconHref(kind) {
  const alert = kind in FAVICON_DOT && kind !== 'clear';
  const dot = alert ? FAVICON_DOT[kind] : FAVICON_DOT.clear;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    + '<rect width="64" height="64" rx="15" fill="#1d2233"/>'
    + '<path d="M14 40h36l-5 9H19z" fill="#8ea2ff"/>'
    + '<path d="M31 12v25" stroke="#f6f5f1" stroke-width="3.5" stroke-linecap="round"/>'
    + '<path d="M34 15c7 3 11 9 12 19H34z" fill="#f6f5f1"/>'
    + '<path d="M28 20c-5 3-8 8-9 14h9z" fill="#f6f5f1" opacity=".55"/>'
    + `<circle cx="49" cy="15" r="${alert ? 11 : 5}" fill="${dot}" stroke="#1d2233" stroke-width="${alert ? 3 : 0}"/>`
    + '</svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
