// Keeps Skipper running in the background: a launchd agent on macOS, a systemd
// user service on Linux and a Task Scheduler task on Windows. File contents are
// built by pure functions.

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
  <key>StandardOutPath</key><string>${xml(path.posix.join(logDir, 'out.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.posix.join(logDir, 'err.log'))}</string>
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

export const WINDOWS_TASK = 'Skipper';

// Windows command-line quoting for one argument (the rules CommandLineToArgvW follows).
function winQuote(arg) {
  const text = String(arg);
  if (text && !/[\s"]/.test(text)) return text;
  return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

// A Task Scheduler definition: start at logon, restart on failure, never time out.
// conhost --headless runs node without opening a console window.
export function windowsTaskXml({ nodePath, scriptPath, port, logDir, userId }) {
  const args = ['--headless', nodePath, scriptPath, '--port', String(port), '--log-dir', logDir].map(winQuote).join(' ');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Skipper dashboard for Claude Code</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>${xml(userId)}</UserId></LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>${xml(userId)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
    <Hidden>true</Hidden>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>conhost.exe</Command><Arguments>${xml(args)}</Arguments></Exec>
  </Actions>
</Task>
`;
}

export function schtasksArgs(action, xmlFile) {
  return {
    create: ['/Create', '/TN', WINDOWS_TASK, '/XML', xmlFile, '/F'],
    run: ['/Run', '/TN', WINDOWS_TASK],
    end: ['/End', '/TN', WINDOWS_TASK],
    delete: ['/Delete', '/TN', WINDOWS_TASK, '/F'],
    query: ['/Query', '/TN', WINDOWS_TASK, '/FO', 'CSV', '/NH'],
  }[action];
}

function paths(home = os.homedir()) {
  return {
    plist: path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`),
    logDir: path.join(home, 'Library', 'Logs', 'skipper'),
    unit: path.join(home, '.config', 'systemd', 'user', 'skipper.service'),
    windowsDir: path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'skipper'),
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
  if (platform === 'win32') {
    const logDir = path.join(p.windowsDir, 'logs');
    const file = path.join(p.windowsDir, 'skipper-task.xml');
    await fs.mkdir(logDir, { recursive: true });
    const userId = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${os.userInfo().username}` : os.userInfo().username;
    // schtasks reads task XML as UTF-16 with a byte order mark.
    await fs.writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(windowsTaskXml({ nodePath, scriptPath, port, logDir, userId }), 'utf16le')]));
    try {
      run('schtasks', schtasksArgs('end'));
    } catch {}
    run('schtasks', schtasksArgs('create', file));
    run('schtasks', schtasksArgs('run'));
    return { file, url: `http://localhost:${port}`, logs: logDir };
  }
  throw new Error('Background service setup supports macOS, Linux and Windows.');
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
  if (platform === 'win32') {
    try {
      run('schtasks', schtasksArgs('end'));
    } catch {}
    try {
      run('schtasks', schtasksArgs('delete'));
    } catch {
      return { removed: false };
    }
    await fs.rm(path.join(p.windowsDir, 'skipper-task.xml'), { force: true });
    return { removed: true };
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
  if (platform === 'win32') {
    try {
      return { installed: true, running: windowsTaskRunning(run('schtasks', schtasksArgs('query'))) };
    } catch {
      return { installed: false, running: false };
    }
  }
  return { installed: false, running: false };
}

// schtasks /Query /FO CSV /NH prints "\Skipper","next run","Status".
export function windowsTaskRunning(csv) {
  const status = String(csv).trim().split(/\r?\n/)[0]?.split(',').at(-1)?.replace(/"/g, '');
  return status === 'Running';
}
