import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loopSleeping } from '../src/store.js';

const loop = { active: true, at: 1_000_000, delaySeconds: 120, wakeAt: 1_120_000 };

test('a loop sleeps until its wakeup, and stays asleep while the wakeup is a little late', () => {
  assert.equal(loopSleeping(loop, 900_000, 1_100_000), true);
  assert.equal(loopSleeping(loop, 900_000, 1_120_000 + 30_000), true, '30 s late is still sleeping');
  assert.equal(loopSleeping(loop, 900_000, 1_120_000 + 6 * 60_000), false, 'long overdue means it stopped');
});

test('long delays get a proportional grace period', () => {
  const hourly = { active: true, at: 0, delaySeconds: 3600, wakeAt: 3_600_000 };
  assert.equal(loopSleeping(hourly, null, 3_600_000 + 20 * 60_000), true);
  assert.equal(loopSleeping(hourly, null, 3_600_000 + 31 * 60_000), false);
});

test('a newer prompt or a stopped loop is not sleeping', () => {
  assert.equal(loopSleeping(loop, 1_050_000, 1_100_000), false);
  assert.equal(loopSleeping({ active: false, at: 0, wakeAt: null }, null, 0), false);
  assert.equal(loopSleeping(null, null, 0), false);
});

test('a refresh in progress never shows live sessions as ended', async () => {
  const { writeDemo } = await import('../src/demo.js');
  const { Store } = await import('../src/store.js');
  const os = await import('node:os');
  const path = await import('node:path');
  const { rmSync } = await import('node:fs');
  const dir = path.join(os.tmpdir(), `skipper-race-${process.pid}`);
  await writeDemo(dir);
  try {
    const store = new Store(dir);
    await store.refresh();
    const liveIds = store.list().filter((s) => s.state !== 'ended').map((s) => s.id);
    assert.ok(liveIds.length > 0);
    const running = store.refresh();
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setImmediate(r));
      const ended = store.list().filter((s) => liveIds.includes(s.id) && s.state === 'ended');
      assert.equal(ended.length, 0, `tick ${i}: ${ended.map((s) => s.title).join(', ')} shown as ended mid-refresh`);
    }
    await running;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a session file that briefly fails to parse keeps the session live', async () => {
  const { writeDemo } = await import('../src/demo.js');
  const { Store } = await import('../src/store.js');
  const os = await import('node:os');
  const path = await import('node:path');
  const { rmSync, readdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const dir = path.join(os.tmpdir(), `skipper-partial-${process.pid}`);
  await writeDemo(dir);
  try {
    const store = new Store(dir);
    await store.refresh();
    const before = store.list().filter((s) => s.state !== 'ended').length;
    const sessionsDir = path.join(dir, 'sessions');
    const file = path.join(sessionsDir, readdirSync(sessionsDir).find((f) => f.endsWith('.json')));
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, original.slice(0, 10)); // half-written
    await store.refresh();
    assert.equal(store.list().filter((s) => s.state !== 'ended').length, before);
    writeFileSync(file, original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a "needs your permission" notification right after a question is shown as a question', async () => {
  const { writeDemo } = await import('../src/demo.js');
  const { Store } = await import('../src/store.js');
  const os = await import('node:os');
  const path = await import('node:path');
  const { rmSync, appendFileSync, writeFileSync } = await import('node:fs');
  const dir = path.join(os.tmpdir(), `skipper-question-${process.pid}`);
  await writeDemo(dir);
  const events = path.join(dir, 'events.jsonl');
  writeFileSync(events, '');
  try {
    const store = new Store(dir, { eventsFile: events });
    await store.refresh();
    const target = store.list().find((s) => s.title === 'Fix flaky webhook retries');
    const [file] = [...store.files.entries()].find(([, e]) => e.summary.id === target.id);
    const now = Date.now();
    appendFileSync(file, `${JSON.stringify({ type: 'assistant', timestamp: new Date(now).toISOString(), message: { id: 'msg_q', content: [{ type: 'tool_use', id: 'toolu_q', name: 'AskUserQuestion', input: { questions: [] } }] } })}\n`);
    appendFileSync(events, `${JSON.stringify({ at: now + 500, sessionId: target.id, kind: 'permission', message: 'Claude needs your permission' })}\n`);
    await store.refresh();
    const s = store.list().find((x) => x.id === target.id);
    assert.equal(s.attention.kind, 'question');
    assert.equal(store.drainAlerts().find((a) => a.sessionId === target.id).kind, 'question');
    assert.ok(store.activity().some((i) => i.sessionId === target.id && i.kind === 'question'));
    assert.ok(!store.activity().some((i) => i.sessionId === target.id && i.kind === 'permission' && i.at === now + 500));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('activity survives hook events for sessions whose transcript is not read yet', async () => {
  const { writeDemo } = await import('../src/demo.js');
  const { Store } = await import('../src/store.js');
  const os = await import('node:os');
  const path = await import('node:path');
  const { rmSync, writeFileSync } = await import('node:fs');
  const dir = path.join(os.tmpdir(), `skipper-orphan-${process.pid}`);
  await writeDemo(dir);
  const events = path.join(dir, 'orphan-events.jsonl');
  const ghost = '99999999-8888-4777-8666-555555555555';
  writeFileSync(events, ['done', 'idle', 'permission'].map((kind, i) => JSON.stringify({ at: Date.now() - i, sessionId: ghost, kind, message: null })).join('\n') + '\n');
  try {
    const store = new Store(dir, { eventsFile: events });
    await store.refresh();
    const items = store.activity({ limit: 300 });
    assert.ok(items.some((i) => i.sessionId === ghost && i.kind === 'turn'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
