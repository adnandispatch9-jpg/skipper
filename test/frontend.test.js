import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('app.js parses', () => {
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'app.js' }));
});

test('every locally named function that is called is defined', () => {
  const defined = new Set([...source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  for (const m of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)) defined.add(m[1]);
  const ours = /^(?:(?:render|queue|session|alert|toggle|sync|apply|focus|wire|run|notify|attention|composer|notes|plan|agents|workflows|loop|links|team)(?:[A-Z]\w*)?|panel|segments|metaItem|chime|confirmButton|load|reload|connect|route|matches|visibleSessions|progress|detailGrid|toast|api|ago|countdown|duration|plain|safeHref|toolName|tick|icon|h|setOffline|onHookAlert)$/;
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
