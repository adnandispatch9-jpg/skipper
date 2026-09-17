// The readable conversation of a session: what you said, what Claude said, and
// which tools ran in between. Only the tail of the transcript is read, so long
// sessions stay cheap to open.

import { promises as fs } from 'node:fs';

export const TEXT_LIMIT = 8000;
const TAIL_BYTES = 4 * 1024 * 1024;

const toMs = (timestamp) => {
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : null;
};

// Long messages are cut so one huge paste cannot dominate a response. Callers are
// told which ones were cut, so a reader can tell a short message from a shortened one.
const clip = (text) => (text.length > TEXT_LIMIT ? { text: text.slice(0, TEXT_LIMIT), clipped: true } : { text, clipped: false });

function userText(content) {
  if (typeof content === 'string') return content.startsWith('<') ? null : content;
  if (!Array.isArray(content)) return null;
  const parts = content.filter((b) => b?.type === 'text' && typeof b.text === 'string' && !b.text.startsWith('<')).map((b) => b.text);
  return parts.length ? parts.join('\n\n') : null;
}

export function buildConversation(records, { limit = 60 } = {}) {
  const items = [];
  const byResponse = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object' || record.isSidechain || record.isMeta) continue;
    const at = toMs(record.timestamp);
    const message = record.message || {};
    if (record.type === 'user') {
      const text = userText(message.content);
      if (text && text.trim()) items.push({ role: 'user', ...clip(text.trim()), at });
      continue;
    }
    if (record.type !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        const key = message.id || null;
        const existing = key && byResponse.get(key);
        if (existing && items[items.length - 1] === existing) {
          Object.assign(existing, clip(`${existing.text}\n\n${block.text.trim()}`));
        } else {
          const item = { role: 'assistant', ...clip(block.text.trim()), at };
          items.push(item);
          if (key) byResponse.set(key, item);
        }
      } else if (block?.type === 'tool_use' && typeof block.name === 'string') {
        const last = items[items.length - 1];
        if (last?.role === 'tools') {
          last.count += 1;
          if (!last.names.includes(block.name) && last.names.length < 6) last.names.push(block.name);
          last.at = at ?? last.at;
        } else {
          items.push({ role: 'tools', names: [block.name], count: 1, at });
        }
      }
    }
  }
  return { messages: items.slice(-limit), dropped: Math.max(0, items.length - limit) };
}

export function conversationFromRecords(records, options) {
  return buildConversation(records, options).messages;
}

export async function readConversation(file, { limit = 60, tailBytes = TAIL_BYTES } = {}) {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - tailBytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    let lines = buffer.toString('utf8').split('\n');
    if (start > 0) lines = lines.slice(1); // the first line is probably cut in half
    const records = [];
    for (const line of lines) {
      if (!line) continue;
      try {
        records.push(JSON.parse(line));
      } catch {}
    }
    const { messages, dropped } = buildConversation(records, { limit });
    return { messages, dropped, truncated: start > 0, textLimit: TEXT_LIMIT };
  } finally {
    await handle.close();
  }
}
