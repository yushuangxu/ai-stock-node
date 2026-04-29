import { createStockAnalyst } from './stockAnalyst.js';
import { createDecisionAgent } from './decisionAgent.js';
import { createToolRegistry } from '../tools/registry.js';
import { buildTaskPrompt, normalizeTask } from '../modules/taskRouter.js';
import { applyDecisionRules } from '../modules/decisionRules.js';
import { formatDecisionSummary } from '../modules/replyFormat.js';

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function normalizeAnalysisOutput(result) {
  if (typeof result === 'string') return result;
  if (typeof result?.output === 'string') return result.output;
  if (typeof result?.content === 'string') return result.content;
  return JSON.stringify(result || {}, null, 2);
}

function splitText(text, size = 120) {
  const out = [];
  const source = String(text || '');
  for (let i = 0; i < source.length; i += size) {
    out.push(source.slice(i, i + size));
  }
  return out;
}

function historyToText(history = [], maxItems = 12) {
  if (!Array.isArray(history) || !history.length) return '';
  return history
    .slice(-maxItems)
    .map((item) => `${item.role || 'user'}: ${String(item.content || '')}`)
    .join('\n');
}

export function createTradingAgentV1() {
  const toolRegistry = createToolRegistry();
  const stockAnalyst = createStockAnalyst({ tools: toolRegistry.createAgentTools() });
  const decisionAgent = createDecisionAgent();

  async function run({ query, task = 'full_analysis', history = [] } = {}) {
    const userQuery = String(query || '').trim();
    if (!userQuery) {
      throw new Error('query 不能为空');
    }

    const normalizedTask = normalizeTask(task);
    const prompt = buildTaskPrompt({
      query: userQuery,
      task: normalizedTask,
      historyText: historyToText(history),
      history,
    });

    const analystRaw = await withTimeout(
      stockAnalyst.invoke({ input: prompt }),
      120_000,
      '技术分析超时',
    );
    const analysis = normalizeAnalysisOutput(analystRaw);

    const decision = await withTimeout(
      decisionAgent.decide({ query: prompt, analysis }),
      40_000,
      '决策生成超时',
    );
    const { decision: ruledDecision, ruleMeta } = applyDecisionRules({
      decision,
      task: normalizedTask,
    });

    return {
      analysis,
      decision: ruledDecision,
      meta: {
        task: normalizedTask,
        tool_names: toolRegistry.listToolNames(),
        rule_meta: ruleMeta,
        has_history: Array.isArray(history) && history.length > 0,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  return {
    async analyze(payload = {}) {
      return run(payload);
    },

    async *streamEvents(payload = {}) {
      const userQuery = String(payload?.query || '').trim();
      if (!userQuery) {
        throw new Error('query 不能为空');
      }
      const normalizedTask = normalizeTask(payload?.task);
      const history = Array.isArray(payload?.history) ? payload.history : [];
      const prompt = buildTaskPrompt({
        query: userQuery,
        task: normalizedTask,
        historyText: historyToText(history),
        history,
      });

      yield {
        event: 'on_stage',
        name: 'context_ready',
        data: { task: normalizedTask, history_count: history.length },
      };
      yield { event: 'on_tool_start', name: 'stock_analyst' };
      const analystRaw = await withTimeout(
        stockAnalyst.invoke({ input: prompt }),
        120_000,
        '技术分析超时',
      );
      yield { event: 'on_tool_end', name: 'stock_analyst' };
      const analysis = normalizeAnalysisOutput(analystRaw);
      yield { event: 'on_stage', name: 'analysis_ready' };

      yield { event: 'on_tool_start', name: 'decision_agent' };
      const decision = await withTimeout(
        decisionAgent.decide({ query: prompt, analysis }),
        40_000,
        '决策生成超时',
      );
      yield { event: 'on_tool_end', name: 'decision_agent' };
      yield { event: 'on_stage', name: 'decision_ready' };

      const { decision: ruledDecision, ruleMeta } = applyDecisionRules({
        decision,
        task: normalizedTask,
      });
      yield { event: 'on_stage', name: 'rule_checked', data: ruleMeta };

      const outputText = `${formatDecisionSummary(ruledDecision)}\n\n【详细分析】\n${analysis}`;
      for (const chunk of splitText(outputText, 120)) {
        yield {
          event: 'on_chat_model_stream',
          data: { chunk: { content: chunk } },
        };
      }
      yield {
        event: 'on_chat_model_end',
        data: {
          output: { content: outputText, tool_calls: [] },
          result: {
            decision: ruledDecision,
            meta: {
              task: normalizedTask,
              tool_names: toolRegistry.listToolNames(),
              rule_meta: ruleMeta,
              has_history: history.length > 0,
              generatedAt: new Date().toISOString(),
            },
          },
        },
      };
    },
  };
}
