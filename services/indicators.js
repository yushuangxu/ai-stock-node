import technicalindicators from 'technicalindicators';

const { SMA, MACD, RSI, BollingerBands, Stochastic } = technicalindicators;

function r(v, decimals = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '数据不足';
  return Number(v.toFixed(decimals));
}

export function calculateIndicators(klines) {
  const closes = klines.map((k) => k.close);
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  const volumes = klines.map((k) => k.volume);
  const latestClose = closes[closes.length - 1];

  const ma5 = SMA.calculate({ period: 5, values: closes });
  const ma10 = SMA.calculate({ period: 10, values: closes });
  const ma20 = SMA.calculate({ period: 20, values: closes });
  const ma60 = SMA.calculate({ period: 60, values: closes });

  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });

  const rsi6 = RSI.calculate({ period: 6, values: closes });
  const rsi12 = RSI.calculate({ period: 12, values: closes });
  const rsi24 = RSI.calculate({ period: 24, values: closes });

  const kdj = Stochastic.calculate({
    high: highs,
    low: lows,
    close: closes,
    period: 9,
    signalPeriod: 3,
  });

  const boll = BollingerBands.calculate({
    period: 20,
    values: closes,
    stdDev: 2,
  });

  const lMA5 = ma5[ma5.length - 1];
  const lMA10 = ma10[ma10.length - 1];
  const lMA20 = ma20[ma20.length - 1];
  const lMA60 = ma60.length > 0 ? ma60[ma60.length - 1] : null;

  let maAlignment = '交叉排列（趋势不明朗）';
  if (lMA5 && lMA10 && lMA20) {
    if (lMA5 > lMA10 && lMA10 > lMA20) maAlignment = '多头排列（短期均线在上，看涨信号）';
    else if (lMA5 < lMA10 && lMA10 < lMA20) maAlignment = '空头排列（短期均线在下，看跌信号）';
  }

  const lMACD = macd[macd.length - 1];
  const pMACD = macd.length > 1 ? macd[macd.length - 2] : null;
  let macdSignal = '无法判断';
  if (lMACD && pMACD) {
    const cur = lMACD.histogram;
    const prev = pMACD.histogram;
    if (cur > 0 && prev <= 0) macdSignal = 'MACD柱由负转正，刚形成金叉（买入信号）';
    else if (cur < 0 && prev >= 0) macdSignal = 'MACD柱由正转负，刚形成死叉（卖出信号）';
    else if (lMACD.MACD > 0 && cur > 0) macdSignal = 'DIF在零轴上方，MACD柱为正（多头趋势）';
    else if (lMACD.MACD < 0 && cur < 0) macdSignal = 'DIF在零轴下方，MACD柱为负（空头趋势）';
    else if (lMACD.MACD > 0) macdSignal = 'DIF在零轴上方运行（偏多）';
    else macdSignal = 'DIF在零轴下方运行（偏空）';
  }

  const lRSI6 = rsi6[rsi6.length - 1];
  const lRSI12 = rsi12[rsi12.length - 1];
  const lRSI24 = rsi24[rsi24.length - 1];
  let rsiSignal = '中性';
  if (lRSI6 !== undefined) {
    if (lRSI6 > 80) rsiSignal = '超买区间（>80），短期可能回调';
    else if (lRSI6 > 60) rsiSignal = '偏强区间（60-80）';
    else if (lRSI6 > 40) rsiSignal = '中性区间（40-60）';
    else if (lRSI6 > 20) rsiSignal = '偏弱区间（20-40）';
    else rsiSignal = '超卖区间（<20），短期可能反弹';
  }

  const lKDJ = kdj[kdj.length - 1];
  const pKDJ = kdj.length > 1 ? kdj[kdj.length - 2] : null;
  let jValue = null;
  let kdjSignal = '无法判断';
  if (lKDJ) {
    jValue = 3 * lKDJ.k - 2 * lKDJ.d;
    if (lKDJ.k > 80 && lKDJ.d > 80) kdjSignal = 'KDJ高位运行（超买区域），注意回调风险';
    else if (lKDJ.k < 20 && lKDJ.d < 20) kdjSignal = 'KDJ低位运行（超卖区域），可能迎来反弹';
    else if (pKDJ && lKDJ.k > lKDJ.d && pKDJ.k <= pKDJ.d) kdjSignal = 'KDJ金叉（买入信号）';
    else if (pKDJ && lKDJ.k < lKDJ.d && pKDJ.k >= pKDJ.d) kdjSignal = 'KDJ死叉（卖出信号）';
    else kdjSignal = 'KDJ中位运行';
  }

  const lBoll = boll[boll.length - 1];
  let bollSignal = '无法判断';
  if (lBoll) {
    if (latestClose > lBoll.upper) bollSignal = '价格突破布林上轨（强势突破或超买）';
    else if (latestClose < lBoll.lower) bollSignal = '价格跌破布林下轨（弱势破位或超卖）';
    else if (latestClose > lBoll.middle) bollSignal = '价格在中轨上方运行（偏强）';
    else bollSignal = '价格在中轨下方运行（偏弱）';
  }

  const avgVol20 =
    volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);
  const latestVol = volumes[volumes.length - 1];
  const volRatio = avgVol20 > 0 ? latestVol / avgVol20 : 1;
  let volSignal = '成交量正常';
  if (volRatio > 2) volSignal = '显著放量（关注异动）';
  else if (volRatio > 1.5) volSignal = '温和放量';
  else if (volRatio < 0.5) volSignal = '明显缩量';
  else if (volRatio < 0.7) volSignal = '轻度缩量';

  return `
=== 技术指标分析结果 ===

【当前收盘价】${latestClose}

【均线系统 MA】
MA5: ${r(lMA5)} | MA10: ${r(lMA10)} | MA20: ${r(lMA20)} | MA60: ${r(lMA60)}
均线排列: ${maAlignment}
价格 vs MA5: ${lMA5 ? (latestClose > lMA5 ? '在MA5上方' : '在MA5下方') : '数据不足'}
价格 vs MA20: ${lMA20 ? (latestClose > lMA20 ? '在MA20上方' : '在MA20下方') : '数据不足'}

【MACD指标】
DIF: ${r(lMACD?.MACD)} | DEA: ${r(lMACD?.signal)} | MACD柱: ${r(lMACD?.histogram)}
信号: ${macdSignal}

【RSI指标】
RSI(6): ${r(lRSI6)} | RSI(12): ${r(lRSI12)} | RSI(24): ${r(lRSI24)}
判断: ${rsiSignal}

【KDJ指标】
K: ${r(lKDJ?.k)} | D: ${r(lKDJ?.d)} | J: ${r(jValue)}
信号: ${kdjSignal}

【布林带 BOLL(20,2)】
上轨: ${r(lBoll?.upper)} | 中轨: ${r(lBoll?.middle)} | 下轨: ${r(lBoll?.lower)}
判断: ${bollSignal}

【成交量分析】
最新成交量: ${latestVol} | 20日均量: ${r(avgVol20, 0)}
量比(今/20日均): ${r(volRatio)} | ${volSignal}
  `.trim();
}
