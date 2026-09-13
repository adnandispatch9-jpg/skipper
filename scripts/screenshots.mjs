#!/usr/bin/env node
// Regenerates docs/screenshots from --demo data with a headless Chromium.
// Set CHROME_BIN, or have Chrome / Playwright's headless shell installed.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'screenshots');
const port = 4399;

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().reverse()) {
      for (const sub of readdirSync(path.join(cache, dir))) {
        const bin = path.join(cache, dir, sub, 'chrome-headless-shell');
        if (existsSync(bin)) return bin;
      }
    }
  }
  for (const bin of ['/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    if (existsSync(bin)) return bin;
  }
  throw new Error('No Chromium found. Set CHROME_BIN.');
}

const chrome = findChrome();
const server = spawn(process.execPath, [path.join(root, 'bin', 'skipper.js'), '--demo', '--port', String(port)], { stdio: 'ignore' });
const base = `http://localhost:${port}`;

try {
  let sessions;
  for (let i = 0; i < 50 && !sessions; i++) {
    await new Promise((r) => setTimeout(r, 100));
    sessions = await fetch(`${base}/api/sessions`).then((r) => r.json()).then((d) => d.sessions).catch(() => null);
  }
  if (!sessions) throw new Error('Demo server did not start');
  const id = (title) => sessions.find((s) => s.title === title).id;

  const shots = [
    ['overview-dark', 1440, 900, 'dark', '#/'],
    ['session-light', 1440, 900, 'light', `#/s/${id('Checkout flow redesign')}`],
    ['tasks-paper', 1440, 900, 'paper', `#/s/${id('Migrate docs to the new theme')}`],
    ['loop-midnight', 1440, 900, 'midnight', `#/s/${id('offline-sync-loop')}`],
    ['usage-dark', 1440, 1000, 'dark', '#/usage'],
    ['mobile-overview', 390, 844, 'dark', '#/'],
    ['mobile-permission', 390, 844, 'light', `#/s/${id('Ship 4.2 to TestFlight')}`],
  ];
  mkdirSync(out, { recursive: true });
  for (const [name, w, h, theme, route] of shots) {
    const file = path.join(out, `${name}.png`);
    execFileSync(chrome, [
      '--headless', '--no-sandbox', '--hide-scrollbars', '--disable-gpu',
      `--window-size=${w},${h}`, '--force-device-scale-factor=2', '--virtual-time-budget=3000',
      `--user-data-dir=${path.join(os.tmpdir(), `skipper-shots-${name}`)}`,
      `--screenshot=${file}`, `${base}/?static&theme=${theme}${route}`,
    ], { stdio: 'ignore', timeout: 60_000 });
    console.log(`wrote docs/screenshots/${name}.png`);
  }
} finally {
  server.kill();
}
