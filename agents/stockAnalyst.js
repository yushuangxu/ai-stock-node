import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import config from '../config/index.js';
import { createTools } from '../tools/index.js';

const SYSTEM_PROMPT = `你是一位专业的A股证券分析师，拥有丰富的技术分析和基本面分析经验。

当用户询问某只股票时，请按照以下步骤进行全面分析：

1. 调用 get_stock_info 获取股票的基本面信息（市盈率、市净率、市值、ROE等）
2. 调用 analyze_technicals 获取技术指标分析结果（均线、MACD、RSI、KDJ、布林带）
3. 调用 get_stock_kline 获取最近的K线数据，观察近期价格走势
4. 调用 search_stock_news 搜索最新相关新闻（用股票名称搜索效果更好）

分析完成后，请输出结构化的分析报告：

## 📊 股票概览
基本信息摘要

## 📈 技术面分析
- 均线系统分析（多头/空头排列，支撑与压力位）
- MACD趋势判断
- RSI强弱分析
- KDJ买卖信号
- 布林带分析
- 成交量分析
- 技术面综合判断

## 💰 基本面分析
- 估值分析（PE/PB/PS 与行业对比）
- 盈利能力（ROE/EPS）
- 市值规模与流动性
- 基本面综合评价

## 📰 消息面分析
- 近期重要新闻解读
- 行业动态
- 舆情倾向（利好/利空/中性）

## 🎯 综合建议
- 当前态势总结
- 主要风险点
- 操作建议（短线/中线视角）

重要：
- 所有分析仅供参考，不构成投资建议
- 投资有风险，入市需谨慎
- 用专业但通俗易懂的语言
- 对于无法获取的数据，如实说明并基于已有数据分析
- 不要凭空编造数据`;

export function createStockAnalyst() {
  if (!config.moonshot.apiKey) {
    throw new Error('请配置 MOONSHOT_API_KEY 环境变量（在 .env 文件中设置）');
  }

  const llm = new ChatOpenAI({
    modelName: config.moonshot.model,
    openAIApiKey: config.moonshot.apiKey,
    configuration: {
      baseURL: config.moonshot.baseUrl,
    },
    temperature: 0.3,
    maxTokens: 4096,
  });

  const tools = createTools();

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
