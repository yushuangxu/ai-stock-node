import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import * as eastmoney from '../services/eastmoney.js';
import { calculateIndicators } from '../services/indicators.js';

export function createTools() {
  const getMarketOverview = new DynamicStructuredTool({
    name: 'get_market_overview',
    description:
      '获取A股大盘环境概览，返回上证指数、深证成指、创业板指的最新点位、涨跌幅与市场情绪判断，用于先判断大盘风险偏好再分析个股',
    schema: z.object({}),
    func: async () => {
      try {
        const data = await eastmoney.getMarketOverview();
        let result = `数据时间: ${data.timestamp}\n`;
        result += `大盘情绪: ${data.sentiment}\n\n`;
        result += '主要指数:\n';
        result += '名称       | 最新点位 | 涨跌额 | 涨跌幅 | 成交量(手) | 成交额(元)\n';
        result += '-----------|----------|--------|--------|------------|-----------\n';
        for (const item of data.indices) {
          result += `${item.name.padEnd(9)}| ${String(item.price ?? '未知').padStart(8)} | ${String(item.change ?? '未知').padStart(6)} | ${String(item.changePct != null ? item.changePct + '%' : '未知').padStart(6)} | ${String(item.volume ?? '未知').padStart(10)} | ${String(item.amount ?? '未知')}\n`;
        }
        result += '\n提示: 大盘情绪仅基于三大指数实时涨跌幅的简化判断。';
        return result;
      } catch (e) {
        return `获取大盘概览失败: ${e.message}`;
      }
    },
  });

  const searchStockByName = new DynamicStructuredTool({
    name: 'search_stock_by_name',
    description:
      '根据股票中文名称、简称或拼音模糊搜索A股，返回候选的6位代码与证券全称、市场板块。用户只写了股名、截图里是中文名称、或不确定代码时，必须先调用本工具解析出 code，再调用行情类工具。若用户已明确给出6位数字代码则不必调用。',
    schema: z.object({
      keyword: z
        .string()
        .describe('股票名称或简称，如 贵州茅台、宁德时代、平安银行；也可传6位代码用于校验证券简称'),
      limit: z.number().nullable().optional().describe('最多返回几条候选，默认8'),
    }),
    func: async ({ keyword, limit = 8 }) => {
      try {
        const actualLimit = Number.isFinite(limit) ? limit : 8;
        const rows = await eastmoney.searchStocksByKeyword(keyword, actualLimit);
        if (!rows.length) {
          return `未找到与「${keyword}」匹配的A股（6位代码），请让用户核对名称或提供6位代码。`;
        }
        let result = `关键词「${keyword}」匹配的A股候选（请结合用户描述选定正确标的，再用其 6 位 code 调用 get_stock_kline 等工具）：\n\n`;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const seg = r.market ? `  [${r.market}]` : '';
          result += `${i + 1}. ${r.code}  ${r.name ?? '未知'}${seg}\n`;
        }
        if (rows.length > 1) {
          result +=
            '\n若名称存在歧义（多只相似），请根据用户上下文选择一只；无法确定时向用户确认后再查行情。';
        }
        return result;
      } catch (e) {
        return `名称搜索失败: ${e.message}`;
      }
    },
  });

  const getStockKline = new DynamicStructuredTool({
    name: 'get_stock_kline',
    description:
      '获取A股股票的历史日K线数据，返回最近N天的开盘价、收盘价、最高价、最低价、成交量、涨跌幅等',
    schema: z.object({
      code: z
        .string()
        .describe(
          '6位A股代码，如 600519、000001、300750；若用户只提供股名或简称，请先调用 search_stock_by_name 解析出 code',
        ),
      days: z.number().nullable().optional().describe('获取天数，默认60'),
    }),
    func: async ({ code, days = 60 }) => {
      try {
        const actualDays = Number.isFinite(days) ? days : 60;
        const data = await eastmoney.getKlineData(code, actualDays);
        const recent = data.klines.slice(-15);
        const latest = data.klines[data.klines.length - 1];

        let result = `股票: ${data.name}(${data.code})\n`;
        result += `数据区间: ${data.klines[0].date} ~ ${latest.date} (共${data.klines.length}个交易日)\n`;
        result += `最新收盘价: ${latest.close}  涨跌幅: ${latest.changePct}%\n\n`;
        result += '最近15个交易日K线:\n';
        result += '日期       | 开盘    | 收盘    | 最高    | 最低    | 涨跌幅  | 成交量\n';
        result += '-----------|---------|---------|---------|---------|---------|--------\n';
        for (const k of recent) {
          result += `${k.date} | ${k.open.toFixed(2).padStart(7)} | ${k.close.toFixed(2).padStart(7)} | ${k.high.toFixed(2).padStart(7)} | ${k.low.toFixed(2).padStart(7)} | ${(k.changePct + '%').padStart(7)} | ${k.volume}\n`;
        }

        return result;
      } catch (e) {
        return `获取K线数据失败: ${e.message}`;
      }
    },
  });

  const getStockInfo = new DynamicStructuredTool({
    name: 'get_stock_info',
    description:
      '获取A股股票的基本面信息，包括市盈率PE、市净率PB、总市值、流通市值、每股收益EPS、ROE等基本面指标',
    schema: z.object({
      code: z
        .string()
        .describe(
          '6位A股代码；若用户只提供股名，请先调用 search_stock_by_name 解析出 code',
        ),
    }),
    func: async ({ code }) => {
      try {
        const info = await eastmoney.getStockInfo(code);
        return [
          `股票: ${info.name}(${info.code})`,
          `最新价: ${info.price ?? '未知'}元`,
          `涨跌幅: ${info.changePct ?? '未知'}%`,
          `总市值: ${info.totalMarketCapStr}`,
          `流通市值: ${info.floatMarketCapStr}`,
          `市盈率(动态PE): ${info.pe ?? '未知'}`,
          `市净率(PB): ${info.pb ?? '未知'}`,
          `市销率(PS): ${info.ps ?? '未知'}`,
          `每股收益(EPS): ${info.eps ?? '未知'}元`,
          `ROE(净资产收益率): ${info.roe != null ? info.roe + '%' : '未知'}`,
          `换手率: ${info.turnoverRate != null ? info.turnoverRate + '%' : '未知'}`,
          `量比: ${info.volumeRatio ?? '未知'}`,
        ].join('\n');
      } catch (e) {
        return `获取基本面数据失败: ${e.message}`;
      }
    },
  });

  const analyzeTechnicals = new DynamicStructuredTool({
    name: 'analyze_technicals',
    description:
      '对A股股票进行技术指标分析，自动计算MA均线(5/10/20/60日)、MACD、RSI、KDJ、布林带等指标并给出信号判断',
    schema: z.object({
      code: z
        .string()
        .describe(
          '6位A股代码；若用户只提供股名，请先调用 search_stock_by_name 解析出 code',
        ),
    }),
    func: async ({ code }) => {
      try {
        const data = await eastmoney.getKlineData(code, 150);
        const analysis = calculateIndicators(data.klines);
        return `${data.name}(${data.code}) 技术分析\n${analysis}`;
      } catch (e) {
        return `技术分析失败: ${e.message}`;
      }
    },
  });

  return [
    getMarketOverview,
    searchStockByName,
    getStockKline,
    getStockInfo,
    analyzeTechnicals,
  ];
}
