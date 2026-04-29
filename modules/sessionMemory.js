import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SESSION_MEMORY = new Map();
const LOADED_KEYS = new Set();

function ensureLoaded(filePath) {
  if (LOADED_KEYS.has(filePath)) return;
  LOADED_KEYS.add(filePath);
  try {
    if (!existsSync(filePath)) return;
    const text = readFileSync(filePath, 'utf-8');
    if (!text.trim()) return;
    const json = JSON.parse(text);
    if (!json || typeof json !== 'object') return;
    for (const [key, value] of Object.entries(json)) {
      if (Array.isArray(value)) SESSION_MEMORY.set(key, value);
    }
  } catch {
    // ignore damaged file and continue with in-memory map
  }
}

function persist(filePath) {
  try {
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(Object.fromEntries(SESSION_MEMORY), null, 2), 'utf-8');
  } catch {
    // ignore persistence errors to avoid breaking main flow
  }
}

export function createSessionMemoryStore({
  memoryFile,
  maxTurns = 10,
} = {}) {
  const filePath = path.resolve(memoryFile || path.resolve(process.cwd(), 'data', 'session-memory.json'));
  ensureLoaded(filePath);

  function getHistory(sessionId) {
    if (!sessionId) return [];
    const rows = SESSION_MEMORY.get(sessionId);
    return Array.isArray(rows) ? rows : [];
  }

  function mergeHistory(sessionId, requestHistory = []) {
    if (Array.isArray(requestHistory) && requestHistory.length) return requestHistory;
    return getHistory(sessionId);
  }

  function appendTurn(sessionId, userContent, assistantContent) {
    if (!sessionId) return;
    const next = [
      ...getHistory(sessionId),
      { role: 'user', content: String(userContent || '') },
      { role: 'assistant', content: String(assistantContent || '') },
    ];
    SESSION_MEMORY.set(sessionId, next.slice(-maxTurns * 2));
    persist(filePath);
  }

  return {
    getHistory,
    mergeHistory,
    appendTurn,
  };
}
