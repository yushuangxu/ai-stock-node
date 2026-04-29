function clampConfidence(confidence) {
  if (!Number.isFinite(confidence)) return 50;
  return Math.max(0, Math.min(100, Math.round(confidence)));
}

function ensureArrayText(arr, max = 5) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((item) => typeof item === 'string' && item.trim())
    .slice(0, max);
}

function parsePositionPercent(positionText) {
  const text = String(positionText || '');
  const match = text.match(/(\d{1,3})\s*%/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function applyMaxPositionRule(decision, maxPositionPct, triggeredRules) {
  const text = String(decision?.plan?.position || '');
  const parsed = parsePositionPercent(text);
  if (parsed == null) return decision;
  if (parsed <= maxPositionPct) return decision;
  triggeredRules.push(`max_position_${maxPositionPct}`);
  return {
    ...decision,
    plan: {
      ...decision.plan,
      position: `单票仓位建议不超过 ${maxPositionPct}%`,
    },
  };
}

function applyLowConfidenceRule(decision, triggeredRules) {
  if (decision.confidence >= 55) return decision;
  if (decision.action === 'watch' || decision.action === 'sell') return decision;
  triggeredRules.push('low_confidence_watch');
  return {
    ...decision,
    action: 'watch',
    reasons: [...decision.reasons, '置信度偏低，优先观望等待更清晰信号'].slice(0, 5),
    risks: [...decision.risks, '信号一致性不足，贸然入场可能造成回撤'].slice(0, 5),
  };
}

function applyStopLossRule(decision, triggeredRules) {
  const needStop = decision.action === 'buy' || decision.action === 'hold';
  if (!needStop) return decision;
  if (String(decision?.plan?.stopLoss || '').trim()) return decision;
  triggeredRules.push('missing_stop_loss');
  return {
    ...decision,
    plan: {
      ...decision.plan,
      stopLoss: '跌破关键支撑位或买入价下方 3%-5% 止损',
    },
  };
}

export function applyDecisionRules({ decision, task }) {
  const normalized = {
    action: decision?.action || 'watch',
    confidence: clampConfidence(decision?.confidence),
    reasons: ensureArrayText(decision?.reasons),
    risks: ensureArrayText(decision?.risks),
    plan: {
      entry: String(decision?.plan?.entry || ''),
      stopLoss: String(decision?.plan?.stopLoss || ''),
      takeProfit: String(decision?.plan?.takeProfit || ''),
      position: String(decision?.plan?.position || ''),
    },
  };

  const triggeredRules = [];
  let patched = normalized;
  patched = applyLowConfidenceRule(patched, triggeredRules);
  patched = applyStopLossRule(patched, triggeredRules);
  patched = applyMaxPositionRule(patched, task === 'quick_check' ? 30 : 50, triggeredRules);

  if ((patched.action === 'watch' || patched.action === 'sell') && !patched.plan.position.trim()) {
    patched = {
      ...patched,
      plan: { ...patched.plan, position: '轻仓试错或空仓等待' },
    };
  }

  return {
    decision: patched,
    ruleMeta: {
      triggeredRules,
      finalAction: patched.action,
      finalConfidence: patched.confidence,
    },
  };
}
