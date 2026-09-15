import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchdPlist, systemdUnit, LABEL, windowsTaskXml, schtasksArgs, windowsTaskRunning, WINDOWS_TASK } from '../src/service.js';

test('launchd plist runs skipper at login and escapes paths', () => {
  const plist = launchdPlist({ nodePath: '/opt/node & co/bin/node', scriptPath: '/Users/me/skipper/bin/skipper.js', port: 5000, logDir: '/Users/me/Library/Logs/skipper' });
  assert.match(plist, new RegExp(`<string>${LABEL}</string>`));
  assert.match(plist, /<string>\/opt\/node &amp; co\/bin\/node<\/string>/);
  assert.match(plist, /<string>--port<\/string>\s*<string>5000<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  // Not throttled like background work: local voice recognition runs on the CPU and GPU.
  assert.match(plist, /<key>ProcessType<\/key><string>Interactive<\/string>/);
  assert.match(plist, /Logs\/skipper\/err\.log/);
});

test('systemd unit quotes paths with spaces', () => {
  const unit = systemdUnit({ nodePath: '/usr/bin/node', scriptPath: '/home/me/my tools/skipper/bin/skipper.js', port: 4317 });
  assert.match(unit, /^ExecStart=\/usr\/bin\/node "\/home\/me\/my tools\/skipper\/bin\/skipper\.js" --port 4317$/m);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /WantedBy=default\.target/);
});

test('Windows task starts at logon, restarts on failure and quotes paths', () => {
  const task = windowsTaskXml({ nodePath: 'C:\\Program Files\\nodejs\\node.exe', scriptPath: 'C:\\Users\\me & co\\skipper\\bin\\skipper.js', port: 5000, logDir: 'C:\\Users\\me\\AppData\\Local\\skipper\\logs', userId: 'PC\\me' });
  assert.match(task, /<LogonTrigger><Enabled>true<\/Enabled><UserId>PC\\me<\/UserId><\/LogonTrigger>/);
  assert.match(task, /<RestartOnFailure><Interval>PT1M<\/Interval><Count>999<\/Count><\/RestartOnFailure>/);
  assert.match(task, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
  assert.match(task, /<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(task, /<Command>conhost\.exe<\/Command>/);
  const args = task.match(/<Arguments>(.*)<\/Arguments>/)[1];
  assert.equal(args, '--headless &quot;C:\\Program Files\\nodejs\\node.exe&quot; &quot;C:\\Users\\me &amp; co\\skipper\\bin\\skipper.js&quot; --port 5000 --log-dir C:\\Users\\me\\AppData\\Local\\skipper\\logs');
});

test('schtasks commands target the Skipper task and status reads the CSV row', () => {
  assert.deepEqual(schtasksArgs('create', 'C:\\t.xml'), ['/Create', '/TN', WINDOWS_TASK, '/XML', 'C:\\t.xml', '/F']);
  assert.deepEqual(schtasksArgs('delete'), ['/Delete', '/TN', WINDOWS_TASK, '/F']);
  assert.equal(windowsTaskRunning('"\\Skipper","N/A","Running"\r\n'), true);
  assert.equal(windowsTaskRunning('"\\Skipper","9/14/2026 9:00:00 AM","Ready"\r\n'), false);
});

test('services can listen on the network for the iPhone app', () => {
  const plist = launchdPlist({ nodePath: '/usr/local/bin/node', scriptPath: '/opt/skipper/bin/skipper.js', port: 4317, logDir: '/tmp/logs', host: '0.0.0.0' });
  assert.match(plist, /<string>--port<\/string>\s*<string>4317<\/string>\s*<string>--host<\/string>\s*<string>0\.0\.0\.0<\/string>/);
  assert.doesNotMatch(launchdPlist({ nodePath: 'n', scriptPath: 's', port: 1, logDir: '/l' }), /--host/);
  assert.match(systemdUnit({ nodePath: '/usr/bin/node', scriptPath: '/s.js', port: 4317, host: '0.0.0.0' }), /ExecStart=\/usr\/bin\/node \/s\.js --port 4317 --host 0\.0\.0\.0/);
});
