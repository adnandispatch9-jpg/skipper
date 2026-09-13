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
