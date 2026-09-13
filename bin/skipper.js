#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { format } from 'node:util';
import { startServer, isLoopback } from '../src/server.js';
import { writeDemo } from '../src/demo.js';
import { recordHook, installHooks, uninstallHooks, hooksStatus, readConfig, writeConfig } from '../src/hooks.js';
import { installService, uninstallService, serviceStatus } from '../src/service.js';
import { checkNode, checkClaudeDir, checkHooks, checkEvents, checkNative, checkService, checkDashboard, formatReport } from '../src/doctor.js';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const HELP = `Skipper ${pkg.version}: a live dashboard for your Claude Code sessions

Usage: skipper [options]
       skipper hooks install    Get sound and desktop alerts for permission prompts
       skipper hooks uninstall  Remove Skipper's Claude Code hooks
       skipper hooks status
       skipper hooks native on|off  System notifications for permission prompts, even with no dashboard open
       skipper service install  Keep Skipper running in the background (macOS, Linux, Windows)
       skipper service uninstall
       skipper service status
       skipper doctor           Check that everything is set up and working

Options:
  -p, --port <n>         Port to listen on (default 4317, or $PORT)
      --host <addr>      Interface to bind (default 127.0.0.1)
                         Any non-loopback address turns on token access
      --claude-dir <dir> Claude Code data directory (default $CLAUDE_CONFIG_DIR or ~/.claude)
  -o, --open             Open the dashboard in your browser
      --demo             Serve fictional sample sessions (try it without Claude data)
      --read-only        Disable messages, notes and task edits
      --data-dir <dir>   Where Skipper keeps its own notes (default ~/.skipper)
      --log-dir <dir>    Append output to out.log and errors to err.log in <dir>
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
    else if (arg === '--log-dir') opts.logDir = value();
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

const argv = process.argv.slice(2);
const home = os.homedir();
const defaultDataDir = () => path.resolve(expandHome(process.env.SKIPPER_DATA_DIR ?? path.join(home, '.skipper')));
const defaultClaudeDir = () => path.resolve(expandHome(process.env.CLAUDE_CONFIG_DIR ?? path.join(home, '.claude')));

// Started by the voice agent's Claude Code process: serves Skipper's read-only tools over stdio.
if (argv[0] === 'mcp') {
  const { serveStdio } = await import('../src/mcp.js');
  serveStdio();
  await new Promise(() => {});
}

// Cloud voice for Uzbek (Azure AI Speech, free tier). The key is read from stdin so it never lands in shell history.
if (argv[0] === 'voice') {
  const { writeConfig, readConfig } = await import('../src/hooks.js');
  const dataDir = defaultDataDir();
  const sub = argv[1];
  if (sub === 'setup') {
    const regionIndex = argv.indexOf('--region');
    const region = regionIndex > 0 ? argv[regionIndex + 1] : null;
    if (!region || !/^[a-z0-9]+$/.test(region)) {
      console.error('Usage: skipper voice setup --region <azure-region>   (then paste the Speech key)');
      process.exit(1);
    }
    if (process.stdin.isTTY) process.stdout.write('Paste your Azure Speech key and press Enter: ');
    let key = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      key += chunk;
      if (key.includes('\n')) break;
    }
    key = key.trim();
    if (!/^[A-Za-z0-9]{20,100}$/.test(key)) {
      console.error('That does not look like an Azure Speech key.');
      process.exit(1);
    }
    const { synthesize } = await import('../src/speech.js');
    try {
      await synthesize({ key, region, voices: (await import('../src/speech.js')).VOICES }, 'Salom', { language: 'uz-UZ' });
    } catch (error) {
      console.error(`Azure rejected the key or region: ${error.message}`);
      process.exit(1);
    }
    await writeConfig(dataDir, { azureSpeech: { key, region } });
    console.log('Uzbek voice is on. Restart Skipper so the phone app picks it up.');
    process.exit(0);
  }
  if (sub === 'off') {
    await writeConfig(dataDir, { azureSpeech: null });
    console.log('Cloud voice is off.');
    process.exit(0);
  }
  const saved = (await readConfig(dataDir)).azureSpeech;
  console.log(saved ? `Cloud voice: on (Azure, region ${saved.region})` : 'Cloud voice: off. Run skipper voice setup --region <region> to turn on Uzbek voice.');
  process.exit(0);
}

// Called by Claude Code itself (see `skipper hooks install`): record and exit quickly.
if (argv[0] === 'hook') {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 65536) break;
  }
  await recordHook(input, defaultDataDir());
  process.exit(0);
}

// The node on PATH survives upgrades better than a versioned process.execPath.
function stableNode() {
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  return (process.env.PATH || '').split(path.delimiter).map((dir) => path.join(dir, name)).find((file) => existsSync(file)) || process.execPath;
}

if (argv[0] === 'doctor') {
  const claudeDir = defaultClaudeDir();
  const dataDir = defaultDataDir();
  const port = Number(process.env.PORT) || 4317;
  const checks = [
    checkNode(),
    await checkClaudeDir(claudeDir),
    await checkHooks(path.join(claudeDir, 'settings.json')),
    await checkEvents(dataDir),
    await checkNative(dataDir),
  ];
  const dashboard = await checkDashboard(port);
  checks.push(checkService({ dashboardUp: dashboard.ok }), dashboard);
  const { text, problems } = formatReport(checks);
  console.log(`\n  Skipper ${pkg.version} doctor\n\n${text}\n`);
  process.exit(problems ? 1 : 0);
}

if (argv[0] === 'service') {
  const action = argv[1] || 'status';
  const scriptPath = fileURLToPath(import.meta.url);
  try {
    if (action === 'install') {
      if (scriptPath.includes(`${path.sep}_npx${path.sep}`)) {
        fail('Install Skipper first so the service has a stable path:\n  npm install -g github:bilol-makhmudov/skipper\n  skipper service install');
      }
      const portIndex = argv.indexOf('--port');
      const port = portIndex > -1 ? Number(argv[portIndex + 1]) : 4317;
      if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Invalid --port');
      const result = await installService({ nodePath: stableNode(), scriptPath, port });
      // The first scan of a large history can take a few seconds; wait until it answers.
      let ready = false;
      for (let i = 0; i < 40 && !ready; i++) {
        await new Promise((r) => setTimeout(r, 250));
        ready = await fetch(`${result.url}/api/sessions`).then((r) => r.ok).catch(() => false);
      }
      console.log(`${ready ? 'Skipper is running in the background and starts at login.' : 'Skipper service installed, but it has not answered yet. Check the logs.'}\n  Open  ${result.url}\n  Logs  ${result.logs}\n  File  ${result.file}`);
    } else if (action === 'uninstall') {
      const { removed } = await uninstallService();
      console.log(removed ? 'Skipper background service removed.' : 'No Skipper background service was installed.');
    } else if (action === 'status') {
      const status = serviceStatus();
      console.log(!status.installed ? 'Not installed. Run: skipper service install' : status.running ? 'Installed and running.' : 'Installed but not running.');
    } else {
      fail(`Unknown service command: ${action}`);
    }
  } catch (error) {
    fail(error.message);
  }
  process.exit(0);
}

if (argv[0] === 'hooks') {
  const settingsFile = path.join(defaultClaudeDir(), 'settings.json');
  const action = argv[1] || 'status';
  try {
    if (action === 'install') {
      const scriptPath = fileURLToPath(import.meta.url);
      if (scriptPath.includes(`${path.sep}_npx${path.sep}`)) {
        console.warn('Note: you are running Skipper through npx, whose cache can be cleared.\nFor lasting hooks, install it: npm install -g github:bilol-makhmudov/skipper\n');
      }
      // Prefer the node on PATH: process.execPath can be a versioned path that an upgrade removes.
      await installHooks({ settingsFile, nodePath: stableNode(), scriptPath });
      console.log(`Installed Notification and Stop hooks in ${settingsFile}\nA backup was saved as settings.json.skipper-backup. New Claude Code sessions pick this up; restart open ones.`);
    } else if (action === 'uninstall') {
      const { removed } = await uninstallHooks({ settingsFile });
      console.log(removed ? `Removed Skipper hooks from ${settingsFile}` : 'No Skipper hooks were installed.');
    } else if (action === 'native') {
      const value = argv[2];
      if (value !== 'on' && value !== 'off') fail('Usage: skipper hooks native on|off');
      await writeConfig(defaultDataDir(), { nativeNotifications: value === 'on' });
      console.log(value === 'on' ? 'System notifications are on for permission prompts and questions.' : 'System notifications are off.');
    } else if (action === 'status') {
      const status = await hooksStatus({ settingsFile });
      const native = (await readConfig(defaultDataDir())).nativeNotifications;
      console.log(`${status.installed ? 'Skipper hooks are installed.' : 'Skipper hooks are not installed. Run: skipper hooks install'}\nSystem notifications: ${native ? 'on' : 'off (skipper hooks native on)'}`);
    } else {
      fail(`Unknown hooks command: ${action}`);
    }
  } catch (error) {
    fail(error.message);
  }
  process.exit(0);
}

const opts = parseArgs(argv);
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
if (opts.version) {
  console.log(pkg.version);
  process.exit(0);
}

// A background service has no terminal, so --log-dir sends output to files instead.
if (opts.logDir) {
  const dir = path.resolve(expandHome(opts.logDir));
  mkdirSync(dir, { recursive: true });
  // Synchronous appends, so a message written just before process.exit is never lost.
  const write = (file, text) => {
    try {
      appendFileSync(path.join(dir, file), text);
    } catch {}
  };
  console.log = (...args) => write('out.log', `${format(...args)}\n`);
  console.warn = console.error = (...args) => write('err.log', `${new Date().toISOString()} ${format(...args)}\n`);
  process.on('uncaughtException', (error) => {
    write('err.log', `${new Date().toISOString()} ${error.stack || error}\n`);
    process.exit(1);
  });
}

const port = Number(opts.port ?? process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`Invalid port: ${opts.port}`);
const host = opts.host ?? '127.0.0.1';
const claudeDir = opts.demo
  ? await writeDemo(path.join(os.tmpdir(), `skipper-demo-${process.pid}`))
  : opts.claudeDir ? path.resolve(expandHome(opts.claudeDir)) : defaultClaudeDir();

let app;
try {
  app = await startServer({
    claudeDir,
    dataDir: opts.demo ? path.join(claudeDir, '.skipper') : opts.dataDir ? path.resolve(expandHome(opts.dataDir)) : defaultDataDir(),
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
  const { lanAddresses, pairingLink, advertise, copyToClipboard } = await import('../src/pairing.js');
  const addresses = lanAddresses();
  for (const a of addresses) console.log(`  Open      http://${a}:${app.port}/?token=${app.accessToken}`);
  if (addresses.length) {
    const link = pairingLink({ host: addresses[0], port: app.port, token: app.accessToken });
    console.log(`\n  iPhone app: open Skipper on the phone, choose Enter the address manually and paste:\n  ${link}`);
    if (!opts.logDir && copyToClipboard(link)) console.log('  (copied to the clipboard; paste it on your iPhone)');
  }
  const stopAdvertising = advertise({ port: app.port });
  process.on('exit', stopAdvertising);
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
