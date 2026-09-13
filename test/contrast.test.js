import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');

function tokens(selector) {
  const start = css.indexOf(selector);
  const end = css.indexOf('}', start);
  return Object.fromEntries([...css.slice(start, end).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const base = tokens(':root {');
const themes = {
  light: base,
  dark: { ...base, ...tokens(':root[data-theme="dark"]') },
  midnight: { ...base, ...tokens(':root[data-theme="midnight"]') },
  paper: { ...base, ...tokens(':root[data-theme="paper"]') },
  contrast: { ...base, ...tokens(':root[data-theme="contrast"]') },
};

for (const [name, t] of Object.entries(themes)) {
  test(`${name} theme text meets WCAG AA (4.5:1)`, () => {
    const failures = [];
    for (const fg of ['text', 'muted', 'faint', 'accent', 'working', 'waiting', 'sleeping', 'permission', 'danger']) {
      for (const bg of ['bg', 'surface', 'surface-2']) {
        const r = ratio(t[fg], t[bg]);
        if (r < 4.5) failures.push(`${fg} on ${bg}: ${r.toFixed(2)}`);
      }
    }
    for (const state of ['working', 'waiting', 'sleeping', 'permission']) {
      const r = ratio(t[state], t[`${state}-soft`]);
      if (r < 4.5) failures.push(`${state} on ${state}-soft: ${r.toFixed(2)}`);
    }
    assert.deepEqual(failures, []);
  });
}

test('the dark tokens in the system media query match the explicit dark theme', () => {
  const media = tokens('@media (prefers-color-scheme: dark)');
  const dark = tokens(':root[data-theme="dark"]');
  for (const [key, value] of Object.entries(dark)) assert.equal(media[key], value, `--${key}`);
});

test('forced-colors mode keeps status dots and chart bars visible', () => {
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  const block = css.slice(css.indexOf('@media (forced-colors: active)'));
  assert.ok(block.length > 40, 'forced-colors block is missing');
  for (const selector of ['.dot', '.bar-fill', '.ranked-track i', '.segments i']) assert.ok(block.includes(selector), `${selector} is not covered`);
  assert.match(block, /forced-color-adjust: none/);
});

test('the pairing QR code is not painted over by the global icon stroke', () => {
  const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /svg \{[^}]*stroke: currentColor/, 'icons still get their stroke');
  assert.match(css, /\.qr \* \{ stroke: none; \}/, 'QR modules must not inherit the icon stroke');
});
