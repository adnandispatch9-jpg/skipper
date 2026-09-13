import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { rmSync } from 'node:fs';
import { Store } from '../src/store.js';
import { startServer } from '../src/server.js';
import { writeDemo } from '../src/demo.js';

test('the page answers during a slow first scan and API calls wait for it', { timeout: 15000 }, async () => {
  const dir = path.join(os.tmpdir(), `skipper-startup-${process.pid}`);
  await writeDemo(dir);
  const original = Store.prototype.refresh;
  let first = true;
  Store.prototype.refresh = async function slowFirst(...args) {
    if (first) {
      first = false;
      await new Promise((r) => setTimeout(r, 600));
    }
    return original.apply(this, args);
  };
  const listening = new Promise((resolve) => {
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function patched(...args) {
      http.Server.prototype.listen = listen;
      this.once('listening', () => resolve(this.address().port));
      return listen.apply(this, args);
    };
  });
  const starting = startServer({ claudeDir: dir, dataDir: path.join(dir, '.skipper'), port: 0, log: () => {} });
  try {
    const port = await listening;
    const started = Date.now();
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.ok(Date.now() - started < 500, 'the page should not wait for the scan');
    const data = await (await fetch(`http://127.0.0.1:${port}/api/sessions`)).json();
    assert.ok(data.sessions.length > 0, 'API answered before the scan finished');
    const app = await starting;
    await app.close();
  } finally {
    Store.prototype.refresh = original;
    rmSync(dir, { recursive: true, force: true });
  }
});
