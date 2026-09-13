// The readable conversation of a session: what you said, what Claude said, and
// which tools ran in between. Only the tail of the transcript is read, so long
// sessions stay cheap to open.

import { promises as fs } from 'node:fs';

const TEXT_LIMIT = 8000;
const TAIL_BYTES = 4 * 1024 * 1024;

const toMs = (timestamp) => {
  const ms = Date.parse(timestamp);
  return Number.isFinite(ms) ? ms : null;
};

const clip = (text) => (text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text);

function userText(content) {
  if (typeof content === 'string') return content.startsWith('<') ? null : content;
  if (!Array.isArray(content)) return null;
  const parts = content.filter((b) => b?.type === 'text' && typeof b.text === 'string' && !b.text.startsWith('<')).map((b) => b.text);
  return parts.length ? parts.join('\n\n') : null;
}

export function conversationFromRecords(records, { limit = 60 } = {}) {
  const items = [];
  const byResponse = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object' || record.isSidechain || record.isMeta) continue;
    const at = toMs(record.timestamp);
    const message = record.message || {};
    if (record.type === 'user') {
      const text = userText(message.content);
      if (text && text.trim()) items.push({ role: 'user', text: clip(text.trim()), at });
      continue;
    }
    if (record.type !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        const key = message.id || null;
        const existing = key && byResponse.get(key);
        if (existing && items[items.length - 1] === existing) {
          existing.text = clip(`${existing.text}\n\n${block.text.trim()}`);
        } else {
          const item = { role: 'assistant', text: clip(block.text.trim()), at };
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
  return items.slice(-limit);
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
    return { messages: conversationFromRecords(records, { limit }), truncated: start > 0 };
  } finally {
    await handle.close();
  }
}
