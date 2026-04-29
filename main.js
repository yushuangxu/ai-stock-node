import { assertMoonshotApiKey } from './agents/shared.js';
import { parseActions } from './modules/parseActions.js';
import { fetchData } from './modules/fetchData.js';
import { createReviewAgent } from './agents/reviewAgent.js';
import { createReviewChecker } from './agents/reviewChecker.js';

const GENERATE_TIMEOUT_MS = 110_000;
const REWRITE_TIMEOUT_MS = 90_000;

function splitText(text, size = 80) {
  const out = [];
  const source = String(text || '');
  for (let i = 0; i < source.length; i += size) {
    out.push(source.slice(i, i + size));
  }
  return out;
}

function withTimeout(promise, ms, message = '处理超时') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function messageContentToText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('\n')
      .trim();
  }
  return String(content ?? '').trim();
}

function historyToText(chatHistory = [], maxItems = 12) {
  if (!Array.isArray(chatHistory) || !chatHistory.length) return '';
  const sliced = chatHistory.slice(-maxItems);
  return sliced
    .map((msg) => {
      const type = typeof msg?._getType === 'function' ? msg._getType() : '';
      const role = type === 'ai' ? 'assistant' : 'user';
      return `${role}: ${messageContentToText(msg?.content)}`;
    })
    .join('\n');
}

function truncateText(input, max = 900) {
  const text = String(input || '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...（已截断 ${text.length - max} 字）`;
}

function compactDataForLlm(dataObject) {
  const stocksData = (dataObject?.stocksData || []).map((s) => ({
    action: s.action,
    stock_name: s.stock_name,
    stock_code: s.stock_code,
    market_context: s.market_context,
    volume_signal: s.volume_signal,
    error: s.error,
    stock_info_raw: truncateText(s.stock_info_raw, 700),
    technicals_raw: truncateText(s.technicals_raw, 1000),
    kline_raw: truncateText(s.kline_raw, 700),
  }));
  return {
    market: dataObject?.market || {},
    stocksData,
  };
}

function hasCoveredAllStocks(report, dataObject) {
  const text = String(report || '');
  const stocks = (dataObject?.stocksData || []).filter(
    (s) => (s.stock_name && s.stock_name.trim()) || (s.stock_code && s.stock_code.trim()),
  );
  if (!stocks.length) return true;
  return stocks.every((s) => {
    const byName = s.stock_name && text.includes(s.stock_name);
    const byCode = s.stock_code && text.includes(s.stock_code);
    return Boolean(byName || byCode);
  });
}

function hasVolumeJudgementForStocks(report, dataObject) {
  const text = String(report || '');
  const stocks = (dataObject?.stocksData || []).filter(
    (s) =>
      ((s.stock_name && s.stock_name.trim()) || (s.stock_code && s.stock_code.trim())) &&
      s?.volume_signal?.trend,
  );
  if (!stocks.length) return true;
  const hasVolumeKeyword = /放量|缩量|平量/.test(text);
  if (!hasVolumeKeyword) return false;
  return stocks.every((s) => {
    const byName = s.stock_name && text.includes(s.stock_name);
    const byCode = s.stock_code && text.includes(s.stock_code);
    return Boolean(byName || byCode);
  });
}

export function createTradingReviewer() {
  assertMoonshotApiKey();

  const reviewAgent = createReviewAgent();
  const checker = createReviewChecker();

  return {
    async invoke({ input, chat_history = [] } = {}) {
      const rawInput = String(input || '').trim();
      const historyText = historyToText(chat_history);
      const parsedActions = await withTimeout(
        parseActions(rawInput, historyText),
        30_000,
        '解析用户操作超时',
      );
      const dataObject = await withTimeout(
        fetchData(parsedActions),
        90_000,
        '获取行情数据超时',
      );
      const llmDataObject = compactDataForLlm(dataObject);

      let report;
      try {
        report = await withTimeout(
          reviewAgent.generate({
            rawInput,
            actions: parsedActions,
            dataObject: llmDataObject,
            historyText,
          }),
          GENERATE_TIMEOUT_MS,
          '生成复盘内容超时',
        );
      } catch (error) {
        report = await withTimeout(
          reviewAgent.generate({
            rawInput,
            actions: parsedActions.slice(0, 10),
            dataObject: {
              market: llmDataObject.market,
              stocksData: llmDataObject.stocksData.slice(0, 10),
            },
            historyText: truncateText(historyText, 1000),
            rewriteHint: `请更精简输出，优先保留关键结论与逐股建议。`,
          }),
          REWRITE_TIMEOUT_MS,
          error?.message || '生成复盘内容超时',
        );
      }

      let review = { pass: true, reason: '初始通过' };
      if (!hasCoveredAllStocks(report, dataObject)) {
        review = {
          pass: false,
          reason: '个股复盘未覆盖全部股票，请逐只单独分析并补全动作建议',
        };
      } else if (!hasVolumeJudgementForStocks(report, dataObject)) {
        review = {
          pass: false,
          reason: '个股复盘缺少成交量判断（放量/缩量/平量）或未据此给出建议',
        };
      } else {
        review = await withTimeout(
          checker.check({ report, dataObject: llmDataObject }),
          25_000,
          '复盘校验超时',
        );
      }

      if (!review.pass) {
        report = await withTimeout(
          reviewAgent.generate({
            rawInput,
            actions: parsedActions,
            dataObject: llmDataObject,
            historyText,
            rewriteHint: `上一版未通过审查，原因：${review.reason}。请严格基于输入数据重写。`,
          }),
          REWRITE_TIMEOUT_MS,
          '复盘重写超时',
        );
        if (!hasCoveredAllStocks(report, dataObject)) {
          review = {
            pass: false,
            reason: '重写后仍未覆盖全部股票，请检查 parseActions 与个股复盘段落',
          };
        } else if (!hasVolumeJudgementForStocks(report, dataObject)) {
          review = {
            pass: false,
            reason: '重写后仍缺少成交量趋势判断，请检查 volume_signal 输出与个股复盘段落',
          };
        } else {
          review = await withTimeout(
            checker.check({ report, dataObject: llmDataObject }),
            25_000,
            '复盘重写校验超时',
          );
        }
      }

      return {
        output: report,
        meta: {
          pass: review.pass,
          check_reason: review.reason,
          parsed_actions: parsedActions,
          has_history: Array.isArray(chat_history) && chat_history.length > 0,
        },
      };
    },

    async *streamEvents({ input, chat_history = [] } = {}) {
      yield { event: 'on_tool_start', name: 'parse_actions' };
      const rawInput = String(input || '').trim();
      const historyText = historyToText(chat_history);
      const parsedActions = await withTimeout(
        parseActions(rawInput, historyText),
        30_000,
        '解析用户操作超时',
      );
      yield { event: 'on_tool_end', name: 'parse_actions' };

      yield { event: 'on_tool_start', name: 'fetch_data' };
      const dataObject = await withTimeout(
        fetchData(parsedActions),
        90_000,
        '获取行情数据超时',
      );
      const llmDataObject = compactDataForLlm(dataObject);
      yield { event: 'on_tool_end', name: 'fetch_data' };

      yield { event: 'on_tool_start', name: 'generate_review' };
      let report;
      try {
        report = await withTimeout(
          reviewAgent.generate({
            rawInput,
            actions: parsedActions,
            dataObject: llmDataObject,
            historyText,
          }),
          GENERATE_TIMEOUT_MS,
          '生成复盘内容超时',
        );
      } catch (error) {
        report = await withTimeout(
          reviewAgent.generate({
            rawInput,
            actions: parsedActions.slice(0, 10),
            dataObject: {
              market: llmDataObject.market,
              stocksData: llmDataObject.stocksData.slice(0, 10),
            },
            historyText: truncateText(historyText, 1000),
            rewriteHint: `请更精简输出，优先保留关键结论与逐股建议。`,
          }),
          REWRITE_TIMEOUT_MS,
          error?.message || '生成复盘内容超时',
        );
      }
      yield { event: 'on_tool_end', name: 'generate_review' };

      let review = { pass: true, reason: '初始通过' };
      if (!hasCoveredAllStocks(report, dataObject)) {
        review = {
          pass: false,
          reason: '个股复盘未覆盖全部股票，请逐只单独分析并补全动作建议',
        };
      } else if (!hasVolumeJudgementForStocks(report, dataObject)) {
        review = {
          pass: false,
          reason: '个股复盘缺少成交量判断（放量/缩量/平量）或未据此给出建议',
        };
      } else {
        yield { event: 'on_tool_start', name: 'check_review' };
        review = await withTimeout(
          checker.check({ report, dataObject: llmDataObject }),
          25_000,
          '复盘校验超时',
        );
        yield { event: 'on_tool_end', name: 'check_review' };
      }

      if (!review.pass) {
        yield { event: 'on_tool_start', name: 'rewrite_review' };
        report = await withTimeout(
          reviewAgent.generate({
            rawInput,
            actions: parsedActions,
            dataObject: llmDataObject,
            historyText,
            rewriteHint: `上一版未通过审查，原因：${review.reason}。请严格基于输入数据重写。`,
          }),
          REWRITE_TIMEOUT_MS,
          '复盘重写超时',
        );
        yield { event: 'on_tool_end', name: 'rewrite_review' };
      }

      for (const chunk of splitText(report, 80)) {
        yield {
          event: 'on_chat_model_stream',
          data: { chunk: { content: chunk } },
        };
      }
      yield {
        event: 'on_chat_model_end',
        data: { output: { content: report, tool_calls: [] } },
      };
    },
  };
}
