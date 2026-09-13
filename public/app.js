'use strict';

const STATE_LABEL = { waiting: 'Needs you', working: 'Working', sleeping: 'Sleeping', ended: 'Ended' };
const DAY = 86_400_000;

const state = {
  sessions: [],
  detail: null,
  serverOffset: 0,
  claudeDir: '',
  filter: 'active',
  query: '',
  notify: false,
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
  edit: 'M4 20h4L19 9l-4-4L4 16ZM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  send: 'M4 12 20 4l-6 16-3-7Z',
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
  if (!ms) return '';
  const s = Math.max(0, Math.round((now() - ms) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < DAY / 1000) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * DAY / 1000) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function countdown(ms) {
  const s = Math.round((ms - now()) / 1000);
  if (s <= 0) return 'waking…';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function duration(ms) {
  if (!ms || ms < 0) return '—';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const hrs = Math.floor(m / 60);
  return hrs < 48 ? `${hrs}h ${m % 60}m` : `${Math.round(hrs / 24)}d`;
}

const relTime = (ms) => h('span', { class: 'rel', dataset: { rel: String(ms || '') } }, ago(ms));
const untilTime = (ms) => h('span', { class: 'until', dataset: { until: String(ms || '') } }, countdown(ms));

function tick() {
  for (const el of document.querySelectorAll('[data-rel]')) el.textContent = ago(Number(el.dataset.rel));
  for (const el of document.querySelectorAll('[data-until]')) el.textContent = countdown(Number(el.dataset.until));
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
  notifyChanges(data.sessions);
  state.sessions = data.sessions;
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
    .catch(() => setOffline(true))
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
  events.onerror = () => {
    events.close();
    reload();
    setTimeout(connect, 3000);
  };
}

/* ---------- notifications ---------- */

function notifyChanges(next) {
  const before = state.previous;
  state.previous = new Map(next.map((s) => [s.id, s]));
  if (!before) return;
  for (const s of next) {
    const old = before.get(s.id);
    if (!old) continue;
    if (s.state === 'waiting' && old.state === 'working') alertUser(`Needs you: ${s.title}`, s.id);
    else if (s.agentsRunning < old.agentsRunning && s.live) alertUser(`Subagent finished in ${s.title}`, s.id);
  }
}

function alertUser(message, id) {
  const toast = h('div', { class: 'toast', role: 'status' }, h('a', { href: `#/s/${id}` }, message));
  $('#toasts').append(toast);
  setTimeout(() => toast.remove(), 7000);
  if (state.notify && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
    const n = new Notification('Skipper', { body: message, tag: id, icon: '/icon.svg' });
    n.onclick = () => {
      window.focus();
      location.hash = `#/s/${id}`;
    };
  }
}

/* ---------- routing ---------- */

function route() {
  const hash = location.hash;
  const match = hash.match(/^#\/s\/([0-9a-f-]{36})$/i);
  if (match) return { name: 'session', id: match[1] };
  if (hash === '#/sessions') return { name: 'list' };
  return { name: 'overview' };
}

/* ---------- rendering ---------- */

function matches(s) {
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  return [s.title, s.project, s.cwd, s.branch, s.current, s.team].some((v) => v && v.toLowerCase().includes(q));
}

function visibleSessions() {
  const cutoff = now() - 2 * DAY;
  return state.sessions.filter((s) => matches(s) && (state.filter === 'all' || state.query || s.live || s.updatedAt > cutoff));
}

function renderPulse() {
  const counts = { waiting: 0, working: 0, sleeping: 0 };
  let agents = 0;
  for (const s of state.sessions) {
    if (counts[s.state] != null) counts[s.state]++;
    agents += s.agentsRunning;
  }
  const pill = (dot, n, label, optional) => h('span', { class: `pulse${optional ? ' optional' : ''}` }, dot && h('i', { class: `dot ${dot}` }), h('b', {}, n), label);
  $('#pulse').replaceChildren(
    pill('waiting', counts.waiting, 'need you'),
    pill('working', counts.working, 'working'),
    pill('sleeping', counts.sleeping, 'sleeping', true),
    pill(null, agents, agents === 1 ? 'subagent running' : 'subagents running', true),
  );
  document.title = counts.waiting ? `(${counts.waiting}) Skipper` : 'Skipper';
  return { ...counts, agents };
}

function renderSidebar(currentId) {
  const list = visibleSessions();
  const groups = [
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
    nodes.push(h('p', { class: 'empty-list' }, state.query ? 'No sessions match your search.' : 'No active sessions. Switch to All sessions to see history.'));
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

function sessionCard(s) {
  return h('a', { class: `card ${s.state}`, href: `#/s/${s.id}` },
    h('div', { class: 'card-top' },
      h('span', { class: `chip ${s.state}` }, h('i', { class: `dot ${s.state}` }), STATE_LABEL[s.state]),
      h('span', { class: 'meta' }, s.state === 'sleeping' && s.loop ? ['wakes in ', untilTime(s.loop.wakeAt)] : relTime(s.updatedAt)),
    ),
    h('div', { class: 'card-title' }, s.title),
    s.current || s.lastText ? h('div', { class: 'card-now' }, plain(s.state === 'sleeping' && s.loop?.reason ? s.loop.reason : s.current || s.lastText)) : null,
    progress(s.todoDone, s.todoTotal),
    h('div', { class: 'card-foot' },
      h('span', { class: 'meta' }, icon('folder'), s.project),
      s.branch && s.branch !== 'HEAD' ? h('span', { class: 'meta' }, icon('branch'), s.branch) : null,
      s.agentsRunning ? h('span', { class: 'meta' }, icon('bot'), `${s.agentsRunning} running`) : null,
      s.prCount ? h('span', { class: 'meta' }, icon('pr'), s.prCount) : null,
    ),
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
  const order = { waiting: 0, working: 1, sleeping: 2 };
  live.sort((a, b) => order[a.state] - order[b.state] || b.updatedAt - a.updatedAt);
  const recent = state.sessions.filter((s) => !s.live && matches(s)).slice(0, 8);

  const stat = (cls, n, label) => h('div', { class: `stat ${cls}` }, h('div', { class: 'num' }, n), h('div', { class: 'label' }, cls && h('i', { class: `dot ${cls}` }), label));

  return h('div', {},
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', {}, counts.waiting ? `${counts.waiting} session${counts.waiting > 1 ? 's' : ''} waiting on you` : live.length ? 'Everything is moving' : 'All quiet'),
        h('p', { class: 'lede' }, `${live.length} live session${live.length === 1 ? '' : 's'} · ${state.sessions.length} in history`),
      ),
      h('a', { class: 'meta', href: '#/sessions' }, icon('list'), 'All sessions'),
    ),
    h('div', { class: 'stats' },
      stat('waiting', counts.waiting, 'Need you'),
      stat('working', counts.working, 'Working'),
      stat('sleeping', counts.sleeping, 'Sleeping loops'),
      stat('', counts.agents, 'Subagents running'),
    ),
    h('section', { class: 'section' },
      h('h2', {}, 'Live now'),
      live.length ? h('div', { class: 'cards' }, live.map(sessionCard)) : h('p', { class: 'muted' }, 'No Claude Code session is running right now.'),
    ),
    recent.length ? h('section', { class: 'section' },
      h('h2', {}, 'Recently finished'),
      h('div', { class: 'table' }, recent.map((s) =>
        h('a', { class: 'row', href: `#/s/${s.id}` },
          h('i', { class: 'dot ended' }),
          h('span', { class: 'title' }, s.title),
          h('span', { class: 'dim hide-sm' }, s.project),
          h('span', { class: 'num hide-sm' }, s.costUsd != null ? `$${s.costUsd.toFixed(2)}` : ''),
          h('span', { class: 'num' }, relTime(s.updatedAt)),
        ),
      )),
    ) : null,
  );
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

function composerPanel(d) {
  if (state.readOnly) return null;
  const hint = d.live
    ? 'This session is open in a terminal. Sending starts a background copy that continues from here; the open terminal will not see the message.'
    : 'Continues this session in the background with claude --bg --resume. Open it any time with claude attach.';
  return h('section', { class: `panel composer${d.live ? ' warn' : ''}`, id: 'composer' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Message Claude'), h('span', { class: 'meta' }, h('kbd', {}, '⌘'), h('kbd', {}, 'Enter'))),
    h('form', { dataset: { action: 'message-send' } },
      h('textarea', { name: 'message', rows: '3', maxlength: '20000', placeholder: d.state === 'waiting' ? 'Answer Claude or give the next instruction…' : 'Tell Claude what to do next…', 'aria-label': 'Message to Claude', dataset: { draft: 'message' } }, state.drafts.message[d.id] || ''),
      h('div', { class: 'composer-foot' },
        h('p', { class: 'hint' }, hint),
        h('button', { class: 'btn primary', type: 'submit', disabled: state.sending ? true : null }, state.sending ? 'Sending…' : 'Send')),
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
    h('div', { class: 'items' }, d.agents.slice(0, 12).map((a) =>
      h('div', { class: 'item' },
        h('div', { class: 'item-top' },
          h('span', { class: 'item-title' }, a.name || a.description || a.agentType),
          h('span', { class: `chip ${a.status}` }, a.status),
        ),
        a.name && a.description ? h('span', { class: 'muted' }, a.description) : null,
        h('div', { class: 'meta-row' },
          h('span', { class: 'meta' }, icon('bot'), a.agentType),
          a.model ? h('span', { class: 'meta' }, icon('chip'), a.model) : null,
          a.worktreeBranch ? h('span', { class: 'meta' }, icon('branch'), a.worktreeBranch) : null,
          a.background ? h('span', { class: 'meta' }, 'background') : null,
          h('span', { class: 'meta' }, a.status === 'running' && a.lastActiveAt ? ['active ', relTime(a.lastActiveAt)] : ['started ', relTime(a.startedAt)]),
        ),
        a.result && a.status !== 'running' ? h('div', { class: 'item-result' }, plain(a.result)) : null,
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
  const strip = (label, value) => h('div', {}, h('dt', {}, label), h('dd', {}, value));
  const nowPanel = d.lastText
    ? panel(d.state === 'ended' ? 'Last message' : 'Latest from Claude', h('span', { class: 'meta' }, relTime(d.lastTextAt)),
      h('p', { class: 'quote clamp' }, plain(d.lastText)),
      d.lastTool && d.state !== 'ended' ? h('p', { class: 'meta', style: 'margin:12px 0 0' }, 'Last tool ', h('span', { class: 'chip mono' }, toolName(d.lastTool.name)), relTime(d.lastTool.at)) : null)
    : null;

  return h('article', {},
    h('a', { class: 'back', href: '#/' }, icon('back'), 'Overview'),
    h('header', { class: 'detail-head' },
      h('span', { class: `chip ${d.state}` }, h('i', { class: `dot ${d.state}` }), STATE_LABEL[d.state]),
      h('h1', {}, d.title),
      h('div', { class: 'meta-row' },
        d.cwd ? h('span', { class: 'meta mono', title: d.cwd }, icon('folder'), d.cwd) : null,
        d.branch && d.branch !== 'HEAD' ? h('span', { class: 'meta' }, icon('branch'), d.branch) : null,
        d.model ? h('span', { class: 'meta' }, icon('chip'), d.model) : null,
        d.permissionMode ? h('span', { class: 'meta' }, `${d.permissionMode} mode`) : null,
        d.pid ? h('span', { class: 'meta mono' }, `pid ${d.pid}`) : null,
      ),
    ),
    h('dl', { class: 'strip' },
      strip('Last activity', relTime(d.updatedAt)),
      strip('Duration', duration(d.updatedAt - d.startedAt)),
      strip('Turns', d.turns || '—'),
      strip('Cost', d.cost ? `$${d.cost.usd.toFixed(2)}` : '—'),
      strip('Lines', d.cost ? `+${d.cost.linesAdded} −${d.cost.linesRemoved}` : '—'),
    ),
    detailGrid(
      [composerPanel(d), nowPanel, planPanel(d), agentsPanel(d), d.lastPrompt ? panel('Your last prompt', null, h('p', { class: 'quote clamp' }, d.lastPrompt)) : null],
      [loopPanel(d), notesPanel(d), workflowsPanel(d), teamPanel(d), linksPanel(d)],
    ),
  );
}

function render() {
  if (!state.loaded) return;
  const r = route();
  document.body.classList.toggle('route-list', r.name === 'list');
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
  main.replaceChildren(r.name === 'session' ? renderDetail(state.detail) : renderOverview());
  if (r.name === 'list') renderPulse();
  main.dataset.view = r.id || r.name;
  main.scrollTop = keepScroll;
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
  if (!d) return;
  const base = `/api/sessions/${d.id}`;
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
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(store.get('skipper.theme')));
  wireActions();

  state.notify = store.get('skipper.notify') === '1' && 'Notification' in window && Notification.permission === 'granted';
  const notifyBtn = $('#notify-btn');
  notifyBtn.setAttribute('aria-pressed', String(state.notify));
  notifyBtn.addEventListener('click', async () => {
    if (!state.notify && 'Notification' in window && Notification.permission !== 'granted') {
      await Notification.requestPermission();
    }
    state.notify = !state.notify && 'Notification' in window && Notification.permission === 'granted';
    store.set('skipper.notify', state.notify ? '1' : '0');
    notifyBtn.setAttribute('aria-pressed', String(state.notify));
  });

  state.filter = store.get('skipper.filter') === 'all' ? 'all' : 'active';
  for (const btn of document.querySelectorAll('[data-filter]')) {
    btn.setAttribute('aria-selected', String(btn.dataset.filter === state.filter));
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      store.set('skipper.filter', state.filter);
      for (const b of document.querySelectorAll('[data-filter]')) b.setAttribute('aria-selected', String(b === btn));
      render();
    });
  }

  const search = $('#search');
  search.addEventListener('input', () => {
    state.query = search.value;
    render();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== search) {
      event.preventDefault();
      search.focus();
    } else if (event.key === 'Escape') {
      if (search.value) {
        search.value = '';
        state.query = '';
        render();
      } else if (!$('#theme-menu').hidden) {
        toggleThemeMenu(false);
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
