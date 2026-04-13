import { Buffer } from 'node:buffer';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': USER_AGENT,
  Referer: 'https://finance.sina.com.cn/',
  Accept: '*/*',
};

function getSinaSymbol(code) {
  if (code.startsWith('6') || code.startsWith('9') || code.startsWith('5')) {
    return `sh${code}`;
  }
  return `sz${code}`;
}

function safeNum(val) {
  if (val === null || val === undefined || val === '-' || val === '') return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
}

function formatCap(cap) {
  const n = safeNum(cap);
  if (n === null) return '未知';
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}万亿`;
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(2)}万`;
  return String(n);
}

async function fetchGBK(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const decoder = new TextDecoder('gbk');
  return decoder.decode(Buffer.from(buf));
}

/**
 * 获取股票历史日K线数据（新浪财经）
 */
export async function getKlineData(code, days = 120) {
  const symbol = getSinaSymbol(code);
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=${days}`;

  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data) || !data.length) {
    throw new Error(`无法获取股票 ${code} 的K线数据，请检查代码是否正确`);
  }

  const nameText = await fetchGBK(`https://hq.sinajs.cn/list=${symbol}`);
  const nameMatch = nameText.match(/="([^,]+),/);
  const name = nameMatch ? nameMatch[1] : code;

  return {
    code,
    name,
    klines: data.map((item) => {
      const close = +item.close;
      const prevIdx = data.indexOf(item) - 1;
      const prevClose = prevIdx >= 0 ? +data[prevIdx].close : close;
      const changePct = prevClose ? +((close - prevClose) / prevClose * 100).toFixed(2) : 0;

      return {
        date: item.day,
        open: +item.open,
        close,
        high: +item.high,
        low: +item.low,
        volume: +item.volume,
        amount: 0,
        amplitude: 0,
        changePct,
        change: +(close - prevClose).toFixed(2),
        turnover: 0,
      };
    }),
  };
}

/**
 * 获取股票基本面信息（腾讯财经）
 */
export async function getStockInfo(code) {
  const symbol = getSinaSymbol(code).replace('sh', 'sh').replace('sz', 'sz');
  const qtSymbol = code.startsWith('6') || code.startsWith('9') || code.startsWith('5')
    ? `sh${code}`
    : `sz${code}`;

  const text = await fetchGBK(`https://qt.gtimg.cn/q=${qtSymbol}`);
  const match = text.match(/="([^"]+)"/);
  if (!match) throw new Error(`无法获取股票 ${code} 的基本信息`);

  const fields = match[1].split('~');

  const name = fields[1] || '未知';
  const price = safeNum(fields[3]);
  const changePct = safeNum(fields[32]);
  const pe = safeNum(fields[39]);
  const pb = safeNum(fields[46]);
  const totalMarketCap = safeNum(fields[44]) != null ? safeNum(fields[44]) * 1e8 : null;
  const floatMarketCap = safeNum(fields[45]) != null ? safeNum(fields[45]) * 1e8 : null;
  const turnoverRate = safeNum(fields[38]);
  const volumeRatio = safeNum(fields[49]);
  const high = safeNum(fields[33]);
  const low = safeNum(fields[34]);
  const open = safeNum(fields[5]);
  const volume = safeNum(fields[36]);

  return {
    code,
    name,
    price,
    high,
    low,
    open,
    volume,
    amount: null,
    volumeRatio,
    eps: null,
    totalMarketCap,
    totalMarketCapStr: formatCap(totalMarketCap),
    floatMarketCap,
    floatMarketCapStr: formatCap(floatMarketCap),
    pe,
    pb,
    ps: null,
    turnoverRate,
    changePct,
    roe: null,
  };
}

const EASTMONEY_SUGGEST =
  'https://searchadapter.eastmoney.com/api/suggest/get';

/**
 * 按股票中文名、简称或拼音模糊搜索 A 股，返回 6 位代码候选（过滤港股/期货等非 6 位标的）。
 * 若 keyword 已是 6 位代码，则校验并返回证券简称。
 */
export async function searchStocksByKeyword(keyword, limit = 10) {
  const q = String(keyword ?? '').trim();
  if (!q) throw new Error('搜索关键词不能为空');

  if (/^\d{6}$/.test(q)) {
    try {
      const info = await getStockInfo(q);
      return [{ code: q, name: info.name, market: '' }];
    } catch {
      return [{ code: q, name: null, market: '', note: '代码校验失败，仍可尝试用于行情接口' }];
    }
  }

  const count = Math.min(Math.max(limit * 4, 12), 50);
  const url = `${EASTMONEY_SUGGEST}?input=${encodeURIComponent(q)}&type=14&count=${count}`;
  const res = await fetch(url, {
    headers: { ...HEADERS, Referer: 'https://www.eastmoney.com/' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  const rows = json?.QuotationCodeTable?.Data;
  if (!Array.isArray(rows) || !rows.length) return [];

  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const code = row.Code;
    if (!code || !/^\d{6}$/.test(String(code))) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({
      code,
      name: row.Name,
      market: row.SecurityTypeName || '',
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 获取A股大盘主要指数概览（新浪行情）
 */
export async function getMarketOverview() {
  const symbols = ['s_sh000001', 's_sz399001', 's_sz399006'];
  const url = `https://hq.sinajs.cn/list=${symbols.join(',')}`;
  const text = await fetchGBK(url);

  const parsed = [];
  const reg = /var hq_str_([^=]+)="([^"]*)";/g;
  let m;
  while ((m = reg.exec(text)) !== null) {
    const symbol = m[1];
    const parts = (m[2] || '').split(',');
    if (!parts.length || !parts[0]) continue;

    parsed.push({
      symbol,
      name: parts[0] || symbol,
      price: safeNum(parts[1]),
      change: safeNum(parts[2]),
      changePct: safeNum(parts[3]),
      volume: safeNum(parts[4]),
      amount: safeNum(parts[5]),
    });
  }

  const bySymbol = Object.fromEntries(parsed.map((row) => [row.symbol, row]));
  const ordered = symbols.map((symbol) => bySymbol[symbol]).filter(Boolean);

  if (!ordered.length) {
    throw new Error('无法获取大盘指数数据');
  }

  const avgChangePct =
    ordered.reduce((sum, row) => sum + (row.changePct ?? 0), 0) / ordered.length;
  const upCount = ordered.filter((row) => (row.changePct ?? 0) > 0).length;
  const downCount = ordered.filter((row) => (row.changePct ?? 0) < 0).length;

  let sentiment = '震荡';
  if (avgChangePct >= 0.8 && upCount >= 2) sentiment = '偏强';
  else if (avgChangePct <= -0.8 && downCount >= 2) sentiment = '偏弱';
  else if (upCount >= 2 && avgChangePct > 0) sentiment = '温和偏强';
  else if (downCount >= 2 && avgChangePct < 0) sentiment = '温和偏弱';

  return {
    timestamp: new Date().toISOString(),
    sentiment,
    indices: ordered,
  };
}
