import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchdPlist, systemdUnit, LABEL } from '../src/service.js';

test('launchd plist runs skipper at login and escapes paths', () => {
  const plist = launchdPlist({ nodePath: '/opt/node & co/bin/node', scriptPath: '/Users/me/skipper/bin/skipper.js', port: 5000, logDir: '/Users/me/Library/Logs/skipper' });
  assert.match(plist, new RegExp(`<string>${LABEL}</string>`));
  assert.match(plist, /<string>\/opt\/node &amp; co\/bin\/node<\/string>/);
  assert.match(plist, /<string>--port<\/string>\s*<string>5000<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.match(plist, /Logs\/skipper\/err\.log/);
});

test('systemd unit quotes paths with spaces', () => {
  const unit = systemdUnit({ nodePath: '/usr/bin/node', scriptPath: '/home/me/my tools/skipper/bin/skipper.js', port: 4317 });
  assert.match(unit, /^ExecStart=\/usr\/bin\/node "\/home\/me\/my tools\/skipper\/bin\/skipper\.js" --port 4317$/m);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /WantedBy=default\.target/);
});
