import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync, writeFileSync, chmodSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { eventsFromLine, promptWithHistory, agentArgs } from '../src/agent.js';
import { handleRpc, createToolRunner, TOOLS } from '../src/mcp.js';
import { conversationFromRecords } from '../src/conversation.js';
import { startServer } from '../src/server.js';
import { writeDemo } from '../src/demo.js';

const ID = '11111111-2222-4333-8444-555555555555';

test('stream-json lines become text deltas, tool statuses, proposals and a result', () => {
  assert.deepEqual(eventsFromLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } })), [{ type: 'delta', text: 'Hi' }]);
  assert.deepEqual(eventsFromLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'x' } } })), []);
  const tool = eventsFromLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__skipper__propose_message', input: { session_id: ID, text: 'Open the PR' } }] } }));
  assert.deepEqual(tool, [{ type: 'status', text: 'Preparing a message' }, { type: 'proposal', sessionId: ID, text: 'Open the PR' }]);
  assert.deepEqual(eventsFromLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } })), []);
  assert.deepEqual(eventsFromLine(JSON.stringify({ type: 'result', result: 'Done', is_error: false })), [{ type: 'result', text: 'Done', error: null }]);
  assert.deepEqual(eventsFromLine('not json'), []);
});

test('the agent runs with only Skipper tools, no settings and no saved session', () => {
  const args = agentArgs({ mcpConfig: { mcpServers: {} }, model: 'haiku' });
  for (const flag of ['--strict-mcp-config', '--no-session-persistence', '--include-partial-messages']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  assert.ok(args[args.indexOf('--allowedTools') + 1].split(',').every((t) => t.startsWith('mcp__skipper__')));
  assert.equal(args[args.indexOf('--model') + 1], 'haiku');
});

test('follow-up questions carry the earlier turns', () => {
  assert.equal(promptWithHistory([], 'Hi'), 'Hi');
  const prompt = promptWithHistory([{ role: 'user', text: 'What is docs doing?' }, { role: 'assistant', text: 'Page 61.' }], 'And the other one?');
  assert.match(prompt, /User: What is docs doing\?\nYou: Page 61\./);
  assert.match(prompt, /The user now says: And the other one\?$/);
});

test('MCP server answers initialize, lists tools and reports tool errors', async () => {
  const init = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, null);
  assert.equal(init.result.serverInfo.name, 'skipper');
  assert.equal((await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, null)).result.tools.length, TOOLS.length);
  assert.equal(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, null), null);
  const run = createToolRunner({ baseUrl: 'http://127.0.0.1:1', agentKey: 'k', fetchImpl: async () => ({ ok: false, status: 500 }) });
  const failed = await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_session', arguments: { session_id: '../etc' } } }, run);
  assert.equal(failed.result.isError, true);
});

test('tools read Skipper with the agent key and keep session lists compact', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, key: init.headers['X-Skipper-Agent-Key'] });
    return { ok: true, json: async () => ({ now: 1, sessions: [{ id: ID, title: 'A', state: 'working', secretField: 'x' }] }) };
  };
  const run = createToolRunner({ baseUrl: 'http://127.0.0.1:9', agentKey: 'key-1', fetchImpl });
  const result = await run('list_sessions');
  assert.equal(calls[0].url, 'http://127.0.0.1:9/api/sessions');
  assert.equal(calls[0].key, 'key-1');
  assert.equal(result.sessions[0].secretField, undefined);
  await run('get_activity', { limit: 9999 });
  assert.match(calls[1].url, /limit=150$/);
});

test('conversation keeps what was said and folds tool runs together', () => {
  const at = (m) => new Date(Date.UTC(2026, 0, 1, 12, m)).toISOString();
  const items = conversationFromRecords([
    { type: 'user', timestamp: at(1), message: { content: 'Find the bug' } },
    { type: 'user', timestamp: at(1), isMeta: true, message: { content: 'meta' } },
    { type: 'user', timestamp: at(1), message: { content: [{ type: 'text', text: '<command-message>loop</command-message>' }] } },
    { type: 'assistant', timestamp: at(2), message: { id: 'm1', content: [{ type: 'tool_use', name: 'Grep', input: {} }] } },
    { type: 'user', timestamp: at(2), message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } },
    { type: 'assistant', timestamp: at(3), message: { id: 'm2', content: [{ type: 'tool_use', name: 'Read', input: {} }] } },
    { type: 'assistant', timestamp: at(3), message: { id: 'm2', content: [{ type: 'tool_use', name: 'Read', input: {} }] } },
    { type: 'assistant', timestamp: at(4), message: { id: 'm3', content: [{ type: 'text', text: 'Found it.' }] } },
    { type: 'assistant', timestamp: at(4), message: { id: 'm3', content: [{ type: 'text', text: 'Fixed.' }] } },
    { type: 'assistant', timestamp: at(5), isSidechain: true, message: { id: 'm4', content: [{ type: 'text', text: 'subagent' }] } },
  ]);
  assert.deepEqual(items.map((i) => i.role), ['user', 'tools', 'assistant']);
  assert.deepEqual(items[1].names, ['Grep', 'Read']);
  assert.equal(items[1].count, 3);
  assert.equal(items[2].text, 'Found it.\n\nFixed.');
});

async function readEvents(res) {
  const text = await res.text();
  return text.split('\n\n').filter(Boolean).map((block) => ({ type: /event: (\w+)/.exec(block)?.[1], data: JSON.parse(block.split('data: ')[1] || '{}') }));
}

test('ask streams the answer; a proposal is sent only after confirmation', { skip: process.platform === 'win32' && 'needs a POSIX executable' }, async () => {
  const dir = path.join(os.tmpdir(), `skipper-agent-${process.pid}`);
  await writeDemo(dir);
  const log = path.join(dir, 'calls.jsonl');
  const bin = path.join(dir, 'fake-claude.js');
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv }) + '\\n');
if (argv[0] === '-p') {
  const prompt = argv[argv.length - 1];
  const target = process.env.FAKE_TARGET;
  const out = (o) => console.log(JSON.stringify(o));
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__skipper__list_sessions', input: {} }] } });
  if (/tell/i.test(prompt)) out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__skipper__propose_message', input: { session_id: target, text: 'Open the PR' } }] } });
  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'All ' } } });
  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'good.' } } });
  out({ type: 'result', result: 'All good.', is_error: false });
} else {
  console.log('Started background session ab12cd');
}
`);
  chmodSync(bin, 0o755);
  const app = await startServer({ claudeDir: dir, dataDir: path.join(dir, '.skipper'), port: 0, claudeBin: bin, log: () => {} });
  const url = `http://127.0.0.1:${app.port}`;
  const post = (p, body) => fetch(`${url}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-skipper': '1' }, body: JSON.stringify(body) });
  try {
    const { sessions } = await (await fetch(`${url}/api/sessions`)).json();
    const target = sessions.find((s) => s.title === 'Fix flaky webhook retries');
    process.env.FAKE_TARGET = target.id;
    for (const entry of app.store.files.values()) if (entry.summary.id === target.id) mkdirSync(entry.summary.cwd = path.join(dir, 'work'), { recursive: true });

    assert.equal((await fetch(`${url}/api/agent/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"text":"hi"}' })).status, 403);
    assert.equal((await post('/api/agent/ask', { text: '' })).status, 400);

    const first = await readEvents(await post('/api/agent/ask', { text: 'What is going on?' }));
    const conversation = first.find((e) => e.type === 'conversation').data.id;
    assert.deepEqual(first.filter((e) => e.type === 'delta').map((e) => e.data.text).join(''), 'All good.');
    assert.equal(first.find((e) => e.type === 'status').data.text, 'Looking at your sessions');
    assert.equal(first.at(-1).type, 'done');

    const second = await readEvents(await post('/api/agent/ask', { text: 'Tell the webhook one to open the PR', conversationId: conversation }));
    const proposal = second.find((e) => e.type === 'proposal').data;
    assert.equal(proposal.sessionId, target.id);
    const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(calls.filter((c) => c.argv[0] === '--bg').length, 0, 'nothing sent before confirmation');
    assert.match(calls[1].argv.at(-1), /User: What is going on\?\nYou: All good\./, 'follow-up includes history');

    assert.equal((await post('/api/agent/confirm', { proposalId: 'nope' })).status, 404);
    const confirmed = await post('/api/agent/confirm', { proposalId: proposal.id });
    assert.equal(confirmed.status, 200);
    const sent = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((c) => c.argv[0] === '--bg');
    assert.deepEqual(sent.argv, ['--bg', '--resume', target.id, '--', 'Open the PR']);
    assert.equal((await post('/api/agent/confirm', { proposalId: proposal.id })).status, 404, 'a proposal is used once');

    const convo = await (await fetch(`${url}/api/sessions/${target.id}/conversation?limit=5`)).json();
    assert.ok(Array.isArray(convo.messages) && convo.messages.length > 0);
    assert.equal((await fetch(`${url}/api/sessions/${target.id.replace(/.$/, '0')}/conversation`)).status, 404);
  } finally {
    delete process.env.FAKE_TARGET;
    await app.close();
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

test('phones authenticate with a bearer token; the agent key only works from loopback GETs', async () => {
  const dir = path.join(os.tmpdir(), `skipper-bearer-${process.pid}`);
  await writeDemo(dir);
  const remote = await startServer({ claudeDir: dir, dataDir: path.join(dir, '.skipper'), host: '0.0.0.0', port: 0, token: 'phone-token', log: () => {} });
  const url = `http://127.0.0.1:${remote.port}`;
  try {
    assert.equal((await fetch(`${url}/api/info`)).status, 401);
    assert.equal((await fetch(`${url}/api/info`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
    const info = await fetch(`${url}/api/info`, { headers: { authorization: 'Bearer phone-token' } });
    assert.equal(info.status, 200);
    assert.equal(typeof (await info.json()).name, 'string');
    assert.equal((await fetch(`${url}/api/sessions`, { headers: { 'x-skipper-agent-key': 'guess' } })).status, 401);
  } finally {
    await remote.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
