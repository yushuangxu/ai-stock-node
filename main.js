import { assertMoonshotApiKey } from './agents/shared.js';
import { parseActions } from './modules/parseActions.js';
import { fetchData } from './modules/fetchData.js';
import { createReviewAgent } from './agents/reviewAgent.js';
import { createReviewChecker } from './agents/reviewChecker.js';

function splitText(text, size = 80) {
  const out = [];
  const source = String(text || '');
  for (let i = 0; i < source.length; i += size) {
    out.push(source.slice(i, i + size));
  }
  return out;
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

export function createTradingReviewer() {
  assertMoonshotApiKey();

  const reviewAgent = createReviewAgent();
  const checker = createReviewChecker();

  return {
    async invoke({ input, chat_history = [] } = {}) {
      const rawInput = String(input || '').trim();
      const parsedActions = await parseActions(rawInput);
      const dataObject = await fetchData(parsedActions);

      let report = await reviewAgent.generate({
        rawInput,
        actions: parsedActions,
        dataObject,
      });

      let review = { pass: true, reason: '初始通过' };
      if (!hasCoveredAllStocks(report, dataObject)) {
        review = {
          pass: false,
          reason: '个股复盘未覆盖全部股票，请逐只单独分析并补全动作建议',
        };
      } else {
        review = await checker.check({ report, dataObject });
      }

      if (!review.pass) {
        report = await reviewAgent.generate({
          rawInput,
          actions: parsedActions,
          dataObject,
          rewriteHint: `上一版未通过审查，原因：${review.reason}。请严格基于输入数据重写。`,
        });
        if (!hasCoveredAllStocks(report, dataObject)) {
          review = {
            pass: false,
            reason: '重写后仍未覆盖全部股票，请检查 parseActions 与个股复盘段落',
          };
        } else {
          review = await checker.check({ report, dataObject });
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
      const result = await this.invoke({ input, chat_history });
      for (const chunk of splitText(result.output, 80)) {
        yield {
          event: 'on_chat_model_stream',
          data: { chunk: { content: chunk } },
        };
      }
      yield {
        event: 'on_chat_model_end',
        data: { output: { content: result.output, tool_calls: [] } },
      };
    },
  };
}
