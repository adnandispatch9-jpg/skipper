// Pairing the iPhone app: a skipper:// link with host, port and token, and a Bonjour
// advertisement so the app finds this Mac on the Wi-Fi by itself (macOS dns-sd, no dependency).

import os from 'node:os';
import { spawn } from 'node:child_process';

export function lanAddresses(interfaces = os.networkInterfaces()) {
  return Object.values(interfaces).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
}

export function pairingLink({ host, port, token, name = os.hostname().replace(/\.local$/, '') }) {
  const params = new URLSearchParams({ host, port: String(port), token, name });
  return `skipper://pair?${params}`;
}

/** Advertises _skipper._tcp while the server runs. Returns a function that stops it. */
export function advertise({ port, name = `Skipper on ${os.hostname().replace(/\.local$/, '')}`, platform = process.platform, spawnImpl = spawn }) {
  if (platform !== 'darwin') return () => {};
  try {
    const child = spawnImpl('dns-sd', ['-R', name, '_skipper._tcp', 'local', String(port)], { stdio: 'ignore' });
    child.on('error', () => {});
    return () => child.kill();
  } catch {
    return () => {};
  }
}

/** Puts text on the macOS clipboard; Universal Clipboard makes it pasteable on the iPhone. */
export function copyToClipboard(text, { platform = process.platform, spawnImpl = spawn } = {}) {
  if (platform !== 'darwin') return false;
  try {
    const child = spawnImpl('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => {});
    child.stdin.end(text);
    return true;
  } catch {
    return false;
  }
}
