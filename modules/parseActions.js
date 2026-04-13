import { createMoonshotLlm } from '../agents/shared.js';

const ACTIONS = new Set(['buy', 'sell', 'hold', 'watch']);
const ACTION_MAP = new Map([
  ['买入', 'buy'],
  ['加仓', 'buy'],
  ['建仓', 'buy'],
  ['卖出', 'sell'],
  ['减仓', 'sell'],
  ['止盈', 'sell'],
  ['止损', 'sell'],
  ['持有', 'hold'],
  ['继续拿', 'hold'],
  ['观望', 'watch'],
  ['等待', 'watch'],
]);

function messageToText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('\n')
      .trim();
  }
  return String(content ?? '').trim();
}

function parseJsonSafe(text) {
  if (!text) return null;
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function normalizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const stock_name = String(item.stock_name ?? '').trim();
  if (!stock_name) return null;
  const rawAction = String(item.action ?? '').trim().toLowerCase();
  const action = ACTIONS.has(rawAction) ? rawAction : 'watch';
  const next = { stock_name, action };
  if (item.price != null && !Number.isNaN(Number(item.price))) next.price = Number(item.price);
  if (item.time != null && String(item.time).trim()) next.time = String(item.time).trim();
  if (item.reason != null && String(item.reason).trim()) next.reason = String(item.reason).trim();
  return next;
}

function fallbackParse(input) {
  const lines = String(input || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const actions = [];
  const priceRegex = /(?:￥|¥)?\s*(\d+(?:\.\d+)?)/;

  for (const line of lines) {
    let action = 'watch';
    for (const [word, mapped] of ACTION_MAP.entries()) {
      if (line.includes(word)) {
        action = mapped;
        break;
      }
    }

    const stockMatch = line.match(/([0-9]{6}|[\u4e00-\u9fa5A-Za-z]{2,20})/);
    if (!stockMatch) continue;
    const stock_name = stockMatch[1];
    const priceMatch = line.match(priceRegex);
    actions.push({
      stock_name,
      action,
      ...(priceMatch ? { price: Number(priceMatch[1]) } : {}),
      reason: line,
    });
  }

  return actions;
}

export async function parseActions(input) {
  const llm = createMoonshotLlm({ temperature: 0, maxTokens: 1200 });
  const prompt = `你是交易行为解析器。请从用户输入中提取交易动作，输出严格 JSON 数组，不要输出任何额外文字。

字段要求：
- stock_name: string
- action: "buy" | "sell" | "hold" | "watch"
- price?: number
- time?: string
- reason?: string

规则：
- 如果没有明确动作，使用 "watch"
- 不要臆造不存在的股票
- 输出必须可被 JSON.parse 解析

用户输入：
${input}`;

  try {
    const response = await llm.invoke(prompt);
    const parsed = parseJsonSafe(messageToText(response));
    if (Array.isArray(parsed)) {
      const normalized = parsed.map(normalizeItem).filter(Boolean);
      if (normalized.length) return normalized;
    }
  } catch {
    // fallback below
  }

  const fallback = fallbackParse(input);
  if (fallback.length) return fallback;

  return [];
}
