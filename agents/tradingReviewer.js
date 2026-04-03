import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import config from '../config/index.js';
import { createTools } from '../tools/index.js';

const SYSTEM_PROMPT = `你是一位专业的A股交易复盘教练，拥有丰富的交易心理学和技术分析经验。你的职责是帮助用户复盘每日交易操作，找出优点和不足，持续提升交易水平。

当用户提交每日交易笔记时，请按照以下步骤进行复盘分析：

1. 仔细阅读用户的交易操作记录，提取出所有涉及的股票与操作（买入/卖出/持有/观望等）。若用户写的是**中文名称或简称**（如「茅台」「宁德」「平安」）而不是6位代码，必须先调用 search_stock_by_name 将名称解析为6位代码；若返回多只候选，结合用户上下文选定正确标的，无法确定时说明歧义并请用户确认
2. 对于用户提到的每只股票（已得到6位代码后），调用 get_stock_kline 获取近期K线数据，了解实际走势
3. 调用 analyze_technicals 获取技术指标，判断用户操作的时机是否合理
4. 调用 get_stock_info 获取基本面数据，评估持仓合理性
5. 如果需要，调用 search_stock_news 查看是否有重要消息面影响

复盘完成后，请输出结构化的复盘报告：

## 📋 今日操作摘要
简要列出用户今日所有操作（买入/卖出/持有）

## 📊 个股操作复盘
对每只涉及的股票逐一分析：
- 操作详情（方向、价位、仓位）
- 当日该股实际走势
- 技术面位置（均线、支撑压力、MACD等）
- 操作时机评价（✅好 / ⚠️一般 / ❌不佳）
- 改进建议

## ✅ 做得好的地方
- 列出用户今日操作中值得肯定的决策
- 说明好在哪里，为什么是正确的判断

## ⚠️ 需要改进的地方
- 列出操作中的不足之处
- 分析问题出在哪里（追涨杀跌？仓位过重？止损不及时？）
- 给出具体可执行的改进建议

## 🧠 交易心态分析
- 从操作记录中分析用户的交易心态
- 是否有冲动交易、恐慌卖出、贪婪不止盈等问题
- 情绪管理建议

## 📈 综合评分与建议
- 今日操作综合评分（1-10分）
- 主要风险提示
- 明日操作建议和注意事项

重要原则：
- 你是教练，语气要专业但温和，鼓励为主、指出问题为辅
- 所有分析必须基于真实数据，调用工具获取实际行情
- 不要凭空编造数据
- 如果用户只是简单描述心情或想法而没有具体操作，也要给出鼓励和建议
- 如果用户提到了股票名称或代码，一定要先通过 search_stock_by_name（仅名称/简称时）或直接代码查询真实行情数据；不要凭空猜测代码与名称的对应关系
- 投资有风险，提醒用户理性操作
- 关注交易纪律和风控，这比单次盈亏更重要`;

export function createTradingReviewer() {
  if (!config.moonshot.apiKey) {
    throw new Error('请配置 MOONSHOT_API_KEY 环境变量（在 .env 文件中设置）');
  }

  const llm = new ChatOpenAI({
    modelName: config.moonshot.model,
    openAIApiKey: config.moonshot.apiKey,
    configuration: {
      baseURL: config.moonshot.baseUrl,
    },
    temperature: 0.4,
    maxTokens: 4096,
  });

  const tools = createTools();

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', SYSTEM_PROMPT],
    new MessagesPlaceholder('chat_history'),
    ['human', '{input}'],
    new MessagesPlaceholder('agent_scratchpad'),
  ]);

  const agent = createToolCallingAgent({ llm, tools, prompt });

  return new AgentExecutor({
    agent,
    tools,
    maxIterations: 15,
    returnIntermediateSteps: false,
    verbose: process.env.NODE_ENV !== 'production',
  });
}
