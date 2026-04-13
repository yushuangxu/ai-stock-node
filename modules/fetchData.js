import { createTools } from '../tools/index.js';

function createToolMap() {
  const tools = createTools();
  return new Map(tools.map((tool) => [tool.name, tool]));
}

function toText(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function parseMarket(text) {
  const raw = String(text || '');
  const sentiment = raw.match(/大盘情绪:\s*(.+)/)?.[1]?.trim() ?? '未知';
  const timestamp = raw.match(/数据时间:\s*(.+)/)?.[1]?.trim() ?? '未知';
  return { timestamp, sentiment, raw };
}

function extractCodeFromSearchResult(text) {
  const match = String(text || '').match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}

async function callTool(toolMap, name, input = {}) {
  const tool = toolMap.get(name);
  if (!tool) throw new Error(`工具未注册: ${name}`);
  const output = await tool.invoke(input);
  return toText(output);
}

function dedupeActions(actions = []) {
  const seen = new Set();
  const out = [];
  for (const action of actions) {
    const key = `${action.stock_name}|${action.action}|${action.time || ''}|${action.price || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(action);
  }
  return out;
}

export async function fetchData(actions = []) {
  const toolMap = createToolMap();
  const normalizedActions = dedupeActions(actions);

  const marketRaw = await callTool(toolMap, 'get_market_overview', {});
  const market = parseMarket(marketRaw);

  const stocksData = [];
  for (const action of normalizedActions) {
    const stockName = String(action.stock_name || '').trim();
    if (!stockName) continue;

    let code = /^\d{6}$/.test(stockName) ? stockName : null;
    let searchRaw = null;

    if (!code) {
      searchRaw = await callTool(toolMap, 'search_stock_by_name', { keyword: stockName, limit: 5 });
      code = extractCodeFromSearchResult(searchRaw);
    }

    if (!code) {
      stocksData.push({
        action,
        stock_name: stockName,
        stock_code: null,
        error: '未能解析股票代码',
        search_raw: searchRaw,
      });
      continue;
    }

    const stockInfoRaw = await callTool(toolMap, 'get_stock_info', { code });
    const technicalsRaw = await callTool(toolMap, 'analyze_technicals', { code });
    const klineRaw = await callTool(toolMap, 'get_stock_kline', { code, days: 60 });

    stocksData.push({
      action,
      stock_name: stockName,
      stock_code: code,
      market_context: market.sentiment,
      stock_info_raw: stockInfoRaw,
      technicals_raw: technicalsRaw,
      kline_raw: klineRaw,
      ...(searchRaw ? { search_raw: searchRaw } : {}),
    });
  }

  return { market, stocksData };
}
