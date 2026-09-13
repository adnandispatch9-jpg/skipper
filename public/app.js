'use strict';

const STATE_LABEL = { permission: 'Needs permission', waiting: 'Needs you', working: 'Working', sleeping: 'Sleeping', ended: 'Ended' };
const DAY = 86_400_000;

const state = {
  sessions: [],
  detail: null,
  serverOffset: 0,
  claudeDir: '',
  filter: 'live',
  project: null,
  activity: [],
  usage: null,
  usageDays: 14,
  activityFilter: 'all',
  activitySeen: 0,
  query: '',
  sound: false,
  turns: true,
  desktop: false,
  hooks: null,
  lastAlert: {},
  previous: null,
  loaded: false,
  readOnly: false,
  sending: false,
  editing: null,
  renderPending: false,
  drafts: { message: {}, note: {}, task: {} },
};

/* ---------- helpers ---------- */

const $ = (selector) => document.querySelector(selector);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style') el.style.cssText = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const ICONS = {
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  bot: 'M12 4v3M5 10a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3ZM9.5 13h.01M14.5 13h.01',
  loop: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  pr: 'M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 15V8a2 2 0 0 0-2-2h-5M13 3l-2 3 2 3',
  chip: 'M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z',
  check: 'm5 12 5 5 9-10',
  back: 'M15 18l-6-6 6-6',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  flow: 'M4 6h6v4H4ZM14 14h6v4h-6ZM7 10v4a2 2 0 0 0 2 2h5',
  team: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
  sun: 'M12 3v2M12 19v2M5 5l1.4 1.4M17.6 17.6 19 19M3 12h2M19 12h2M5 19l1.4-1.4M17.6 6.4 19 5M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  shield: 'M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6ZM12 8v4M12 15.5h.01',
  reply: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v5',
  edit: 'M4 20h4L19 9l-4-4L4 16ZM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  send: 'M4 12 20 4l-6 16-3-7Z',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  close: 'M6 6l12 12M18 6 6 18',
  copy: 'M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2ZM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15ZM10 20a2 2 0 0 0 4 0',
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

const now = () => Date.now() + state.serverOffset;




function ago(ms) {
  return formatAgo(ms, now());
}

function countdown(ms) {
  return formatCountdown(ms, now());
}

function dayBucket(at) {
  return dayBucketAt(at, now());
}

const relTime = (ms) => h('span', { class: 'rel', dataset: { rel: String(ms || '') } }, ago(ms));
const QUIET_MS = 5 * 60_000;
const relTimeBare = (ms) => h('span', { class: 'elapsed', dataset: { since: String(ms || '') } }, duration(now() - ms));
function quietLine(session, cls = '') {
  const q = quietReason(session, now(), QUIET_MS);
  if (!q) return null;
  if (q.kind === 'tool') {
    return h('div', { class: `quiet-warning running ${cls}`, title: q.target ? `${toolName(q.tool)}: ${q.target}` : 'Still running this tool' },
      icon('clock'), 'Running ', h('b', {}, toolName(q.tool)), ' for ', relTimeBare(q.since), q.target ? h('span', { class: 'quiet-target mono' }, q.target) : null);
  }
  return h('div', { class: `quiet-warning ${cls}`, title: 'Working, but nothing has been written for a while. It may be stuck.' }, icon('clock'), 'No activity for ', relTimeBare(q.since));
}

const elapsedTime = (ms) => h('span', { class: 'elapsed', dataset: { since: String(ms || '') } }, duration(now() - ms));
const untilTime = (ms) => h('span', { class: 'until', dataset: { until: String(ms || '') } }, countdown(ms));

function tick() {
  for (const el of document.querySelectorAll('[data-rel]')) el.textContent = ago(Number(el.dataset.rel));
  for (const el of document.querySelectorAll('[data-until]')) el.textContent = countdown(Number(el.dataset.until));
  for (const el of document.querySelectorAll('[data-since]')) el.textContent = duration(now() - Number(el.dataset.since));
}




const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
};

/* ---------- data ---------- */

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function setOffline(offline) {
  $('#offline').hidden = !offline;
}

async function load() {
  const data = await getJson('/api/sessions');
  state.serverOffset = data.now - Date.now();
  state.claudeDir = data.claudeDir;
  state.readOnly = Boolean(data.readOnly);
  state.hooks = data.hooks || null;
  renderHooksNote();
  notifyChanges(data.sessions);
  state.sessions = data.sessions;
  state.activity = (await getJson('/api/activity?limit=150').catch(() => null))?.items ?? state.activity;
  if (route().name === 'usage') state.usage = await getJson(`/api/usage?days=${state.usageDays}`).catch(() => state.usage);
  const id = route().id;
  if (id) {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!res.ok && res.status !== 404) throw new Error(`${res.status}`);
    state.detail = res.ok ? (await res.json()).session : null;
  } else {
    state.detail = null;
  }
  state.loaded = true;
  render();
}

let loading = null;
let queued = false;
function reload() {
  if (loading) {
    queued = true;
    return;
  }
  loading = load()
    .then(() => setOffline(false))
    .catch((error) => {
      // Only a failed request means the server is gone; anything else is a bug worth seeing.
      if (error instanceof TypeError || /^\d{3}$/.test(error.message)) setOffline(true);
      else console.error(error);
    })
    .finally(() => {
      loading = null;
      if (queued) {
        queued = false;
        reload();
      }
    });
}

function connect() {
  const events = new EventSource('/api/events');
  events.addEventListener('change', reload);
  events.addEventListener('hello', reload);
  events.addEventListener('alert', (event) => {
    try {
      onHookAlert(JSON.parse(event.data));
    } catch {}
  });
  events.onerror = () => {
    events.close();
    reload();
    setTimeout(connect, 3000);
  };
}

/* ---------- alerts: sound, toast, desktop notification ---------- */

let audio = null;
function chime(kind) {
  if (!state.sound) return;
  try {
    audio ||= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    const patterns = {
      permission: [[880, 0], [880, 0.18], [1175, 0.36]],
      question: [[784, 0], [1047, 0.16]],
      waiting: [[659, 0], [880, 0.14]],
      done: [[523, 0], [784, 0.12]],
    };
    const t0 = audio.currentTime + 0.02;
    for (const [freq, offset] of patterns[kind] || patterns.waiting) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(kind === 'permission' ? 0.35 : 0.2, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.32);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.34);
    }
  } catch {}
}

function alertUser({ id, kind, title, body }) {
  const key = `${id}:${kind === 'done' ? 'waiting' : kind}`;
  if (id && Date.now() - (state.lastAlert[key] || 0) < 20_000) return;
  state.lastAlert[key] = Date.now();
  if (kind === 'done') state.lastAlert[`${id}:waiting`] = Date.now();

  chime(kind);
  const sessionId = id && /^[0-9a-f-]{36}/i.test(id) ? id.slice(0, 36) : null;
  const toastIcon = { permission: 'shield', question: 'reply', waiting: 'reply', done: kind === 'done' && id?.endsWith('-agents') ? 'bot' : 'check' }[kind] || 'bell';
  const toast = h('div', { class: `toast ${kind}`, role: kind === 'permission' ? 'alert' : 'status' },
    h('span', { class: 'toast-icon' }, icon(toastIcon)),
    h('div', { class: 'toast-body' },
      h('b', {}, title),
      body ? h('span', { class: kind === 'permission' && /:\s/.test(body) ? 'toast-command' : '' }, kind === 'permission' && /:\s/.test(body) ? body.replace(/^.*?:\s*/, '') : body) : null,
      h('div', { class: 'toast-actions' },
        sessionId ? h('a', { class: 'btn small', href: `#/s/${sessionId}` }, 'Open session') : null,
        h('button', { class: 'btn small ghost', type: 'button', dataset: { dismiss: '1' } }, 'Dismiss'))),
  );
  toast.addEventListener('click', (event) => {
    if (event.target.closest('[data-dismiss], a')) toast.remove();
  });
  $('#toasts').append(toast);
  setTimeout(() => toast.remove(), kind === 'permission' ? 20000 : 7000);

  const showDesktop = state.desktop && 'Notification' in window && Notification.permission === 'granted' && (document.hidden || kind === 'permission');
  if (showDesktop) {
    const n = new Notification(title, { body: body || '', tag: `${id}-${kind}`, icon: '/icon.svg', requireInteraction: kind === 'permission' });
    n.onclick = () => {
      window.focus();
      if (id) location.hash = `#/s/${id}`;
      n.close();
    };
  }
}

function onHookAlert(event) {
  const title = event.title || 'Claude Code';
  if (event.kind === 'permission') alertUser({ id: event.sessionId, kind: 'permission', title: `Permission needed: ${title}`, body: event.message || 'Claude is waiting for your approval.' });
  else if (event.kind === 'question') alertUser({ id: event.sessionId, kind: 'question', title: `Question from Claude: ${title}`, body: event.message });
  else if (event.kind === 'idle') alertUser({ id: event.sessionId, kind: 'waiting', title: `Needs you: ${title}`, body: event.message });
  else if (event.kind === 'done') {
    const session = state.sessions.find((s) => s.id === event.sessionId);
    // A /loop that just scheduled its next wakeup is not waiting for you.
    if (!state.turns || session?.state === 'sleeping' || session?.loop) return;
    alertUser({ id: event.sessionId, kind: 'done', title: `Finished: ${title}`, body: 'Claude is waiting for your next message.' });
  }
  else alertUser({ id: event.sessionId, kind: 'waiting', title, body: event.message });
}

function notifyChanges(next) {
  const before = state.previous;
  state.previous = new Map(next.map((s) => [s.id, s]));
  if (!before) return;
  for (const s of next) {
    const old = before.get(s.id);
    if (!old) continue;
    if (s.state === 'permission' && old.state !== 'permission') {
      alertUser({ id: s.id, kind: 'permission', title: `Permission needed: ${s.title}`, body: s.attention?.message || 'Claude is waiting for your approval.' });
    } else if (s.state === 'waiting' && old.state === 'working' && state.turns) {
      alertUser({ id: s.id, kind: 'waiting', title: `Needs you: ${s.title}`, body: 'Claude finished and is waiting for you.' });
    } else if (s.agentsRunning < old.agentsRunning && s.live) {
      alertUser({ id: `${s.id}-agents`, kind: 'done', title: `Subagent finished in ${s.title}` });
    }
  }
}

function renderHooksNote() {
  const note = $('#hooks-note');
  if (!note) return;
  $('#hooks-dot')?.classList.toggle('working', Boolean(state.hooks?.installed));
  if (state.hooks?.installed) {
    note.textContent = 'Claude Code hooks connected';
  } else {
    note.replaceChildren('Run ', h('code', {}, 'skipper hooks install'), ' for instant alerts');
  }
}

function syncNotifyMenu() {
  for (const item of document.querySelectorAll('[data-setting="sound"], [data-setting="desktop"], [data-setting="turns"]')) {
    item.setAttribute('aria-checked', String(Boolean(state[item.dataset.setting])));
  }
  $('#notify-btn').setAttribute('aria-pressed', String(state.sound || state.desktop));
}

function toggleNotifyMenu(open) {
  const menu = $('#notify-menu');
  const show = open ?? menu.hidden;
  menu.hidden = !show;
  $('#notify-btn').setAttribute('aria-expanded', String(show));
}

/* ---------- routing ---------- */

function route() {
  const hash = location.hash;
  const match = hash.match(/^#\/s\/([0-9a-f-]{36})(\/reply)?$/i);
  if (match) return { name: 'session', id: match[1], reply: Boolean(match[2]) };
  if (hash === '#/sessions') return { name: 'list' };
  if (hash === '#/activity') return { name: 'activity' };
  if (hash === '#/usage') return { name: 'usage' };
  return { name: 'overview' };
}

/* ---------- rendering ---------- */

function matches(s) {
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  return [s.title, s.project, s.cwd, s.branch, s.current, s.team, s.lastText].some((v) => v && v.toLowerCase().includes(q));
}

function visibleSessions() {
  return state.sessions.filter((s) =>
    matches(s) &&
    (!state.project || s.project === state.project) &&
    (state.query || (state.filter === 'history' ? !s.live : s.live || s.updatedAt > now() - 2 * DAY)));
}

function renderPulse() {
  const counts = { permission: 0, waiting: 0, working: 0, sleeping: 0 };
  let agents = 0;
  for (const s of state.sessions) {
    if (counts[s.state] != null) counts[s.state]++;
    agents += s.agentsRunning;
  }
  const needsCount = counts.waiting + counts.permission;
  const kind = counts.permission ? 'permission' : counts.waiting ? 'waiting' : 'clear';
  $('#pulse').replaceChildren(
    h('a', { class: `attention-pill ${kind}`, href: '#/' },
      h('i', { class: `dot ${kind === 'clear' ? 'working' : kind}` }),
      needsCount ? `${needsCount} need${needsCount === 1 ? 's' : ''} you` : 'All clear'),
    h('span', { class: 'pulse-summary' }, `${counts.working} working · ${counts.sleeping} sleeping · ${agents} subagent${agents === 1 ? '' : 's'}`),
  );
  const needs = counts.waiting + counts.permission;
  document.title = counts.permission ? `(${needs}) Permission needed · Skipper` : needs ? `(${needs}) Skipper` : 'Skipper';
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon && favicon.dataset.kind !== kind) {
    favicon.dataset.kind = kind;
    favicon.href = kind === 'clear' ? '/icon.svg' : faviconHref(kind);
  }
  return { ...counts, agents };
}

const URGENCY = { permission: 0, waiting: 1, working: 2, sleeping: 3, ended: 4 };

function renderRail() {
  const live = state.sessions.filter((s) => s.live);
  const needs = live.filter((s) => s.state === 'permission' || s.state === 'waiting').length;
  const tab = (id, label, count, dot) =>
    h('button', { type: 'button', role: 'tab', class: 'rail-tab', 'aria-selected': String(state.filter === id), dataset: { filter: id } },
      h('i', { class: `dot ${dot}` }), h('span', {}, label), h('b', { class: needs && id === 'live' ? 'hot' : '' }, count));
  $('#rail-nav').replaceChildren(
    tab('live', needs ? `Live · ${needs} need${needs === 1 ? 's' : ''} you` : 'Live', live.length, needs ? (live.some((s) => s.state === 'permission') ? 'permission' : 'waiting') : 'working'),
    tab('history', 'History', state.sessions.length - live.length, 'ended'),
    h('a', { class: `rail-tab rail-link${route().name === 'usage' ? ' current' : ''}`, href: '#/usage' }, icon('chart'), h('span', {}, 'Usage')),
  );

  const projects = new Map();
  for (const s of state.sessions) {
    const p = projects.get(s.project) || { name: s.project, count: 0, state: 'ended', updatedAt: 0 };
    p.count += 1;
    if (s.live && URGENCY[s.state] < URGENCY[p.state]) p.state = s.state;
    p.updatedAt = Math.max(p.updatedAt, s.updatedAt || 0);
    projects.set(s.project, p);
  }
  const list = [...projects.values()]
    .sort((a, b) => URGENCY[a.state] - URGENCY[b.state] || b.updatedAt - a.updatedAt)
    .slice(0, 8);
  $('#rail-projects').replaceChildren(
    list.length > 1 ? h('div', { class: 'group-label' }, h('span', {}, 'Projects'), state.project ? h('button', { type: 'button', class: 'link-btn', dataset: { project: '' } }, 'Clear') : null) : '',
    ...(list.length > 1 ? list.map((p) =>
      h('button', { type: 'button', class: 'rail-project', 'aria-pressed': String(state.project === p.name), dataset: { project: p.name }, title: `Show only ${p.name}` },
        h('span', {}, p.name), h('small', {}, p.count), h('i', { class: `dot ${p.state}` }))) : []),
  );
}

function renderSidebar(currentId) {
  renderRail();
  const list = visibleSessions();
  const groups = [
    ['Needs permission', list.filter((s) => s.state === 'permission')],
    ['Needs you', list.filter((s) => s.state === 'waiting')],
    ['Working', list.filter((s) => s.state === 'working')],
    ['Sleeping', list.filter((s) => s.state === 'sleeping')],
  ];
  const ended = list.filter((s) => s.state === 'ended');
  const today = new Date(now()).setHours(0, 0, 0, 0);
  groups.push(['Today', ended.filter((s) => s.updatedAt >= today)]);
  groups.push(['Yesterday', ended.filter((s) => s.updatedAt < today && s.updatedAt >= today - DAY)]);
  groups.push(['Earlier', ended.filter((s) => s.updatedAt < today - DAY)]);

  const nodes = [];
  for (const [label, items] of groups) {
    if (!items.length) continue;
    nodes.push(h('div', { class: 'group-label' }, h('span', {}, label), h('span', {}, items.length)));
    for (const s of items) {
      nodes.push(
        h('a', { class: 'session-link', href: `#/s/${s.id}`, 'aria-current': s.id === currentId ? 'page' : null },
          h('i', { class: `dot ${s.state}`, title: STATE_LABEL[s.state] }),
          h('span', { class: 'title' }, s.title),
          h('span', { class: 'when' }, s.state === 'sleeping' && s.loop ? untilTime(s.loop.wakeAt) : relTime(s.updatedAt)),
          h('span', { class: 'sub' },
            h('span', {}, s.project),
            s.todoTotal ? h('span', {}, `· ${s.todoDone}/${s.todoTotal}`) : null,
            s.agentsRunning ? h('span', {}, `· ${s.agentsRunning} agent${s.agentsRunning > 1 ? 's' : ''}`) : null,
            s.prCount ? h('span', {}, `· ${s.prCount} PR`) : null,
          ),
        ),
      );
    }
  }
  if (!nodes.length) {
    nodes.push(h('p', { class: 'empty-list' }, state.query || state.project ? 'No sessions match this filter.' : state.filter === 'history' ? 'No finished sessions yet.' : 'No live sessions. Open History to see past ones.'));
  }
  $('#session-list').replaceChildren(...nodes);
}

function progress(done, total) {
  if (!total) return null;
  return h('div', { class: 'progress' },
    h('div', { class: 'bar' }, h('i', { style: `width:${Math.round((done / total) * 100)}%` })),
    h('small', {}, `${done}/${total}`),
  );
}

function segments(done, total, current, color = 'working') {
  if (!total) return null;
  const count = Math.min(total, 12);
  const scale = total / count;
  return h('div', { class: `segments ${color}`, role: 'img', 'aria-label': `${done} of ${total} done` },
    Array.from({ length: count }, (_, i) => {
      const filled = (i + 1) * scale <= done;
      const active = !filled && current && i * scale < done + 1;
      return h('i', { class: filled ? 'on' : active ? 'half' : '' });
    }));
}

function metaItem(iconName, text, cls = '') {
  return text ? h('span', { class: `meta ${cls}` }, iconName ? icon(iconName) : null, text) : null;
}

function queueRow(s) {
  const permission = s.state === 'permission';
  const ask = s.attention?.message || '';
  const command = ask.match(/:\s*(.+)$/)?.[1];
  return h('a', { class: `queue-row ${s.state}`, href: permission ? `#/s/${s.id}` : `#/s/${s.id}/reply` },
    h('span', { class: 'queue-icon' }, icon(permission ? 'shield' : 'reply')),
    h('span', { class: 'queue-body' },
      h('span', { class: 'queue-title' },
        h('b', {}, s.title),
        h('span', { class: `chip ${s.state}` }, permission ? (s.attention?.kind === 'question' ? 'Question' : 'Permission') : 'Your turn'),
        h('span', { class: 'queue-when' }, relTime(permission ? s.attention?.at : s.updatedAt))),
      permission
        ? h('span', { class: 'queue-ask' }, command ? ['Wants to run ', h('code', {}, command)] : ask || 'Waiting for your approval in the terminal.')
        : h('span', { class: 'queue-quote' }, plain(s.lastText || 'Claude finished and is waiting for you.')),
      h('span', { class: 'queue-meta' },
        metaItem('folder', s.project),
        s.branch && s.branch !== 'HEAD' ? metaItem('branch', s.branch) : null,
        s.todoTotal ? h('span', { class: 'meta' }, `Plan ${s.todoDone}/${s.todoTotal}`) : null)),
    h('span', { class: 'queue-action' },
      permission ? h('span', { class: 'hint' }, 'Approve in terminal') : null,
      h('span', { class: 'btn small primary' }, permission ? 'Open session' : 'Reply')),
  );
}

function sessionCard(s) {
  const sleeping = s.state === 'sleeping' && s.loop;
  return h('a', { class: `card flight ${s.state}`, href: `#/s/${s.id}` },
    h('div', { class: 'card-top' },
      h('span', { class: `chip ${s.state}` }, h('i', { class: `dot ${s.state}` }), STATE_LABEL[s.state]),
      sleeping ? h('span', { class: 'countdown' }, untilTime(s.loop.wakeAt)) : s.state === 'working' && s.turnStartedAt ? h('span', { class: 'meta', title: 'Time since this turn started' }, 'running ', elapsedTime(s.turnStartedAt)) : h('span', { class: 'meta' }, relTime(s.updatedAt))),
    h('div', { class: 'card-title' }, s.title),
    h('div', { class: 'card-now' }, plain(sleeping && s.loop.reason ? s.loop.reason : s.current || s.lastText || '')),
    quietLine(s),
    segments(s.todoDone, s.todoTotal, Boolean(s.current), sleeping ? 'sleeping' : 'working'),
    h('div', { class: 'card-foot' },
      metaItem('folder', s.project),
      h('span', { class: 'card-foot-right' },
        s.agentsRunning ? metaItem('bot', `${s.agentsRunning} running`, 'accent') : null,
        s.team ? metaItem('team', 'team') : null,
        s.prCount ? metaItem('pr', String(s.prCount)) : null,
        sleeping && s.todoTotal ? h('span', { class: 'meta' }, `${s.todoDone}/${s.todoTotal}`) : null)),
  );
}

const ACTIVITY_FILTERS = [
  ['all', 'All', null],
  ['needs', 'Needs you', ['permission', 'question', 'waiting', 'turn']],
  ['agents', 'Agents', ['agent-start', 'agent-done', 'agent-failed', 'workflow']],
  ['prs', 'PRs', ['pr', 'artifact']],
  ['loops', 'Loops', ['loop']],
];

const ACTIVITY_STYLE = {
  permission: ['permission', 'shield'],
  question: ['waiting', 'reply'],
  waiting: ['waiting', 'reply'],
  turn: ['waiting', 'reply'],
  loop: ['sleeping', 'loop'],
  'agent-start': ['accent', 'bot'],
  'agent-done': ['working', 'bot'],
  'agent-failed': ['danger', 'bot'],
  workflow: ['working', 'flow'],
  pr: ['accent', 'pr'],
  artifact: ['accent', 'link'],
  ended: ['ended', 'check'],
};



function renderActivity({ limit = 40 } = {}) {
  const filter = ACTIVITY_FILTERS.find(([id]) => id === state.activityFilter) || ACTIVITY_FILTERS[0];
  const items = groupActivity(state.activity.filter((i) => (!filter[2] || filter[2].includes(i.kind)) && (!state.project || i.project === state.project)), dayBucket).slice(0, limit);
  const unread = state.activity.filter((i) => i.at > state.activitySeen).length;
  const rows = [];
  let bucket = null;
  for (const item of items) {
    const b = dayBucket(item.at);
    if (b !== bucket) {
      bucket = b;
      rows.push(h('div', { class: 'group-label activity-group' }, h('span', {}, b)));
    }
    const [tone, iconName] = ACTIVITY_STYLE[item.kind] || ['ended', 'check'];
    const text = item.count > 1 ? `Loop ran ${item.count} times · since ${new Date(item.firstAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : item.text;
    rows.push(h('a', { class: `activity-item${item.at > state.activitySeen ? ' unread' : ''}`, href: `#/s/${item.sessionId}` },
      h('span', { class: `activity-icon tone-${tone}` }, icon(iconName)),
      h('span', { class: 'activity-body' },
        h('span', { class: `activity-kind tone-${tone}` }, text),
        h('span', { class: 'activity-title' }, item.title),
        item.detail ? h('span', { class: `activity-detail${item.kind === 'permission' && splitAsk(item.detail).command ? ' mono' : ''}` }, item.kind === 'permission' ? splitAsk(item.detail).command || item.detail : plain(item.detail)) : null),
      h('span', { class: 'activity-when' }, relTime(item.at), item.at > state.activitySeen ? h('i', { class: 'unread-dot', 'aria-label': 'new' }) : null)));
  }
  return h('section', { class: 'activity' },
    h('div', { class: 'activity-head' },
      h('div', {},
        h('h2', {}, 'Activity'),
        h('p', { class: 'muted' }, unread ? `${unread} new since you last looked` : 'You are all caught up')),
      unread ? h('button', { class: 'btn small', type: 'button', dataset: { activitySeen: '1' } }, 'Mark seen') : null),
    h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Activity filter' },
      ACTIVITY_FILTERS.map(([id, label]) => h('button', { type: 'button', role: 'tab', class: 'filter-chip', 'aria-selected': String(filter[0] === id), dataset: { activityFilter: id } }, label))),
    rows.length ? h('div', { class: 'activity-list' }, rows) : h('p', { class: 'muted empty-activity' }, 'Nothing here yet. Permission prompts, finished turns, subagents and PRs will show up as they happen.'),
  );
}

function renderActivityPage() {
  renderPulse();
  return h('div', { class: 'activity-page' }, renderActivity({ limit: 120 }));
}

function hooksTip() {
  if (!state.hooks || state.hooks.installed || state.readOnly || store.get('skipper.tip.hooks') || new URLSearchParams(location.search).has('static')) return null;
  const command = 'skipper hooks install';
  return h('section', { class: 'tip', role: 'note' },
    h('span', { class: 'tip-icon' }, icon('bell')),
    h('div', { class: 'tip-body' },
      h('b', {}, 'Get a chime the moment Claude needs permission'),
      h('span', {}, 'Connect Claude Code hooks once. Your other settings are kept and a backup is saved.')),
    h('div', { class: 'command-box tip-command' },
      h('code', {}, command),
      h('button', { class: 'icon-btn tiny', type: 'button', title: 'Copy command', 'aria-label': 'Copy command', dataset: { action: 'copy', text: command } }, icon('copy'))),
    h('button', { class: 'icon-btn tiny tip-close', type: 'button', title: 'Dismiss', 'aria-label': 'Dismiss tip', dataset: { action: 'dismiss-tip', tip: 'hooks' } }, icon('close')));
}

const USAGE_RANGES = [[1, 'Today'], [7, '7 days'], [14, '14 days'], [30, '30 days']];

function renderUsage() {
  renderPulse();
  const u = state.usage;
  const head = h('div', { class: 'page-head usage-head' },
    h('div', {},
      h('h1', {}, 'Usage'),
      h('p', { class: 'lede' }, 'Tokens are counted from every response, including subagents, on the day they happened. Dollar cost appears only where Claude Code recorded it, as a total for the whole session.')),
    h('div', { class: 'segmented usage-range', role: 'tablist', 'aria-label': 'Time range' },
      USAGE_RANGES.map(([days, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.usageDays === days), dataset: { usageDays: String(days) } }, label))));
  if (!u) return h('div', { class: 'usage' }, head, h('p', { class: 'muted' }, 'Loading usage…'));
  if (!u.totals.responses) return h('div', { class: 'usage' }, head, h('p', { class: 'muted' }, 'No responses in this range yet.'));

  const t = u.totals;
  const change = t.previousOutput ? Math.round(((t.output - t.previousOutput) / t.previousOutput) * 100) : null;
  const tile = (label, value, note) => h('div', { class: 'stat usage-stat' }, h('div', { class: 'label' }, label), h('div', { class: 'num' }, value), note ? h('div', { class: 'stat-note' }, note) : null);

  const scale = niceScale(Math.max(...u.perDay.map((d) => d.output)));
  const dayLabel = (key, long) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, long ? { weekday: 'short', month: 'short', day: 'numeric' } : { day: 'numeric' });
  const every = u.perDay.length > 16 ? 5 : 1;
  const bars = u.perDay.map((d, i) => {
    const top = Object.entries(d.byProject).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([name, v]) => `${name} ${Math.round((v / d.output) * 100)}%`).join(' · ');
    const tip = `${dayLabel(d.day, true)}: ${formatTokens(d.output)} output tokens${top ? ` (${top})` : ''}`;
    return h('div', { class: 'bar-col', tabindex: '0', role: 'img', 'aria-label': tip, dataset: { tip } },
      h('i', { class: 'bar-fill', style: `height:${d.output ? Math.max(2, (d.output / scale.max) * 100) : 0}%` }),
      h('span', { class: 'bar-label' }, i % every === 0 || i === u.perDay.length - 1 ? dayLabel(d.day) : ''));
  });
  const ranked = (title, rows) => h('section', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, title), h('span', { class: 'meta' }, 'output tokens')),
    h('div', { class: 'ranked' }, rows.slice(0, 8).map((r) =>
      h('div', { class: 'ranked-row' },
        h('span', { class: 'ranked-name' }, r.name),
        h('span', { class: 'ranked-track' }, h('i', { style: `width:${(r.output / rows[0].output) * 100}%` })),
        h('span', { class: 'ranked-value mono' }, formatTokens(r.output))))));

  return h('div', { class: 'usage' },
    head,
    h('div', { class: 'stats usage-stats' },
      tile('Output tokens', formatTokens(t.output), change == null ? null : `${change >= 0 ? '+' : ''}${change}% vs previous ${u.days === 1 ? 'day' : `${u.days} days`}`),
      tile('Input tokens', formatTokens(t.input), t.input ? `${Math.round((t.cacheRead / t.input) * 100)}% served from cache` : null),
      tile('Subagents', t.output ? `${Math.round((t.subagentOutput / t.output) * 100)}%` : '0%', 'of output tokens'),
      tile('Recorded cost', t.costSessions ? `$${t.recordedCost.toFixed(2)}` : '—', t.costSessions ? `whole-session totals of ${t.costSessions} session${t.costSessions === 1 ? '' : 's'} active in this range` : 'none recorded in this range')),
    h('section', { class: 'panel chart-panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, 'Output tokens per day'), h('span', { class: 'meta', id: 'chart-readout', 'aria-live': 'polite' }, 'Hover a bar for details')),
      h('div', { class: 'chart' },
        h('div', { class: 'chart-axis' }, [...scale.ticks].reverse().map((v) => h('span', {}, formatTokens(v)))),
        h('div', { class: 'chart-plot' },
          h('div', { class: 'chart-grid' }, h('i', {}), h('i', {}), h('i', {})),
          h('div', { class: 'chart-bars', style: `grid-template-columns:repeat(${u.perDay.length}, minmax(0, 1fr))` }, bars))),
      h('table', { class: 'sr-only' },
        h('caption', {}, 'Output tokens per day'),
        h('tbody', {}, u.perDay.map((d) => h('tr', {}, h('th', {}, dayLabel(d.day, true)), h('td', {}, d.output)))))),
    h('div', { class: 'usage-grid' }, ranked('By project', u.byProject), ranked('By model', u.byModel)),
    h('p', { class: 'hint usage-note' }, 'Skipper does not estimate prices. Token counts are exact; costs come only from Claude Code’s own records.'),
  );
}

function renderOverview() {
  const counts = renderPulse();
  if (!state.sessions.length) {
    return h('div', { class: 'empty' },
      h('h1', {}, 'No Claude Code sessions yet'),
      h('p', {}, 'Skipper is watching ', h('code', {}, state.claudeDir), '. Start a Claude Code session and it will show up here instantly.'),
    );
  }
  const live = state.sessions.filter((s) => s.live && matches(s));
  const queue = live.filter((s) => s.state === 'permission' || s.state === 'waiting')
    .sort((a, b) => (a.state === 'permission' ? 0 : 1) - (b.state === 'permission' ? 0 : 1) || b.updatedAt - a.updatedAt);
  const flight = live.filter((s) => s.state === 'working' || s.state === 'sleeping')
    .sort((a, b) => (a.state === 'working' ? 0 : 1) - (b.state === 'working' ? 0 : 1) || b.updatedAt - a.updatedAt);
  const recent = state.sessions.filter((s) => !s.live && matches(s)).slice(0, 6);
  const nextWake = live.map((s) => s.loop?.wakeAt).filter((t) => t > now()).sort()[0];
  const needs = queue.length;

  return h('div', { class: 'overview-layout' }, h('div', { class: 'overview' },
    hooksTip(),
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, needs ? `${needs} session${needs > 1 ? 's' : ''} need${needs > 1 ? '' : 's'} you` : live.length ? 'Everything is moving' : 'All quiet'),
        h('p', { class: 'status-line' },
          h('span', {}, `${live.length} live`),
          counts.agents ? h('span', {}, `${counts.agents} subagent${counts.agents > 1 ? 's' : ''} running`) : null,
          nextWake ? h('span', {}, 'next loop wakes in ', h('b', { class: 'sleeping-text' }, untilTime(nextWake))) : null,
          h('span', {}, `${state.sessions.length} in history`)),
      ),
      h('a', { class: 'meta', href: '#/sessions' }, icon('list'), 'All sessions'),
    ),
    queue.length ? h('section', { class: 'section' },
      h('h2', {}, 'Needs you'),
      h('div', { class: 'queue' }, queue.map(queueRow)),
    ) : null,
    h('section', { class: 'section' },
      h('h2', {}, 'In flight'),
      flight.length ? h('div', { class: 'cards' }, flight.map(sessionCard)) : h('p', { class: 'muted' }, live.length ? 'Nothing is running right now.' : 'No Claude Code session is running right now.'),
    ),
    recent.length ? h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', {}, 'Recently finished'), h('a', { class: 'meta', href: '#/sessions' }, 'View history')),
      h('div', { class: 'table' }, recent.map((s) =>
        h('a', { class: 'row', href: `#/s/${s.id}` },
          h('span', { class: 'title' }, s.title),
          h('span', { class: 'dim hide-sm' }, s.project),
          h('span', { class: 'dim hide-sm' }, s.prCount ? [icon('pr'), ` ${s.prCount} PR`] : '—'),
          h('span', { class: 'num hide-sm mono' }, s.costUsd != null ? `$${s.costUsd.toFixed(2)}` : ''),
          h('span', { class: 'num' }, relTime(s.updatedAt)),
        ),
      )),
    ) : null,
  ), h('aside', { class: 'activity-rail', 'aria-label': 'Activity' }, renderActivity({ limit: 40 })));
}


function panel(title, aside, ...body) {
  return h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, title), aside), ...body);
}

function planPanel(d) {
  const editable = !state.readOnly;
  const taskMode = d.tasks.length > 0 || (!d.todos.length && editable);
  const items = taskMode ? d.tasks : d.todos;
  if (!items.length && !taskMode) return null;
  const done = items.filter((t) => t.status === 'completed').length;
  const byId = new Map(d.tasks.map((t) => [t.id, t]));

  const row = (t) => {
    const blockers = (t.blockedBy || []).filter((id) => byId.get(id)?.status !== 'completed');
    const editing = state.editing?.kind === 'task' && state.editing.id === t.id;
    const box = taskMode && editable
      ? h('button', { class: 'box', type: 'button', title: 'Change status', 'aria-label': `Status: ${t.status}. Click to change`, dataset: { action: 'task-status', task: t.id, status: t.status } }, t.status === 'completed' ? icon('check') : null)
      : h('span', { class: 'box' }, t.status === 'completed' ? icon('check') : null);
    return h('li', { class: `todo ${t.status}${editing ? ' editing' : ''}` },
      box,
      editing
        ? h('form', { class: 'inline-edit', dataset: { action: 'task-save', task: t.id } },
          h('input', { name: 'subject', value: state.editing.value, maxlength: '300', 'aria-label': 'Task subject', dataset: { draft: 'editing' } }),
          h('button', { class: 'btn small primary', type: 'submit' }, 'Save'),
          h('button', { class: 'btn small', type: 'button', dataset: { action: 'cancel-edit' } }, 'Cancel'))
        : h('span', { class: 'text' },
          t.content || t.subject,
          t.status === 'in_progress' && t.activeForm && t.activeForm !== t.subject ? h('span', { class: 'active' }, t.activeForm) : null,
          t.owner ? h('span', { class: 'active' }, `@${t.owner}`) : null,
          blockers.length && t.status !== 'completed' ? h('span', { class: 'blocked' }, `Blocked by #${blockers.join(', #')}`) : null,
        ),
      taskMode && editable && !editing
        ? h('span', { class: 'row-actions' },
          h('button', { class: 'icon-btn tiny', type: 'button', title: 'Edit task', dataset: { action: 'task-edit', task: t.id } }, icon('edit')),
          confirmButton('task-delete', { task: t.id }, 'Delete task'))
        : null,
    );
  };

  return panel(taskMode ? 'Tasks' : 'Plan',
    d.todosAt && !taskMode ? h('span', { class: 'meta' }, 'updated ', relTime(d.todosAt)) : h('span', { class: 'meta' }, taskMode && items.length ? `${done}/${items.length} done` : ''),
    items.length ? progress(done, items.length) : h('p', { class: 'muted' }, 'No tasks yet. Add one, and Claude will see it in this session\'s task list.'),
    items.length ? h('ul', { class: 'todos' }, items.map(row)) : null,
    taskMode && editable
      ? h('form', { class: 'add-row', dataset: { action: 'task-add' } },
        h('input', { name: 'subject', placeholder: 'Add a task…', maxlength: '300', value: state.drafts.task[d.id] || '', 'aria-label': 'New task', dataset: { draft: 'task' } }),
        h('button', { class: 'btn small', type: 'submit' }, 'Add'))
      : null,
    !taskMode && editable
      ? h('p', { class: 'panel-foot' }, 'This plan lives in Claude\'s own todo list. ',
        h('button', { class: 'link-btn', type: 'button', dataset: { action: 'ask-plan' } }, 'Ask Claude to change it'))
      : null,
  );
}

function confirmButton(action, data, label) {
  return h('button', { class: 'icon-btn tiny danger', type: 'button', title: label, 'aria-label': label, dataset: { action: 'confirm', then: action, ...data } }, icon('trash'));
}


function attentionPanel(d) {
  if (!d.attention) return null;
  const { lead, command } = splitAsk(d.attention.message);
  return h('section', { class: 'panel attention', role: 'alert' },
    h('div', { class: 'panel-head' },
      h('h2', {}, icon('shield'), d.attention.kind === 'question' ? 'Claude asked you something' : 'Permission needed'),
      h('span', { class: 'meta' }, relTime(d.attention.at))),
    command
      ? [h('p', { class: 'attention-lead' }, lead || 'Claude wants to run a command'),
        h('div', { class: 'command-box' },
          h('code', {}, command),
          h('button', { class: 'icon-btn tiny', type: 'button', title: 'Copy command', 'aria-label': 'Copy command', dataset: { action: 'copy', text: command } }, icon('copy')))]
      : h('p', { class: 'quote' }, d.attention.message || 'Claude is waiting for your approval.'),
    h('p', { class: 'hint' }, 'Approve or deny it in the terminal where this session runs. This page updates as soon as you answer.'),
  );
}

function renderTabbar() {
  const r = route();
  const live = state.sessions.filter((s) => s.live);
  const needs = live.filter((s) => s.state === 'permission' || s.state === 'waiting').length;
  const active = r.name === 'overview' ? 'needs' : r.name === 'activity' ? 'activity' : r.name === 'list' ? state.filter : null;
  const tab = (id, href, label, badge, dot) =>
    h('a', { class: 'tab', href, 'aria-current': active === id ? 'page' : null, dataset: { tab: id } },
      badge ? h('span', { class: `tab-badge ${dot}` }, badge) : h('i', { class: `dot ${dot}` }),
      h('span', {}, label));
  const unread = state.activity.filter((i) => i.at > state.activitySeen).length;
  $('#tabbar').replaceChildren(
    tab('needs', '#/', 'Needs you', needs, needs ? (live.some((s) => s.state === 'permission') ? 'permission' : 'waiting') : 'working'),
    tab('activity', '#/activity', 'Activity', unread, 'accent'),
    tab('live', '#/sessions', 'Live', null, 'working'),
    tab('history', '#/sessions', 'History', null, 'ended'),
  );
}

function composerPanel(d) {
  if (state.readOnly) return null;
  const note = d.live ? 'Open in a terminal · sends to a background copy' : 'Continues in the background · claude attach to open';
  return h('section', { class: `composer-dock${d.live ? ' warn' : ''}`, id: 'composer' },
    h('form', { dataset: { action: 'message-send' } },
      h('textarea', { name: 'message', rows: '2', maxlength: '20000', placeholder: d.state === 'waiting' ? 'Answer Claude or give the next instruction…' : 'Tell Claude what to do next…', 'aria-label': 'Message to Claude', dataset: { draft: 'message' } }, state.drafts.message[d.id] || ''),
      h('div', { class: 'composer-foot' },
        h('span', { class: 'composer-note', title: d.live ? 'Claude Code has no public way to type into an open terminal, so Skipper resumes the conversation in the background with claude --bg --resume.' : null }, note),
        h('span', { class: 'composer-keys' }, h('kbd', {}, '⌘'), h('kbd', {}, 'Enter')),
        h('button', { class: 'btn primary', type: 'submit', disabled: state.sending ? true : null, 'aria-label': 'Send message' }, icon('send'), state.sending ? 'Sending…' : 'Send')),
    ),
  );
}

function notesPanel(d) {
  const notes = d.notes || [];
  if (state.readOnly && !notes.length) return null;
  return panel('Notes', notes.length ? h('span', { class: 'meta' }, `${notes.length}`) : null,
    notes.length
      ? h('div', { class: 'items' }, notes.map((n) => {
        const editing = state.editing?.kind === 'note' && state.editing.id === n.id;
        return h('div', { class: 'item note' },
          editing
            ? h('form', { class: 'stack', dataset: { action: 'note-save', note: n.id } },
              h('textarea', { name: 'text', rows: '3', maxlength: '10000', 'aria-label': 'Edit note', dataset: { draft: 'editing' } }, state.editing.value),
              h('div', { class: 'btn-row' }, h('button', { class: 'btn small primary', type: 'submit' }, 'Save'), h('button', { class: 'btn small', type: 'button', dataset: { action: 'cancel-edit' } }, 'Cancel')))
            : h('p', { class: 'quote' }, n.text),
          editing ? null : h('div', { class: 'item-top' },
            h('span', { class: 'meta' }, relTime(n.updatedAt)),
            state.readOnly ? null : h('span', { class: 'row-actions visible' },
              h('button', { class: 'link-btn', type: 'button', dataset: { action: 'note-to-claude', note: n.id } }, 'Send to Claude'),
              h('button', { class: 'icon-btn tiny', type: 'button', title: 'Edit note', dataset: { action: 'note-edit', note: n.id } }, icon('edit')),
              confirmButton('note-delete', { note: n.id }, 'Delete note'))),
        );
      }))
      : h('p', { class: 'muted' }, 'Private notes for you. They stay in Skipper and are never sent unless you choose to.'),
    state.readOnly ? null : h('form', { class: 'stack add-note', dataset: { action: 'note-add' } },
      h('textarea', { name: 'text', rows: '2', maxlength: '10000', placeholder: 'Write a note…', 'aria-label': 'New note', dataset: { draft: 'note' } }, state.drafts.note[d.id] || ''),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn small', type: 'submit' }, 'Add note'))),
  );
}

function agentsPanel(d) {
  if (!d.agents.length) return null;
  const running = d.agents.filter((a) => a.status === 'running').length;
  return panel('Subagents', h('span', { class: 'meta' }, `${running} running · ${d.agents.length} total`),
    h('div', { class: 'agent-rows' }, d.agents.slice(0, 12).map((a) =>
      h('div', { class: `agent-row ${a.status}` },
        h('i', { class: `dot agent-${a.status}` }),
        h('div', { class: 'agent-main' },
          h('span', { class: 'agent-name' }, a.name || a.description || a.agentType, a.name && a.description ? h('span', { class: 'muted' }, ` · ${a.description}`) : null),
          h('span', { class: 'agent-meta' },
            a.model ? h('span', {}, a.model) : h('span', {}, a.agentType),
            a.worktreeBranch ? h('span', { class: 'meta' }, icon('branch'), a.worktreeBranch) : null,
            a.background ? h('span', {}, 'background') : null),
          a.result && a.status !== 'running' ? h('span', { class: 'item-result' }, plain(a.result)) : null),
        h('span', { class: 'agent-when' },
          a.status === 'running' ? (a.lastActiveAt ? ['active ', relTime(a.lastActiveAt)] : ['started ', relTime(a.startedAt)]) : a.status === 'completed' ? 'done' : a.status),
      ),
    )),
    d.agents.length > 12 ? h('p', { class: 'muted' }, `+ ${d.agents.length - 12} earlier subagents`) : null,
  );
}

function workflowsPanel(d) {
  if (!d.workflows.length) return null;
  return panel('Workflows', null,
    h('div', { class: 'items' }, d.workflows.slice(0, 8).map((w) =>
      h('div', { class: 'item' },
        h('div', { class: 'item-top' }, h('span', { class: 'item-title mono' }, w.name), w.status ? h('span', { class: `chip ${w.status}` }, w.status) : null),
        w.description ? h('span', { class: 'muted' }, w.description) : null,
        h('div', { class: 'meta-row' },
          w.agentCount != null ? h('span', { class: 'meta' }, icon('bot'), `${w.agentCount} agents`) : null,
          w.durationMs != null ? h('span', { class: 'meta' }, duration(w.durationMs)) : null,
          w.phases?.length ? h('span', { class: 'meta' }, icon('flow'), w.phases.join(' → ')) : null,
          w.startedAt ? h('span', { class: 'meta' }, relTime(w.startedAt)) : null,
        ),
      ),
    )),
  );
}

function loopPanel(d) {
  const loop = d.loopDetail;
  if (!loop || !loop.active || !d.live) return null;
  const pending = loop.wakeAt > now();
  return panel('Loop', h('span', { class: 'meta' }, icon('loop'), `wakeup ${loop.delaySeconds < 60 ? `${loop.delaySeconds}s` : duration(loop.delaySeconds * 1000)}`),
    pending ? h('div', { class: 'loop-clock' }, untilTime(loop.wakeAt)) : h('div', { class: 'loop-clock' }, 'running'),
    h('p', { class: 'muted' }, pending ? 'until the next iteration' : 'iteration in progress'),
    loop.reason ? h('p', { class: 'quote' }, loop.reason) : null,
  );
}

function linksPanel(d) {
  const rows = [
    ...d.prs.map((p) => ({ icon: 'pr', label: p.repo ? `${p.repo}#${p.number}` : p.url, url: p.url })),
    ...d.artifacts.map((a) => ({ icon: 'link', label: a.title, url: a.url })),
  ].filter((r) => safeHref(r.url));
  if (!rows.length) return null;
  return panel('Links', null, rows.map((r) =>
    h('div', { class: 'link-row' }, icon(r.icon), h('a', { href: safeHref(r.url), target: '_blank', rel: 'noopener noreferrer' }, r.label)),
  ));
}

function teamPanel(d) {
  if (!d.team || d.team.members.length < 2) return null;
  return panel('Team', h('span', { class: 'meta' }, icon('team'), d.team.name),
    h('div', { class: 'items' }, d.team.members.map((m) =>
      h('div', { class: 'item' }, h('div', { class: 'item-top' }, h('span', { class: 'item-title' }, m.name), m.agentType ? h('span', { class: 'chip' }, m.agentType) : null)),
    )),
  );
}

function detailGrid(mainPanels, sidePanels) {
  const side = sidePanels.filter(Boolean);
  return h('div', { class: `detail-grid${side.length ? '' : ' single'}` },
    h('div', { class: 'col' }, mainPanels),
    side.length ? h('div', { class: 'col' }, side) : null,
  );
}

function renderDetail(d) {
  renderPulse();
  if (!d) {
    return h('div', { class: 'empty' }, h('h1', {}, 'Session not found'), h('p', {}, h('a', { href: '#/' }, 'Back to overview')));
  }
  const running = d.state === 'working';
  const nowPanel = d.lastText || d.lastTool
    ? h('section', { class: 'panel now-panel' },
      h('div', { class: 'panel-head' }, h('h2', {}, d.state === 'ended' ? 'Last message' : 'Now'), h('span', { class: 'meta' }, relTime(d.lastTextAt || d.updatedAt))),
      d.lastText ? h('p', { class: 'quote clamp now-text' }, plain(d.lastText)) : null,
      d.lastTool && d.state !== 'ended'
        ? h('div', { class: 'tool-row' },
          h('span', { class: 'chip mono' }, toolName(d.lastTool.name)),
          d.lastTool.target ? h('span', { class: 'tool-target mono' }, d.lastTool.target) : null,
          h('span', { class: `tool-when${running ? ' live' : ''}` }, running ? 'running' : relTime(d.lastTool.at)))
        : null)
    : null;
  const pr = d.prs[d.prs.length - 1];
  const stats = [
    d.startedAt && d.updatedAt ? duration(d.updatedAt - d.startedAt) : null,
    d.turns ? `${d.turns} turn${d.turns === 1 ? '' : 's'}` : null,
    d.tokens ? `${formatTokens(d.tokens.output)} output tokens` : null,
    d.cost ? `$${d.cost.usd.toFixed(2)}` : null,
  ].filter(Boolean);
  const tokenTitle = d.tokens
    ? `${formatTokens(d.tokens.output)} output and ${formatTokens(d.tokens.input)} input tokens over ${d.tokens.responses} responses; ${Math.round((d.tokens.subagentOutput / Math.max(1, d.tokens.output)) * 100)}% of output from subagents, ${Math.round((d.tokens.cacheRead / Math.max(1, d.tokens.input)) * 100)}% of input from cache`
    : null;

  return h('article', { class: 'session-page' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' },
      h('a', { href: '#/' }, icon('back'), d.live ? 'Live' : 'History'), h('span', {}, '/'), h('span', {}, d.project)),
    h('header', { class: 'session-head' },
      h('div', { class: 'session-title' },
        h('div', { class: 'title-row' },
          h('h1', {}, d.title),
          h('span', { class: `chip ${d.state}` }, h('i', { class: `dot ${d.state}` }), STATE_LABEL[d.state])),
        h('div', { class: 'meta-line' },
          d.cwd ? h('span', { class: 'meta mono', title: d.cwd }, icon('folder'), d.cwd.replace(/^\/(Users|home)\/[^/]+/, '~')) : null,
          d.branch && d.branch !== 'HEAD' ? h('span', { class: 'meta' }, icon('branch'), d.branch) : null,
          d.model ? h('span', { class: 'meta' }, [d.model, d.permissionMode ? `${d.permissionMode} mode` : null].filter(Boolean).join(' · ')) : null,
          stats.length || d.cost ? h('span', { class: 'meta', title: tokenTitle }, stats.join(' · '),
            d.cost ? [' · ', h('span', { class: 'plus' }, `+${d.cost.linesAdded}`), ' ', h('span', { class: 'minus' }, `−${d.cost.linesRemoved}`)] : null) : null,
          d.state === 'working' && d.turnStartedAt ? h('span', { class: 'meta' }, 'turn running ', elapsedTime(d.turnStartedAt)) : null,
          quietLine(d, 'meta'),
          d.pid ? h('span', { class: 'meta mono faint' }, `pid ${d.pid}`) : null)),
      h('div', { class: 'head-actions' },
        pr && safeHref(pr.url) ? h('a', { class: 'btn', href: safeHref(pr.url), target: '_blank', rel: 'noopener noreferrer' }, icon('pr'), pr.number ? `PR #${pr.number}` : 'Pull request') : null,
        !d.live ? h('button', { class: 'btn', type: 'button', title: resumeCommand(d), dataset: { action: 'copy', text: resumeCommand(d), copied: 'Resume command copied. Paste it into a terminal.' } }, icon('copy'), 'Resume') : null,
        state.readOnly ? null : h('button', { class: 'btn primary', type: 'button', dataset: { action: 'focus-composer' } }, icon('send'), 'Message'))),
    detailGrid(
      [attentionPanel(d), nowPanel, planPanel(d), agentsPanel(d), composerPanel(d)],
      [loopPanel(d), linksPanel(d), notesPanel(d), workflowsPanel(d), teamPanel(d), d.lastPrompt ? panel('Your last prompt', null, h('p', { class: 'quote clamp muted' }, d.lastPrompt)) : null],
    ),
  );
}

function render() {
  if (!state.loaded) return;
  const r = route();
  document.body.classList.toggle('route-list', r.name === 'list');
  document.body.classList.toggle('route-session', r.name === 'session');
  renderTabbar();
  renderSidebar(r.id);
  const main = $('#main');
  const active = document.activeElement;
  if (active && main.contains(active) && active.matches('input, textarea') && main.dataset.view === (r.id || r.name)) {
    state.renderPending = true;
    renderPulse();
    return;
  }
  state.renderPending = false;
  const keepScroll = main.dataset.view === (r.id || r.name) ? main.scrollTop : 0;
  main.replaceChildren(r.name === 'session' ? renderDetail(state.detail) : r.name === 'activity' ? renderActivityPage() : r.name === 'usage' ? renderUsage() : renderOverview());
  if (r.name === 'list') renderPulse();
  main.dataset.view = r.id || r.name;
  main.scrollTop = keepScroll;
  if (r.name === 'session' && r.reply && state.detail) {
    // Reply links open the session ready to type; drop the suffix so reloads don't refocus.
    history.replaceState(null, '', `#/s/${r.id}`);
    focusComposer();
  }
}

/* ---------- controls ---------- */

const THEMES = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['midnight', 'Midnight'],
  ['paper', 'Paper'],
  ['contrast', 'High contrast'],
];

function applyTheme(theme) {
  const choice = THEMES.some(([id]) => id === theme) ? theme : 'system';
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  const dark = choice === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : ['dark', 'midnight', 'contrast'].includes(choice);
  $('#theme-btn').replaceChildren(icon(dark ? 'moon' : 'sun'));
  for (const item of document.querySelectorAll('[data-theme-choice]')) item.setAttribute('aria-checked', String(item.dataset.themeChoice === choice));
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.content = getComputedStyle(document.body).backgroundColor;
}

function toggleThemeMenu(open) {
  const menu = $('#theme-menu');
  const show = open ?? menu.hidden;
  menu.hidden = !show;
  $('#theme-btn').setAttribute('aria-expanded', String(show));
  if (show) menu.querySelector('[aria-checked="true"]')?.focus();
}

function cycleTheme() {
  const next = nextTheme(store.get('skipper.theme'), THEMES);
  if (!next) return;
  store.set('skipper.theme', next);
  applyTheme(next);
}

/* ---------- write actions ---------- */

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-skipper': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(message, kind = '') {
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, message);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 9000 : 6000);
}

const TASK_NEXT = { pending: 'in_progress', in_progress: 'completed', completed: 'pending' };

async function runAction(action, el, form) {
  const d = state.detail;
  if (!d && !['copy', 'dismiss-tip'].includes(action)) return;
  const base = d ? `/api/sessions/${d.id}` : '';
  const value = (name) => form?.elements[name]?.value ?? '';
  try {
    switch (action) {
      case 'message-send': {
        const message = value('message').trim();
        if (!message || state.sending) return;
        state.sending = true;
        render();
        try {
          const result = await api('POST', `${base}/message`, { message });
          state.drafts.message[d.id] = '';
          toast(result.output ? `Sent. ${result.output.split('\n').slice(-2).join(' ')}` : 'Sent to Claude.');
        } finally {
          state.sending = false;
        }
        break;
      }
      case 'note-add': {
        const text = value('text').trim();
        if (!text) return;
        await api('POST', `${base}/notes`, { text });
        state.drafts.note[d.id] = '';
        break;
      }
      case 'note-edit':
        state.editing = { kind: 'note', id: el.dataset.note, value: d.notes.find((n) => n.id === el.dataset.note)?.text || '' };
        render();
        document.querySelector('[data-draft="editing"]')?.focus();
        return;
      case 'note-save':
        await api('PATCH', `${base}/notes/${el.dataset.note}`, { text: value('text') });
        state.editing = null;
        break;
      case 'note-delete':
        await api('DELETE', `${base}/notes/${el.dataset.note}`);
        break;
      case 'note-to-claude': {
        const note = d.notes.find((n) => n.id === el.dataset.note);
        state.drafts.message[d.id] = [state.drafts.message[d.id], note?.text].filter(Boolean).join('\n\n');
        render();
        focusComposer();
        return;
      }
      case 'ask-plan':
        state.drafts.message[d.id] = state.drafts.message[d.id] || 'Please update your plan: ';
        render();
        focusComposer();
        return;
      case 'task-add': {
        const subject = value('subject').trim();
        if (!subject) return;
        await api('POST', `${base}/tasks`, { subject });
        state.drafts.task[d.id] = '';
        break;
      }
      case 'task-status':
        await api('PATCH', `${base}/tasks/${el.dataset.task}`, { status: TASK_NEXT[el.dataset.status] || 'pending' });
        break;
      case 'task-edit':
        state.editing = { kind: 'task', id: el.dataset.task, value: d.tasks.find((t) => t.id === el.dataset.task)?.subject || '' };
        render();
        document.querySelector('[data-draft="editing"]')?.focus();
        return;
      case 'task-save':
        await api('PATCH', `${base}/tasks/${el.dataset.task}`, { subject: value('subject') });
        state.editing = null;
        break;
      case 'task-delete':
        await api('DELETE', `${base}/tasks/${el.dataset.task}`);
        break;
      case 'copy': {
        const text = el.dataset.text || '';
        let copied = false;
        try {
          // writeText can hang without settling when the tab lacks focus.
          await Promise.race([navigator.clipboard.writeText(text), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))]);
          copied = true;
        } catch {
          // Plain-http network access has no async clipboard; fall back to a selection copy.
          const area = h('textarea', { class: 'copy-buffer', readonly: true, 'aria-hidden': 'true' }, text);
          document.body.append(area);
          area.select();
          try {
            copied = document.execCommand('copy');
          } catch {}
          area.remove();
        }
        toast(copied ? el.dataset.copied || 'Command copied' : 'Copy is not available here. Select the command instead.', copied ? '' : 'error');
        return;
      }
      case 'dismiss-tip':
        store.set(`skipper.tip.${el.dataset.tip}`, '1');
        render();
        return;
      case 'focus-composer':
        focusComposer();
        return;
      case 'cancel-edit':
        state.editing = null;
        render();
        return;
      default:
        return;
    }
  } catch (error) {
    toast(error.message, 'error');
    render();
    return;
  }
  document.activeElement?.blur();
  reload();
}

function focusComposer() {
  const area = document.querySelector('#composer textarea');
  if (!area) return;
  area.scrollIntoView({ block: 'center', behavior: 'smooth' });
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
}

function wireActions() {
  const main = $('#main');
  main.addEventListener('click', (event) => {
    const range = event.target.closest('[data-usage-days]');
    if (range) {
      state.usageDays = Number(range.dataset.usageDays);
      store.set('skipper.usageDays', String(state.usageDays));
      reload();
      return;
    }
    const chip = event.target.closest('[data-activity-filter]');
    if (chip) {
      state.activityFilter = chip.dataset.activityFilter;
      store.set('skipper.activityFilter', state.activityFilter);
      render();
      return;
    }
    if (event.target.closest('[data-activity-seen]')) {
      state.activitySeen = now();
      store.set('skipper.activitySeen', String(state.activitySeen));
      render();
      return;
    }
    const el = event.target.closest('[data-action]');
    if (!el || el.tagName === 'FORM') return;
    const action = el.dataset.action;
    if (action === 'confirm') {
      if (el.dataset.armed) {
        runAction(el.dataset.then, el);
      } else {
        el.dataset.armed = '1';
        el.classList.add('armed');
        el.title = 'Click again to delete';
        setTimeout(() => {
          delete el.dataset.armed;
          el.classList.remove('armed');
        }, 3000);
      }
      return;
    }
    runAction(action, el);
  });
  main.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-action]');
    if (!form) return;
    event.preventDefault();
    runAction(form.dataset.action, form, form);
  });
  main.addEventListener('input', (event) => {
    const field = event.target;
    const id = state.detail?.id;
    if (!field.dataset.draft || !id) return;
    if (field.dataset.draft === 'editing') {
      if (state.editing) state.editing.value = field.value;
    } else {
      state.drafts[field.dataset.draft][id] = field.value;
    }
  });
  main.addEventListener('keydown', (event) => {
    const field = event.target;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && field.matches('textarea')) {
      event.preventDefault();
      field.form?.requestSubmit();
    } else if (event.key === 'Escape' && state.editing && field.dataset.draft === 'editing') {
      event.stopPropagation();
      state.editing = null;
      field.blur();
      render();
    }
  });
  main.addEventListener('focusout', () => {
    setTimeout(() => {
      if (state.renderPending && !(main.contains(document.activeElement) && document.activeElement.matches('input, textarea'))) render();
    }, 150);
  });
}

function init() {
  const themeParam = new URLSearchParams(location.search).get('theme');
  if (themeParam) store.set('skipper.theme', themeParam);
  applyTheme(themeParam || store.get('skipper.theme'));
  $('#theme-btn').addEventListener('click', (event) => {
    event.stopPropagation();
    toggleThemeMenu();
  });
  for (const item of document.querySelectorAll('[data-theme-choice]')) {
    item.addEventListener('click', () => {
      store.set('skipper.theme', item.dataset.themeChoice);
      applyTheme(item.dataset.themeChoice);
      toggleThemeMenu(false);
      $('#theme-btn').focus();
    });
  }
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#theme-menu')) toggleThemeMenu(false);
    if (!event.target.closest('#notify-menu')) toggleNotifyMenu(false);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(store.get('skipper.theme')));
  wireActions();
  const readout = (event) => {
    const bar = event.target.closest?.('.bar-col');
    const out = document.getElementById('chart-readout');
    if (bar && out) out.textContent = bar.dataset.tip;
  };
  $('#main').addEventListener('mouseover', readout);
  $('#main').addEventListener('focusin', readout);
  $('#tabbar').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (!tab || tab.dataset.tab === 'needs' || tab.dataset.tab === 'activity') return;
    state.filter = tab.dataset.tab;
    store.set('skipper.filter', state.filter);
    if (location.hash === '#/sessions') render();
  });

  state.sound = store.get('skipper.sound') !== '0';
  state.turns = store.get('skipper.turns') !== '0';
  state.desktop = store.get('skipper.desktop') === '1' && 'Notification' in window && Notification.permission === 'granted';
  syncNotifyMenu();
  $('#notify-btn').addEventListener('click', (event) => {
    event.stopPropagation();
    toggleThemeMenu(false);
    toggleNotifyMenu();
  });
  $('#notify-menu').addEventListener('click', async (event) => {
    event.stopPropagation();
    const item = event.target.closest('[data-setting]');
    if (!item) return;
    if (item.dataset.setting === 'sound') {
      state.sound = !state.sound;
      store.set('skipper.sound', state.sound ? '1' : '0');
      if (state.sound) chime('waiting');
    } else if (item.dataset.setting === 'desktop') {
      if (!state.desktop && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
      const allowed = 'Notification' in window && Notification.permission === 'granted';
      if (!allowed && !state.desktop) toast('Notifications are blocked for this site. Allow them in your browser settings.', 'error');
      state.desktop = !state.desktop && allowed;
      store.set('skipper.desktop', state.desktop ? '1' : '0');
    } else if (item.dataset.setting === 'turns') {
      state.turns = !state.turns;
      store.set('skipper.turns', state.turns ? '1' : '0');
    } else if (item.dataset.setting === 'test') {
      state.lastAlert = {};
      alertUser({ id: null, kind: 'permission', title: 'Permission needed: test alert', body: 'This is what a permission prompt sounds like.' });
    }
    syncNotifyMenu();
  });
  // Browsers only allow audio after a user gesture; unlock it on the first one.
  document.addEventListener('pointerdown', () => {
    if (!state.sound) return;
    try {
      audio ||= new AudioContext();
      if (audio.state === 'suspended') audio.resume();
    } catch {}
  }, { once: true });

  state.filter = store.get('skipper.filter') === 'history' ? 'history' : 'live';
  state.usageDays = [1, 7, 14, 30].includes(Number(store.get('skipper.usageDays'))) ? Number(store.get('skipper.usageDays')) : 14;
  state.activitySeen = Number(store.get('skipper.activitySeen')) || 0;
  if (!state.activitySeen) {
    // First visit: only the last hour counts as new, not the whole week.
    state.activitySeen = Date.now() - 3_600_000;
    store.set('skipper.activitySeen', String(state.activitySeen));
  }
  state.activityFilter = store.get('skipper.activityFilter') || 'all';
  $('#sidebar').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-filter]');
    const project = event.target.closest('[data-project]');
    if (tab) {
      state.filter = tab.dataset.filter;
      store.set('skipper.filter', state.filter);
    } else if (project) {
      state.project = project.dataset.project && state.project !== project.dataset.project ? project.dataset.project : null;
    } else {
      return;
    }
    render();
  });

  const search = $('#search');
  search.addEventListener('input', () => {
    state.query = search.value;
    render();
  });
  let pendingG = 0;
  document.addEventListener('keydown', (event) => {
    const typing = event.target.closest?.('input, textarea, select, [contenteditable]');
    const dialog = $('#shortcuts');
    if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key === '?') {
        event.preventDefault();
        dialog.open ? dialog.close() : dialog.showModal();
        return;
      }
      if (event.key === 't') {
        event.preventDefault();
        cycleTheme();
        return;
      }
      if (pendingG && Date.now() - pendingG < 1200) {
        pendingG = 0;
        const target = { o: '#/', a: '#/activity', l: '#/sessions', h: '#/sessions' }[event.key];
        if (target) {
          event.preventDefault();
          if (event.key === 'l' || event.key === 'h') {
            state.filter = event.key === 'h' ? 'history' : 'live';
            store.set('skipper.filter', state.filter);
          }
          if (location.hash === target) render();
          else location.hash = target;
          return;
        }
      }
      if (event.key === 'g') {
        pendingG = Date.now();
        return;
      }
      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        const ids = [...document.querySelectorAll('#session-list .session-link')].map((a) => a.getAttribute('href'));
        if (!ids.length) return;
        const current = ids.indexOf(location.hash);
        const next = current === -1 ? 0 : Math.min(ids.length - 1, Math.max(0, current + (event.key === 'j' ? 1 : -1)));
        location.hash = ids[next];
        document.querySelector(`#session-list a[href="${ids[next]}"]`)?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (event.key === 'm' && route().name === 'session' && !state.readOnly) {
        event.preventDefault();
        focusComposer();
        return;
      }
    }
    if (event.key === '/' && document.activeElement !== search) {
      event.preventDefault();
      search.focus();
    } else if (event.key === 'Escape') {
      if (search.value) {
        search.value = '';
        state.query = '';
        render();
      } else if (!$('#theme-menu').hidden || !$('#notify-menu').hidden) {
        toggleThemeMenu(false);
        toggleNotifyMenu(false);
      } else if (route().name !== 'overview') {
        location.hash = '#/';
      }
    }
  });

  window.addEventListener('hashchange', () => {
    state.detail = null;
    reload();
  });
  setInterval(tick, 1000);
  // ?static renders once without a live connection (used for README screenshots).
  if (new URLSearchParams(location.search).has('static')) reload();
  else connect();
}

init();
