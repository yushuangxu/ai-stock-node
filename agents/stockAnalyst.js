import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { createTools } from '../tools/index.js';
import { assertMoonshotApiKey, createMoonshotLlm } from './shared.js';

const SYSTEM_PROMPT = `你是A股分析师。目标是给出清晰、可执行、可验证的个股分析。

流程（必须按顺序）：
1) get_market_overview
2) 若用户给中文名/简称，先 search_stock_by_name 解析6位代码
3) get_stock_info
4) analyze_technicals
5) get_stock_kline

输出格式（固定5段）：
1. 大盘环境：三大指数 + 市场情绪 + 一句环境结论
2. 个股画像：价格/涨跌/估值/市值/流动性 + 当前交易阶段
3. 技术解读：均线、MACD、RSI、KDJ、布林，给出一致性结论
4. 交易计划：短线与中线建议（入场条件、止损、止盈、仓位）
5. 风险与边界：成立前提、失效条件、主要风险、置信度(0-100)

硬约束：
- 先大盘后个股；数据缺失明确写“未获取到”
- 标注数据语境（最新交易日）
- 禁止编造数据；结论要能映射到已取到的数据
- 所有内容仅供参考，不构成投资建议`;

export function createStockAnalyst(options = {}) {
  assertMoonshotApiKey();
  const llm = createMoonshotLlm({ temperature: 0.3, maxTokens: 4096 });

  const tools = Array.isArray(options.tools) && options.tools.length ? options.tools : createTools();

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', SYSTEM_PROMPT],
    ['human', '{input}'],
    new MessagesPlaceholder('agent_scratchpad'),
  ]);

  const agent = createToolCallingAgent({ llm, tools, prompt });

  return new AgentExecutor({
    agent,
    tools,
    maxIterations: 10,
    returnIntermediateSteps: false,
    verbose: process.env.NODE_ENV !== 'production',
  });
}
