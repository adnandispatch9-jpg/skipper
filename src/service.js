// Keeps Skipper running in the background: a launchd agent on macOS and a
// systemd user service on Linux. File contents are built by pure functions.

import { promises as fs, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const LABEL = 'dev.skipper';

const xml = (value) => String(value).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

export function launchdPlist({ nodePath, scriptPath, port, logDir }) {
  const args = [nodePath, scriptPath, '--port', String(port)].map((a) => `    <string>${xml(a)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(path.join(logDir, 'out.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logDir, 'err.log'))}</string>
</dict>
</plist>
`;
}

export function systemdUnit({ nodePath, scriptPath, port }) {
  const quote = (a) => (/[\s"\\]/.test(a) ? `"${a.replace(/(["\\])/g, '\\$1')}"` : a);
  return `[Unit]
Description=Skipper dashboard for Claude Code
After=network.target

[Service]
ExecStart=${[nodePath, scriptPath, '--port', String(port)].map(quote).join(' ')}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`;
}

function paths(home = os.homedir()) {
  return {
    plist: path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`),
    logDir: path.join(home, 'Library', 'Logs', 'skipper'),
    unit: path.join(home, '.config', 'systemd', 'user', 'skipper.service'),
  };
}

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' }).toString();

export async function installService({ nodePath, scriptPath, port = 4317, platform = process.platform }) {
  const p = paths();
  if (platform === 'darwin') {
    await fs.mkdir(path.dirname(p.plist), { recursive: true });
    await fs.mkdir(p.logDir, { recursive: true });
    const domain = `gui/${process.getuid()}`;
    try {
      run('launchctl', ['bootout', `${domain}/${LABEL}`]);
    } catch {}
    await fs.writeFile(p.plist, launchdPlist({ nodePath, scriptPath, port, logDir: p.logDir }));
    run('launchctl', ['bootstrap', domain, p.plist]);
    return { file: p.plist, url: `http://localhost:${port}`, logs: p.logDir };
  }
  if (platform === 'linux') {
    await fs.mkdir(path.dirname(p.unit), { recursive: true });
    await fs.writeFile(p.unit, systemdUnit({ nodePath, scriptPath, port }));
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'enable', '--now', 'skipper.service']);
    return { file: p.unit, url: `http://localhost:${port}`, logs: 'journalctl --user -u skipper' };
  }
  throw new Error('Background service setup supports macOS and Linux. On Windows, add `skipper` to Task Scheduler.');
}

export async function uninstallService({ platform = process.platform } = {}) {
  const p = paths();
  if (platform === 'darwin') {
    try {
      run('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`]);
    } catch {}
    const existed = existsSync(p.plist);
    await fs.rm(p.plist, { force: true });
    return { removed: existed };
  }
  if (platform === 'linux') {
    try {
      run('systemctl', ['--user', 'disable', '--now', 'skipper.service']);
    } catch {}
    const existed = existsSync(p.unit);
    await fs.rm(p.unit, { force: true });
    try {
      run('systemctl', ['--user', 'daemon-reload']);
    } catch {}
    return { removed: existed };
  }
  return { removed: false };
}

export function serviceStatus({ platform = process.platform } = {}) {
  const p = paths();
  if (platform === 'darwin') {
    if (!existsSync(p.plist)) return { installed: false, running: false };
    try {
      const out = run('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`]);
      return { installed: true, running: /state = running/.test(out) };
    } catch {
      return { installed: true, running: false };
    }
  }
  if (platform === 'linux') {
    if (!existsSync(p.unit)) return { installed: false, running: false };
    try {
      return { installed: true, running: run('systemctl', ['--user', 'is-active', 'skipper.service']).trim() === 'active' };
    } catch {
      return { installed: true, running: false };
    }
  }
  return { installed: false, running: false };
}
