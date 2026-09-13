// Writes a realistic, entirely fictional ~/.claude tree so Skipper can be
// tried (and screenshotted) without exposing anyone's real sessions.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MIN = 60_000;

function uuid(seed) {
  const hex = crypto.createHash('sha1').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function builder(sessionId, cwd, branch, start) {
  const records = [];
  let t = start;
  let n = 0;
  const base = () => ({ sessionId, cwd, gitBranch: branch, version: '2.1.270', timestamp: new Date(t).toISOString(), uuid: uuid(`${sessionId}-${n++}`), isSidechain: false });
  const api = {
    records,
    at(ms) { t = ms; return api; },
    wait(ms) { t += ms; return api; },
    meta(record) { records.push({ ...record, sessionId }); return api; },
    prompt(text) { records.push({ ...base(), type: 'user', message: { role: 'user', content: text } }); return api; },
    say(text) { records.push({ ...base(), type: 'assistant', message: { id: `msg_${n}`, model: 'claude-opus-5', role: 'assistant', content: [{ type: 'text', text }], usage: usageFor(sessionId, n) } }); return api; },
    tool(name, input, id = `toolu_${uuid(`${sessionId}-${n}`).replace(/-/g, '').slice(0, 24)}`) {
      records.push({ ...base(), type: 'assistant', message: { id: `msg_${n}`, model: 'claude-opus-5', role: 'assistant', content: [{ type: 'tool_use', id, name, input }], usage: usageFor(sessionId, n) } });
      return id;
    },
    result(id, text = 'ok') { records.push({ ...base(), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } }); return api; },
    notify(id, status, result) {
      records.push({ ...base(), type: 'user', message: { role: 'user', content: `<task-notification>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n<result>${result}</result>\n</task-notification>` } });
      return api;
    },
    turnEnd() { records.push({ ...base(), type: 'system', subtype: 'turn_duration', durationMs: 42000 }); return api; },
  };
  return api;
}

function usageFor(seed, n) {
  const h = parseInt(crypto.createHash('sha1').update(`${seed}:${n}`).digest('hex').slice(0, 8), 16);
  return { input_tokens: 40 + (h % 400), cache_read_input_tokens: 20_000 + (h % 60_000), cache_creation_input_tokens: h % 3_000, output_tokens: 300 + (h % 4_500) };
}

const todos = (items) => ({ todos: items.map(([status, content, activeForm]) => ({ status, content, activeForm: activeForm || content })) });

export async function writeDemo(dir, { pid = process.pid, now = Date.now() } = {}) {
  await fs.rm(dir, { recursive: true, force: true });
  const home = '/Users/demo/code';
  const sessions = [];

  const save = async (project, id, b, extras = {}) => {
    const projectDir = path.join(dir, 'projects', `-Users-demo-code-${project}`);
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, `${id}.jsonl`), `${b.records.map((r) => JSON.stringify(r)).join('\n')}\n`);
    if (extras.subagents) {
      const sub = path.join(projectDir, id, 'subagents');
      await fs.mkdir(sub, { recursive: true });
      for (const [agentId, meta, activeAgo] of extras.subagents) {
        await fs.writeFile(path.join(sub, `agent-${agentId}.meta.json`), JSON.stringify(meta));
        const log = path.join(sub, `agent-${agentId}.jsonl`);
        const lines = Array.from({ length: 12 }, (_, i) => JSON.stringify({ isSidechain: true, type: 'assistant', timestamp: new Date(now - 30 * MIN + i * MIN).toISOString(), message: { id: `sub_${agentId}_${i}`, model: 'claude-sonnet-5', content: [], usage: usageFor(agentId, i) } }));
        await fs.writeFile(log, `${lines.join('\n')}\n`);
        const when = new Date(now - activeAgo);
        await fs.utimes(log, when, when);
      }
    }
    if (extras.workflows) {
      const wf = path.join(projectDir, id, 'workflows');
      await fs.mkdir(wf, { recursive: true });
      for (const run of extras.workflows) await fs.writeFile(path.join(wf, `${run.runId}.json`), JSON.stringify(run));
    }
    if (extras.live) sessions.push(id);
  };

  // 1. Working: checkout redesign with parallel subagents in worktrees.
  {
    const id = uuid('checkout');
    const b = builder(id, `${home}/storefront`, 'feat/checkout-v2', now - 52 * MIN);
    b.meta({ type: 'custom-title', customTitle: 'Checkout flow redesign' });
    b.meta({ type: 'permission-mode', permissionMode: 'auto' });
    b.prompt('Redesign the checkout flow per docs/checkout-v2.md. Split the work across subagents in worktrees and keep tests green.');
    b.wait(2 * MIN);
    b.tool('TodoWrite', todos([
      ['completed', 'Map current checkout state machine'],
      ['completed', 'Design new step layout and address form'],
      ['completed', 'Extract payment step into its own route'],
      ['in_progress', 'Wire Apple Pay and saved cards', 'Wiring Apple Pay and saved cards'],
      ['pending', 'Update Playwright checkout specs'],
      ['pending', 'Open PR with before/after screenshots'],
    ]));
    b.wait(8 * MIN);
    const a1 = b.tool('Agent', { description: 'Apple Pay integration', name: 'apple-pay', subagent_type: 'general-purpose', isolation: 'worktree', run_in_background: true, prompt: '…' });
    const a2 = b.tool('Agent', { description: 'Saved cards vault', name: 'saved-cards', subagent_type: 'general-purpose', isolation: 'worktree', run_in_background: true, prompt: '…' });
    const a3 = b.tool('Agent', { description: 'Audit address form accessibility', subagent_type: 'Explore', prompt: '…' });
    b.wait(6 * MIN).result(a3, 'Found 3 issues').notify(a3, 'completed', 'Address form: 3 labels missing, focus order fixed in AddressStep.tsx, error text now announced.');
    b.meta({ type: 'pr-link', prNumber: 418, prUrl: 'https://github.com/acme/storefront/pull/418', prRepository: 'acme/storefront', timestamp: new Date(now - 30 * MIN).toISOString() });
    b.at(now - 20_000).say("Both payment subagents are still running. Meanwhile I'm updating the payment step so the saved-cards list and the Apple Pay button share one PaymentMethod model.");
    b.tool('Edit', { file_path: 'src/checkout/PaymentStep.tsx' });
    await save('storefront', id, b, {
      live: true,
      subagents: [
        ['a1f0c2', { toolUseId: a1, name: 'apple-pay', description: 'Apple Pay integration', agentType: 'general-purpose', model: 'sonnet', worktreeBranch: 'worktree-apple-pay', requestShape: 'background' }, 40_000],
        ['b7d913', { toolUseId: a2, name: 'saved-cards', description: 'Saved cards vault', agentType: 'general-purpose', model: 'sonnet', worktreeBranch: 'worktree-saved-cards', requestShape: 'background' }, 15_000],
      ],
    });
  }

  // 2. Waiting on you: finished, asking a question.
  {
    const id = uuid('webhooks');
    const b = builder(id, `${home}/payments-api`, 'fix/webhook-retries', now - 38 * MIN);
    b.meta({ type: 'ai-title', aiTitle: 'Fix flaky webhook retries' });
    b.prompt('Webhook retries sometimes double-charge. Find out why and fix it with a regression test.');
    b.tool('TodoWrite', todos([
      ['completed', 'Reproduce the double delivery locally'],
      ['completed', 'Make retry handler idempotent on event id'],
      ['completed', 'Add regression test for concurrent retries'],
      ['completed', 'Run the full test suite'],
    ]));
    b.at(now - 7 * MIN).say('Fixed. The retry worker and the webhook endpoint could both claim the same event, so I added a unique constraint on `event_id` and an upsert in `RetryHandler`. All 214 tests pass, including the new concurrency test.\n\nShould I open a PR against `main`, or do you want to review the migration first?');
    b.turnEnd();
    b.meta({ type: 'cost-state', totalCostUSD: 3.84, totalLinesAdded: 186, totalLinesRemoved: 41 });
    await save('payments-api', id, b, { live: true });
  }

  // 3. Sleeping: a /loop between iterations, with a workflow run.
  {
    const id = uuid('offline');
    const b = builder(id, `${home}/field-app`, 'main', now - 5 * 60 * MIN);
    b.meta({ type: 'agent-name', agentName: 'offline-sync-loop' });
    b.prompt('/loop Ship offline sync for the field app, one vertical slice per iteration. Pull, pick the next slice from docs/offline-plan.md, build it test-first, push.');
    b.tool('TodoWrite', todos([
      ['completed', 'Local SQLite cache for jobs'],
      ['completed', 'Queue writes while offline'],
      ['completed', 'Replay queue on reconnect'],
      ['completed', 'Conflict banner for stale edits'],
      ['in_progress', 'Background sync with exponential backoff', 'Syncing in the background with backoff'],
      ['pending', 'Sync status indicator in header'],
      ['pending', 'Offline end-to-end test on device farm'],
    ]));
    const wf = b.tool('Workflow', { script: "export const meta = { name: 'conflict-audit', description: 'Verify every write path goes through the offline queue' }" });
    b.wait(12 * MIN).notify(wf, 'completed', 'All 23 write paths use the queue.');
    b.at(now - 3 * MIN).say('Slice 4 is pushed: stale edits now show a conflict banner with a "keep mine" option. Next up is background sync with backoff.');
    b.tool('ScheduleWakeup', { delaySeconds: 1080, reason: 'CI for slice 4 takes about 15 minutes; check it before starting background sync.', prompt: '/loop …' });
    b.turnEnd();
    b.meta({ type: 'frame-link', title: 'Offline sync plan', frameUrl: 'https://claude.ai/code/artifact/demo-offline-sync', timestamp: new Date(now - 90 * MIN).toISOString() });
    await save('field-app', id, b, {
      live: true,
      workflows: [{ runId: 'wf_demo-01', workflowName: 'conflict-audit', summary: 'Verify every write path goes through the offline queue', status: 'completed', startTime: now - 4 * 60 * MIN, durationMs: 11 * MIN, agentCount: 9, totalTokens: 412000, phases: [{ title: 'Find writes' }, { title: 'Verify' }] }],
    });
  }

  // 4. Working: docs migration with a team and task files.
  {
    const id = uuid('docs');
    const b = builder(id, `${home}/docs-site`, 'chore/new-theme', now - 25 * MIN);
    b.meta({ type: 'custom-title', customTitle: 'Migrate docs to the new theme' });
    b.prompt('Move the docs site to the new theme. Use a team: one teammate for components, one for content.');
    b.at(now - 9_000).say('The components teammate finished the callout and tabs shims. Content migration is at 61 of 140 pages.');
    b.tool('Bash', { command: 'npm run build' });
    await save('docs-site', id, b, { live: true });
    const tasks = path.join(dir, 'tasks', id);
    await fs.mkdir(tasks, { recursive: true });
    const t = [
      { id: '1', subject: 'Inventory custom MDX components', status: 'completed', owner: 'components' },
      { id: '2', subject: 'Build shims for callouts and tabs', status: 'completed', owner: 'components', blockedBy: ['1'] },
      { id: '3', subject: 'Migrate content pages', activeForm: 'Migrating page 61 of 140', status: 'in_progress', owner: 'content', blockedBy: ['2'] },
      { id: '4', subject: 'Fix broken internal links', status: 'pending', owner: 'content', blockedBy: ['3'] },
      { id: '5', subject: 'Visual diff against production', status: 'pending', blockedBy: ['3', '4'] },
    ];
    for (const task of t) await fs.writeFile(path.join(tasks, `${task.id}.json`), JSON.stringify(task));
    const team = path.join(dir, 'teams', 'docs-theme');
    await fs.mkdir(team, { recursive: true });
    await fs.writeFile(path.join(team, 'config.json'), JSON.stringify({
      name: 'docs-theme',
      leadSessionId: id,
      members: [{ name: 'team-lead', agentType: 'team-lead' }, { name: 'components', agentType: 'general-purpose' }, { name: 'content', agentType: 'general-purpose' }],
    }));
  }

  // 5. Needs permission: a Notification hook event with no activity after it.
  {
    const id = uuid('release-notes');
    const b = builder(id, `${home}/mobile-app`, 'release/4.2', now - 14 * MIN);
    b.meta({ type: 'custom-title', customTitle: 'Ship 4.2 to TestFlight' });
    b.prompt('Bump the version, build and upload 4.2 to TestFlight.');
    b.tool('TodoWrite', todos([
      ['completed', 'Bump version to 4.2.0'],
      ['completed', 'Run the release build'],
      ['in_progress', 'Upload to TestFlight', 'Uploading to TestFlight'],
    ]));
    b.at(now - 95_000).say('The release build passed. Uploading the archive with fastlane now.');
    b.tool('Bash', { command: 'bundle exec fastlane beta' });
    await save('mobile-app', id, b, { live: true });
    const events = path.join(dir, '.skipper');
    await fs.mkdir(events, { recursive: true });
    const demoEvents = [
      { at: now - 7 * MIN, sessionId: uuid('webhooks'), kind: 'done', message: null },
      { at: now - 3 * MIN + 2000, sessionId: uuid('offline'), kind: 'done', message: null },
      { at: now - 80_000, sessionId: id, kind: 'permission', message: 'Claude needs your permission to use Bash: bundle exec fastlane beta' },
    ];
    await fs.writeFile(path.join(events, 'events.jsonl'), demoEvents.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }

  // Ended sessions.
  const ended = [
    ['infra', 'pg16', 'Postgres 16 upgrade runbook', 'ops/pg16', 3 * 60 * MIN, 4.12, 'https://github.com/acme/infra/pull/77', 'acme/infra', 77],
    ['storefront', 'bundle', 'Audit bundle size', 'main', 22 * 60 * MIN, 1.37, null],
    ['cli', 'release', 'Release v2.3.0', 'release/2.3.0', 50 * 60 * MIN, 0.92, 'https://github.com/acme/cli/pull/203', 'acme/cli', 203],
    ['payments-api', 'openapi', 'Generate OpenAPI client for partners', 'main', 4 * 24 * 60 * MIN, 6.55, null],
  ];
  for (const [project, seed, title, branch, ago, cost, pr, repo, number] of ended) {
    const id = uuid(seed);
    const b = builder(id, `${home}/${project}`, branch, now - ago - 40 * MIN);
    b.meta({ type: 'custom-title', customTitle: title });
    b.prompt(title);
    b.at(now - ago).say(`Done: ${title.toLowerCase()}.`);
    b.turnEnd();
    b.meta({ type: 'cost-state', totalCostUSD: cost, totalLinesAdded: Math.round(cost * 90), totalLinesRemoved: Math.round(cost * 30) });
    if (pr) b.meta({ type: 'pr-link', prNumber: number, prUrl: pr, prRepository: repo });
    await save(project, id, b);
  }

  // Two weeks of finished work so the Usage page has history.
  const past = [
    ['storefront', 'Refactor checkout state machine', 13, 22, 'claude-opus-5'],
    ['payments-api', 'Retry queue load test', 12, 14, 'claude-sonnet-5'],
    ['field-app', 'Offline cache spike', 11, 18, 'claude-opus-5'],
    ['storefront', 'Product page performance pass', 10, 9, 'claude-sonnet-5'],
    ['docs-site', 'Docs theme audit', 8, 7, 'claude-haiku-4-5'],
    ['field-app', 'Sync conflict model', 6, 26, 'claude-opus-5'],
    ['payments-api', 'Refund webhooks', 5, 20, 'claude-opus-5'],
    ['storefront', 'Cart analytics events', 4, 24, 'claude-opus-5'],
    ['infra', 'Terraform state cleanup', 3, 12, 'claude-sonnet-5'],
    ['field-app', 'Background sync design', 2, 30, 'claude-opus-5'],
  ];
  for (const [project, title, daysAgo, responses, model] of past) {
    const id = uuid(`past-${title}`);
    const begin = now - daysAgo * 86_400_000;
    const b = builder(id, `${home}/${project}`, 'main', begin);
    b.meta({ type: 'custom-title', customTitle: title });
    b.prompt(title);
    for (let i = 0; i < responses; i++) {
      b.at(begin + i * 3 * MIN);
      b.records.push({ sessionId: id, cwd: `${home}/${project}`, gitBranch: 'main', timestamp: new Date(begin + i * 3 * MIN).toISOString(), type: 'assistant', isSidechain: false, message: { id: `past_${i}`, model, role: 'assistant', content: [{ type: 'text', text: `Step ${i + 1} done.` }], usage: usageFor(id, i) } });
    }
    b.turnEnd();
    await save(project, id, b);
  }

  await fs.mkdir(path.join(dir, 'sessions'), { recursive: true });
  for (const id of sessions) {
    await fs.writeFile(path.join(dir, 'sessions', `${id.slice(0, 8)}.json`), JSON.stringify({ pid, sessionId: id, kind: id === uuid('offline') ? 'bg' : 'interactive', entrypoint: 'cli', startedAt: now - 60 * MIN }));
  }
  return dir;
}
