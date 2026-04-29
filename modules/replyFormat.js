export function formatDecisionSummary(decision = {}) {
  const reasons = Array.isArray(decision.reasons) ? decision.reasons : [];
  const risks = Array.isArray(decision.risks) ? decision.risks : [];
  const actionMap = {
    buy: '买入',
    hold: '持有',
    sell: '减仓/卖出',
    watch: '观望',
  };
  return [
    '【结构化决策】',
    `动作: ${actionMap[decision.action] || decision.action || '观望'}`,
    `置信度: ${decision.confidence ?? 50}`,
    `理由: ${reasons.join('；') || '暂无'}`,
    `风险: ${risks.join('；') || '暂无'}`,
    `计划: 入场=${decision?.plan?.entry || '待观察'}；止损=${decision?.plan?.stopLoss || '待观察'}；止盈=${decision?.plan?.takeProfit || '待观察'}；仓位=${decision?.plan?.position || '待观察'}`,
  ].join('\n');
}

export function buildAssistantSessionContent({ analysis, decision } = {}) {
  const summary = formatDecisionSummary(decision);
  const body = String(analysis ?? '').trim();
  if (!body) return summary;
  return `${summary}\n\n【详细分析】\n${body}`;
}
