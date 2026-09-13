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
  const ours = /^(?:(?:render|queue|session|alert|toggle|sync|apply|focus|wire|run|notify|attention|composer|notes|plan|agents|workflows|loop|links|team)(?:[A-Z]\w*)?|panel|segments|metaItem|chime|confirmButton|load|reload|connect|route|matches|visibleSessions|progress|detailGrid|toast|api|ago|countdown|duration|plain|safeHref|toolName|tick|icon|h|setOffline|onHookAlert|hooksTip|formatAgo|formatCountdown|dayBucket|dayBucketAt|groupActivity|splitAsk|resumeCommand|formatTokens|niceScale|elapsedTime|relTimeBare|quietLine|quietReason)$/;
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
  vm.runInNewContext(`${logic}\n;globalThis.out = { quietReason, formatTokens, niceScale, nextTheme, resumeCommand, formatAgo, formatCountdown, duration, safeHref, toolName, plain, splitAsk, dayBucketAt, groupActivity, faviconHref };`, context);
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
  assert.equal(helpers.duration(42_000), '42s');
  assert.equal(helpers.duration(3 * 3_600_000 + 5 * 60_000), '3h 5m');
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

test('token counts are formatted compactly', () => {
  assert.equal(helpers.formatTokens(950), '950');
  assert.equal(helpers.formatTokens(1234), '1.23k');
  assert.equal(helpers.formatTokens(740000), '740k');
  assert.equal(helpers.formatTokens(1_840_000), '1.84M');
  assert.equal(helpers.formatTokens(35_400_000), '35.4M');
  assert.equal(helpers.formatTokens(1_708_483_163), '1.71B');
  assert.equal(helpers.formatTokens(2_000_000), '2M');
});

test('chart scale rounds up to a readable maximum', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.niceScale(740_000))), { max: 1_000_000, ticks: [0, 500_000, 1_000_000] });
  assert.deepEqual(JSON.parse(JSON.stringify(helpers.niceScale(310))), { max: 400, ticks: [0, 200, 400] });
  assert.equal(helpers.niceScale(0).max, 1);
});

test('theme cycling follows menu order and wraps', () => {
  const themes = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark'], ['midnight', 'Midnight'], ['paper', 'Paper'], ['contrast', 'High contrast']];
  assert.equal(helpers.nextTheme(null, themes), 'system');
  assert.equal(helpers.nextTheme('system', themes), 'light');
  assert.equal(helpers.nextTheme('paper', themes), 'contrast');
  assert.equal(helpers.nextTheme('contrast', themes), 'system');
});

test('theme shortcut is wired outside typing fields and documented', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const keys = app.slice(app.indexOf("document.addEventListener('keydown'"), app.indexOf("window.addEventListener('hashchange'"));
  assert.match(keys, /const typing = .*input, textarea, select, \[contenteditable\]/);
  assert.match(keys, /if \(!typing[\s\S]*event\.key === 't'[\s\S]*cycleTheme\(\)/);
  assert.match(html, /<kbd>t<\/kbd><\/dt><dd>Cycle theme<\/dd>/);
});

test('quiet sessions explain whether a tool is still running', () => {
  const now = 1_000_000_000;
  const base = { state: 'working', updatedAt: now - 6 * 60_000 };
  assert.equal(helpers.quietReason({ ...base, updatedAt: now - 60_000 }, now), null, 'not quiet yet');
  assert.equal(helpers.quietReason({ ...base, state: 'waiting' }, now), null, 'only working sessions');
  const running = helpers.quietReason({ ...base, lastTool: { name: 'Bash', target: 'flutter test', at: base.updatedAt - 30_000, pending: true } }, now);
  assert.equal(running.kind, 'tool');
  assert.equal(running.tool, 'Bash');
  const silent = helpers.quietReason({ ...base, lastTool: { name: 'Bash', at: base.updatedAt - 60_000, pending: false } }, now);
  assert.equal(silent.kind, 'silent');
});

test('faviconHref marks attention with a larger colored dot', () => {
  const { faviconHref } = helpers;
  const decode = (href) => decodeURIComponent(href.replace('data:image/svg+xml,', ''));
  assert.match(faviconHref('clear'), /^data:image\/svg\+xml,/);
  assert.match(decode(faviconHref('permission')), /r="11" fill="#ef5a52"/);
  assert.match(decode(faviconHref('waiting')), /fill="#f2b33d"/);
  assert.match(decode(faviconHref('bogus')), /r="5" fill="#3ccf8e"/);
});
