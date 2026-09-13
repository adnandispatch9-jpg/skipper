#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { startServer, isLoopback } from '../src/server.js';
import { writeDemo } from '../src/demo.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const HELP = `Skipper ${pkg.version}: a live dashboard for your Claude Code sessions

Usage: skipper [options]

Options:
  -p, --port <n>         Port to listen on (default 4317, or $PORT)
      --host <addr>      Interface to bind (default 127.0.0.1)
                         Any non-loopback address turns on token access
      --claude-dir <dir> Claude Code data directory (default $CLAUDE_CONFIG_DIR or ~/.claude)
  -o, --open             Open the dashboard in your browser
      --demo             Serve fictional sample sessions (try it without Claude data)
      --read-only        Disable messages, notes and task edits
      --data-dir <dir>   Where Skipper keeps its own notes (default ~/.skipper)
  -v, --version          Print the version
  -h, --help             Show this help
`;

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) fail(`${arg} needs a value`);
      return next;
    };
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '-v' || arg === '--version') opts.version = true;
    else if (arg === '-o' || arg === '--open') opts.open = true;
    else if (arg === '--demo') opts.demo = true;
    else if (arg === '--read-only') opts.readOnly = true;
    else if (arg === '--data-dir') opts.dataDir = value();
    else if (arg === '-p' || arg === '--port') opts.port = value();
    else if (arg === '--host') opts.host = value();
    else if (arg === '--claude-dir') opts.claudeDir = value();
    else fail(`Unknown option: ${arg}\n\n${HELP}`);
  }
  return opts;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function expandHome(dir) {
  return dir.startsWith('~') ? path.join(os.homedir(), dir.slice(1)) : dir;
}

function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
if (opts.version) {
  console.log(pkg.version);
  process.exit(0);
}

const port = Number(opts.port ?? process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`Invalid port: ${opts.port}`);
const host = opts.host ?? '127.0.0.1';
const claudeDir = opts.demo
  ? await writeDemo(path.join(os.tmpdir(), `skipper-demo-${process.pid}`))
  : path.resolve(expandHome(opts.claudeDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')));

let app;
try {
  app = await startServer({
    claudeDir,
    dataDir: opts.demo ? path.join(claudeDir, '.skipper') : path.resolve(expandHome(opts.dataDir ?? process.env.SKIPPER_DATA_DIR ?? path.join(os.homedir(), '.skipper'))),
    host,
    port,
    token: process.env.SKIPPER_TOKEN || null,
    readOnly: Boolean(opts.readOnly),
    claudeBin: opts.demo ? null : process.env.SKIPPER_CLAUDE_BIN || 'claude',
  });
} catch (error) {
  fail(error.code === 'EADDRINUSE' ? `Port ${port} is busy. Try: skipper --port ${port + 1}` : error.message);
}

const localUrl = `http://localhost:${app.port}`;
console.log(`\n  Skipper ${pkg.version}`);
console.log(opts.demo ? '  Demo mode: showing fictional sessions' : `  Reading   ${claudeDir}`);
if (isLoopback(host)) {
  console.log(`  Open      ${localUrl}\n`);
} else {
  console.log('  Network access is on. Anyone with this link can read your sessions:');
  const addresses = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal);
  for (const a of addresses) console.log(`  Open      http://${a.address}:${app.port}/?token=${app.accessToken}`);
  console.log('');
}
if (opts.open) openBrowser(isLoopback(host) ? localUrl : `http://127.0.0.1:${app.port}/?token=${app.accessToken}`);

const shutdown = async () => {
  await app.close();
  if (opts.demo) rmSync(claudeDir, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
