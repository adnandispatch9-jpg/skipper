import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSummary, applyRecord, sessionTitle } from '../src/transcript.js';

const ID = '11111111-2222-4333-8444-555555555555';
const at = (m) => new Date(Date.UTC(2026, 0, 1, 12, m)).toISOString();
const fold = (records) => {
  const s = createSummary(ID);
  for (const r of records) applyRecord(s, r);
  return s;
};
const tool = (name, input, id = `toolu_${name}`, m = 1) => ({
  type: 'assistant', timestamp: at(m), message: { model: 'claude-opus-5', content: [{ type: 'tool_use', id, name, input }] },
});

test('titles prefer custom title, then agent name, then ai title, then first prompt', () => {
  assert.equal(sessionTitle(fold([{ type: 'user', message: { content: 'hello there' } }])), 'hello there');
  assert.equal(sessionTitle(fold([{ type: 'ai-title', aiTitle: 'AI' }, { type: 'user', message: { content: 'x' } }])), 'AI');
  assert.equal(sessionTitle(fold([{ type: 'ai-title', aiTitle: 'AI' }, { type: 'custom-title', customTitle: 'Mine' }])), 'Mine');
  assert.equal(sessionTitle(createSummary(ID)), '11111111');
});

test('latest TodoWrite wins and unknown statuses are normalised', () => {
  const s = fold([
    tool('TodoWrite', { todos: [{ content: 'a', status: 'pending' }] }),
    tool('TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'weird', activeForm: 'Doing b' }] }, 't2', 2),
  ]);
  assert.deepEqual(s.todos.map((t) => t.status), ['completed', 'pending']);
  assert.equal(s.todos[1].activeForm, 'Doing b');
});

test('foreground agents complete on tool_result; background agents on task-notification', () => {
  const s = fold([
    tool('Agent', { description: 'fg', prompt: 'p' }, 'fg'),
    tool('Agent', { description: 'bg', prompt: 'p', run_in_background: true }, 'bg'),
    { type: 'user', timestamp: at(3), message: { content: [{ type: 'tool_result', tool_use_id: 'fg' }, { type: 'tool_result', tool_use_id: 'bg' }] } },
  ]);
  assert.equal(s.agents.get('fg').status, 'completed');
  assert.equal(s.agents.get('bg').status, 'running');
  applyRecord(s, { type: 'user', timestamp: at(4), message: { content: '<task-notification>\n<tool-use-id>bg</tool-use-id>\n<status>completed</status>\n<result>All good</result>\n</task-notification>' } });
  assert.equal(s.agents.get('bg').status, 'completed');
  assert.equal(s.agents.get('bg').result, 'All good');
});

test('ScheduleWakeup tracks the next wake time and stop ends the loop', () => {
  const s = fold([tool('ScheduleWakeup', { delaySeconds: 90, reason: 'wait for CI' }, 'w1', 5)]);
  assert.equal(s.loop.active, true);
  assert.equal(s.loop.wakeAt, Date.parse(at(5)) + 90_000);
  applyRecord(s, tool('ScheduleWakeup', { stop: true }, 'w2', 6));
  assert.equal(s.loop.active, false);
});

test('links must be https, and turn end is tracked', () => {
  const s = fold([
    { type: 'pr-link', prUrl: 'javascript:alert(1)', prNumber: 1 },
    { type: 'pr-link', prUrl: 'https://github.com/o/r/pull/2', prNumber: 2, prRepository: 'o/r' },
    { type: 'frame-link', frameUrl: 'http://insecure.example', title: 'x' },
    { type: 'system', subtype: 'turn_duration', timestamp: at(9) },
  ]);
  assert.deepEqual([...s.prs.keys()], ['https://github.com/o/r/pull/2']);
  assert.equal(s.artifacts.size, 0);
  assert.equal(s.lastKind, 'turn-end');
  assert.equal(s.turns, 1);
});

test('sidechain records are ignored and malformed records do not throw', () => {
  const s = fold([null, 42, { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'nope' }] } }]);
  assert.equal(s.lastText, null);
});

test('last tool records what it is working on', () => {
  const s = fold([tool('Edit', { file_path: 'src/checkout/PaymentStep.tsx', old_string: 'a' }, 'e1'), tool('Bash', { command: 'npm test\nnpm run lint' }, 'b1', 2)]);
  assert.deepEqual({ name: s.lastTool.name, target: s.lastTool.target }, { name: 'Bash', target: 'npm test' });
});

test('slash commands and loop wake-ups start a turn without replacing the typed prompt', () => {
  const s = fold([
    { type: 'user', timestamp: at(1), message: { content: 'Build the thing' } },
    { type: 'user', timestamp: at(30), message: { content: '<command-message>loop</command-message>\n<command-name>/loop</command-name>' } },
  ]);
  assert.equal(s.lastPrompt, 'Build the thing');
  assert.equal(s.lastPromptAt, Date.parse(at(30)));
});

test('the last tool is pending until its result arrives', () => {
  const s = fold([tool('Bash', { command: 'flutter test' }, 'b9')]);
  assert.equal(s.lastTool.pending, true);
  applyRecord(s, { type: 'user', timestamp: at(3), message: { content: [{ type: 'tool_result', tool_use_id: 'b9' }] } });
  assert.equal(s.lastTool.pending, false);
});
