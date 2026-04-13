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

export function createReviewAgent() {
  const llm = createMoonshotLlm({ temperature: 0.3, maxTokens: 6000 });

  return {
    async generate({ rawInput, actions, dataObject, rewriteHint = '' }) {
      const actionsJson = JSON.stringify(actions, null, 2);
      const dataJson = JSON.stringify(dataObject, null, 2);
      const stockList = (dataObject?.stocksData || [])
        .map((s, idx) => `${idx + 1}. ${s.stock_name || '未知'} (${s.stock_code || '未解析代码'})`)
        .join('\n');

      const prompt = `你是A股交易复盘分析师。
你只能使用我提供的输入数据进行分析，严禁调用任何工具，严禁臆造数据。

输入数据（JSON）：
【用户原始输入】
${rawInput}

【解析后的操作】
${actionsJson}

【行情与技术数据】
${dataJson}

【需要覆盖的股票列表】
${stockList || '无（若确实无个股，请在个股复盘段说明“未解析到可分析标的”）'}

输出必须固定为以下6段（标题必须一致）：
1. 今日大盘背景
2. 操作摘要
3. 个股复盘
4. 做得好的地方
5. 需要改进
6. 综合评分与明日计划

强约束：
- 数据缺失请明确写“未获取到”
- 禁止出现无法从输入数据推导的结论
- 个股复盘必须逐只展开：每只股票单独小节，标题格式为“### 股票名(代码)”
- 对每只股票必须包含：当日表现、技术位置、操作评价、替代动作
- 替代动作必须具体到：价位/仓位/止损（至少覆盖其中两项）
- 禁止空话套话，必须结合具体数据字段
- 所有内容仅供参考，不构成投资建议
${rewriteHint ? `\n修正要求：\n${rewriteHint}` : ''}`;

      const response = await llm.invoke(prompt);
      return messageToText(response);
    },
  };
}
