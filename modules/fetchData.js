import { createTools } from '../tools/index.js';

function createToolMap() {
  const tools = createTools();
  return new Map(tools.map((tool) => [tool.name, tool]));
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message || `工具调用超时(${ms}ms)`)), ms),
    ),
  ]);
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

function parseVolumeSignal(technicalsRaw) {
  const raw = String(technicalsRaw || '');
  const latestVolume =
    raw.match(/最新成交量:\s*([0-9.]+)/)?.[1] ?? null;
  const avgVol20 =
    raw.match(/20日均量:\s*([0-9.]+)/)?.[1] ?? null;
  const volRatio =
    raw.match(/量比\(今\/20日均\):\s*([0-9.]+)/)?.[1] ?? null;
  const signal =
    raw.match(/量比\(今\/20日均\):[^\n|]*\|\s*([^\n]+)/)?.[1]?.trim() ?? '未获取到';

  let trend = '平量';
  if (/放量/.test(signal)) trend = '放量';
  else if (/缩量/.test(signal)) trend = '缩量';

  return {
    latest_volume: latestVolume ? Number(latestVolume) : null,
    avg_volume_20d: avgVol20 ? Number(avgVol20) : null,
    volume_ratio: volRatio ? Number(volRatio) : null,
    signal,
    trend,
  };
}

async function callTool(toolMap, name, input = {}) {
  const tool = toolMap.get(name);
  if (!tool) throw new Error(`工具未注册: ${name}`);
  const output = await withTimeout(
    tool.invoke(input),
    25_000,
    `${name} 调用超时`,
  );
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

  const stocksData = await Promise.all(normalizedActions.map(async (action) => {
    const stockName = String(action.stock_name || '').trim();
    if (!stockName) return null;

    let code = /^\d{6}$/.test(stockName) ? stockName : null;
    let searchRaw = null;

    if (!code) {
      searchRaw = await callTool(toolMap, 'search_stock_by_name', { keyword: stockName, limit: 5 });
      code = extractCodeFromSearchResult(searchRaw);
    }

    if (!code) {
      return {
        action,
        stock_name: stockName,
        stock_code: null,
        error: '未能解析股票代码',
        search_raw: searchRaw,
      };
    }

    const [stockInfoRaw, technicalsRaw, klineRaw] = await Promise.all([
      callTool(toolMap, 'get_stock_info', { code }),
      callTool(toolMap, 'analyze_technicals', { code }),
      callTool(toolMap, 'get_stock_kline', { code, days: 60 }),
    ]);
    const volumeSignal = parseVolumeSignal(technicalsRaw);

    return {
      action,
      stock_name: stockName,
      stock_code: code,
      market_context: market.sentiment,
      stock_info_raw: stockInfoRaw,
      technicals_raw: technicalsRaw,
      kline_raw: klineRaw,
      volume_signal: volumeSignal,
      ...(searchRaw ? { search_raw: searchRaw } : {}),
    };
  }));

  return { market, stocksData: stocksData.filter(Boolean) };
}
