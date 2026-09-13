import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const logic = readFileSync(new URL('../public/logic.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const source = `${logic}\n${app}`;

test('app.js parses', () => {
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'app.js' }));
});

test('every locally named function that is called is defined', () => {
  const defined = new Set([...source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  for (const m of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)) defined.add(m[1]);
  const ours = /^(?:(?:render|queue|session|alert|toggle|sync|apply|focus|wire|run|notify|attention|composer|notes|plan|agents|workflows|loop|links|team)(?:[A-Z]\w*)?|panel|segments|metaItem|chime|confirmButton|load|reload|connect|route|matches|visibleSessions|progress|detailGrid|toast|api|ago|countdown|duration|plain|safeHref|toolName|tick|icon|h|setOffline|onHookAlert|hooksTip|formatAgo|formatCountdown|dayBucket|dayBucketAt|groupActivity|splitAsk|resumeCommand)$/;
  const missing = new Set();
  for (const m of source.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (ours.test(name) && !defined.has(name) && !['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'setTimeout', 'setInterval'].includes(name)) missing.add(name);
  }
  assert.deepEqual([...missing], []);
});

test('index.html references only elements app.js expects', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of source.matchAll(/\$\('#([\w-]+)'\)/g)) assert.ok(ids.has(m[1]), `#${m[1]} is missing from index.html`);
});


const helpers = (() => {
  const context = {};
  vm.runInNewContext(`${logic}\n;globalThis.out = { resumeCommand, formatAgo, formatCountdown, duration, safeHref, toolName, plain, splitAsk, dayBucketAt, groupActivity };`, context);
  return context.out;
})();

test('relative times and countdowns', () => {
  const now = Date.UTC(2026, 8, 13, 12, 0, 0);
  assert.equal(helpers.formatAgo(now - 50_000, now), 'just now');
  assert.equal(helpers.formatAgo(now - 59_000, now), 'just now');
  assert.equal(helpers.formatAgo(now - 61_000, now), '1m ago');
  assert.equal(helpers.formatAgo(now - 3 * 3_600_000, now), '3h ago');
  assert.equal(helpers.formatAgo(now - 36 * 3_600_000, now), '1d ago');
  assert.equal(helpers.formatCountdown(now + 42_000, now), '42s');
  assert.equal(helpers.formatCountdown(now + 13 * 60_000 + 5_000, now), '13m 05s');
  assert.equal(helpers.formatCountdown(now - 1, now), 'waking…');
  assert.equal(helpers.duration(52 * 60_000), '52m');
  assert.equal(helpers.duration(0), '—');
});

test('link, tool and text helpers stay safe', () => {
  assert.equal(helpers.safeHref('javascript:alert(1)'), null);
  assert.equal(helpers.safeHref('http://example.com'), null);
  assert.equal(helpers.safeHref('https://github.com/o/r/pull/1'), 'https://github.com/o/r/pull/1');
  assert.equal(helpers.toolName('mcp__claude-in-chrome__read_page'), 'claude-in-chrome · read_page');
  assert.equal(helpers.plain('## Done\n**All** `tests` pass'), 'Done\nAll tests pass');
});

test('permission messages split into a lead and a command', () => {
  assert.deepEqual({ ...helpers.splitAsk('Claude needs your permission to use Bash: npm run e2e') }, { lead: 'Claude needs your permission to use Bash', command: 'npm run e2e' });
  assert.equal(helpers.splitAsk('Claude is waiting for your input').command, null);
  assert.equal(helpers.splitAsk(null).command, null);
});

test('interleaved loop ticks merge per session and time group', () => {
  const now = Date.UTC(2026, 8, 13, 12, 0, 0);
  const tick = (sessionId, min) => ({ at: now - min * 60_000, kind: 'loop', sessionId, title: sessionId, detail: null });
  const items = [tick('a', 1), tick('b', 2), tick('a', 5), { at: now - 6 * 60_000, kind: 'pr', sessionId: 'a' }, tick('b', 7), tick('a', 90)];
  const grouped = helpers.groupActivity(items, (at) => helpers.dayBucketAt(at, now));
  assert.deepEqual(JSON.parse(JSON.stringify(grouped.map((g) => [g.sessionId, g.kind, g.count]))), [['a', 'loop', 2], ['b', 'loop', 2], ['a', 'pr', 1], ['a', 'loop', 1]]);
});

test('resume command cds into the project and quotes unusual paths', () => {
  const id = '11111111-2222-4333-8444-555555555555';
  assert.equal(helpers.resumeCommand({ id, cwd: '/Users/me/code/storefront' }), `cd /Users/me/code/storefront && claude --resume ${id}`);
  assert.equal(helpers.resumeCommand({ id, cwd: "/Users/me/my app's" }), `cd '/Users/me/my app'\\''s' && claude --resume ${id}`);
  assert.equal(helpers.resumeCommand({ id, cwd: null }), `claude --resume ${id}`);
  assert.equal(helpers.resumeCommand(null), null);
});
