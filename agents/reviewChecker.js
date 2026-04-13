import { createMoonshotLlm } from './shared.js';

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
  const cleaned = String(text || '')
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

export function createReviewChecker() {
  const llm = createMoonshotLlm({ temperature: 0, maxTokens: 800 });

  return {
    async check({ report, dataObject }) {
      const dataJson = JSON.stringify(dataObject, null, 2);
      const requiredStocks = (dataObject?.stocksData || [])
        .map((s) => ({
          stock_name: s.stock_name || '',
          stock_code: s.stock_code || '',
        }))
        .filter((s) => s.stock_name || s.stock_code);
      const requiredStocksJson = JSON.stringify(requiredStocks, null, 2);

      const prompt = `你是复盘质量审查器。检查报告是否符合数据事实与表达质量。
只返回 JSON，不要输出任何额外文字：
{"pass": boolean, "reason": string}

检查项：
1) 是否存在编造数据
2) 是否存在无法从输入数据推导的结论
3) 是否存在空话/套话
4) 个股复盘是否逐只覆盖 required_stocks 中的每只股票（名称或代码至少出现一个）
5) 每只股票是否都有“当日表现 + 技术位置 + 操作评价 + 替代动作”四类信息

输入数据：
${dataJson}

required_stocks:
${requiredStocksJson}

待审查报告：
${report}`;

      try {
        const response = await llm.invoke(prompt);
        const parsed = parseJsonSafe(messageToText(response));
        if (parsed && typeof parsed.pass === 'boolean') {
          return {
            pass: parsed.pass,
            reason: String(parsed.reason || '').trim() || '未提供原因',
          };
        }
      } catch {
        // fallback below
      }

      return { pass: false, reason: '校验输出不可解析，请重写并减少不可验证结论' };
    },
  };
}
