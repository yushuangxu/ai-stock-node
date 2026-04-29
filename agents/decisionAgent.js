import { assertMoonshotApiKey, createMoonshotLlm, invokeWithRetry } from './shared.js';

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('\n');
  }
  return String(content || '');
}

function extractJson(text) {
  const source = String(text || '').trim();
  const fenced = source.match(/```json\s*([\s\S]*?)```/i);
  const fromFence = fenced ? fenced[1] : source;
  const objectMatch = fromFence.match(/\{[\s\S]*\}/);
  const jsonText = objectMatch ? objectMatch[0] : fromFence;
  return JSON.parse(jsonText);
}

function normalizeDecision(raw = {}) {
  const allowedAction = new Set(['buy', 'hold', 'sell', 'watch']);
  const action = allowedAction.has(raw.action) ? raw.action : 'watch';
  const confidence = Number.isFinite(raw.confidence)
    ? Math.max(0, Math.min(100, Math.round(raw.confidence)))
    : 50;
  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons.filter((v) => typeof v === 'string' && v.trim()).slice(0, 5)
    : [];
  const risks = Array.isArray(raw.risks)
    ? raw.risks.filter((v) => typeof v === 'string' && v.trim()).slice(0, 5)
    : [];
  const plan = {
    entry: typeof raw?.plan?.entry === 'string' ? raw.plan.entry : '',
    stopLoss: typeof raw?.plan?.stopLoss === 'string' ? raw.plan.stopLoss : '',
    takeProfit: typeof raw?.plan?.takeProfit === 'string' ? raw.plan.takeProfit : '',
    position: typeof raw?.plan?.position === 'string' ? raw.plan.position : '',
  };

  return { action, confidence, reasons, risks, plan };
}

const DECISION_SYSTEM_PROMPT = `你是A股交易决策助手。请根据分析报告，提炼结构化交易建议。
仅输出 JSON，不要输出任何额外说明。

action 含义：
- buy: 倾向买入
- hold: 倾向持有
- sell: 倾向减仓或卖出
- watch: 观望，等待信号

输出格式：
{
  "action": "buy|hold|sell|watch",
  "confidence": 0-100 的整数,
  "reasons": ["理由1", "理由2"],
  "risks": ["风险1", "风险2"],
  "plan": {
    "entry": "入场条件",
    "stopLoss": "止损条件",
    "takeProfit": "止盈条件",
    "position": "仓位建议"
  }
}

约束：
1) 只能基于给定分析文本，不得编造新行情数据。
2) reasons/risks 各 2~4 条，简洁明确。
3) 若信号冲突明显，请输出 action=watch。`;

export function createDecisionAgent() {
  assertMoonshotApiKey();
  const llm = createMoonshotLlm({ temperature: 0.1, maxTokens: 1000 });

  return {
    async decide({ query, analysis }) {
      const prompt = [
        DECISION_SYSTEM_PROMPT,
        '',
        `用户请求: ${query}`,
        '',
        '分析报告:',
        String(analysis || ''),
      ].join('\n');

      const response = await invokeWithRetry(llm, prompt, {
        maxAttempts: 3,
        initialDelayMs: 600,
      });
      const text = contentToText(response?.content);
      try {
        const parsed = extractJson(text);
        return normalizeDecision(parsed);
      } catch {
        return normalizeDecision({
          action: 'watch',
          confidence: 45,
          reasons: ['模型输出非结构化，采用保守决策'],
          risks: ['结果格式异常，建议人工复核'],
          plan: {
            entry: '等待下一交易日确认信号',
            stopLoss: '暂不入场，无止损设置',
            takeProfit: '暂不入场，无止盈设置',
            position: '空仓或轻仓观察',
          },
        });
      }
    },
  };
}
