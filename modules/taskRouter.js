const TASKS = new Set(['full_analysis', 'quick_check']);

export function normalizeTask(task) {
  if (!task || !TASKS.has(task)) return 'full_analysis';
  return task;
}

function hasPriorAssistant(history = []) {
  return (
    Array.isArray(history) &&
    history.some(
      (item) =>
        String(item?.role || '') === 'assistant' &&
        String(item?.content || '').trim().length > 0,
    )
  );
}

function isFollowUpQuery(query) {
  const text = String(query || '').trim();
  return /这个股票|这只|该股|该票|它|继续|接着|现在呢|接下来呢|然后呢|还要不要|怎么办|怎么操作|咋整|还能不能|要不要|刚才|之前|上面|上一轮|沿用|再说说|详细点|展开|理由|原因|依据|为啥|为什么|怎么说|怎么看|合理吗|可以吗|靠谱吗|合适吗|会涨吗|会跌吗|涨到|跌到|支撑|压力|止损|止盈|仓位|风险大吗|那如果|若是|假如|假设|对照上轮|和上次/.test(
    text,
  );
}

function isShortFollowUpQuestion(query) {
  const text = String(query || '').trim();
  if (!text || text.length > 40) return false;
  if (/\b\d{6}\b/.test(text)) return false;
  if (/[\u4e00-\u9fa5]{2,8}(股份|集团|科技|银行|证券|保险)/.test(text)) return false;
  if (/[吗呢么嘛吧呀呐咯]\s*[？?]?\s*$/.test(text) && text.length <= 28) return true;
  return false;
}

function hasExplicitSymbol(query) {
  const text = String(query || '').trim();
  if (/\b\d{6}\b/.test(text)) return true;
  if (/[（(]\d{6}[）)]/.test(text)) return true;
  if (/[\u4e00-\u9fa5]{2,8}(股份|集团|科技|银行|证券|保险)/.test(text)) return true;
  return false;
}

function extractCodesAndNames(combined) {
  if (!combined) return { code: '', name: '' };
  const codeWord = [...combined.matchAll(/\b(\d{6})\b/g)];
  if (codeWord.length) return { code: codeWord[codeWord.length - 1][1], name: '' };
  const codeParen = [...combined.matchAll(/[（(](\d{6})[）)]/g)];
  if (codeParen.length) return { code: codeParen[codeParen.length - 1][1], name: '' };
  const nameMatch = combined.match(
    /([\u4e00-\u9fa5]{2,8}(股份|集团|科技|银行|证券|保险))/g,
  );
  if (Array.isArray(nameMatch) && nameMatch.length) {
    return { code: '', name: nameMatch[nameMatch.length - 1] };
  }
  return { code: '', name: '' };
}

function extractLastSymbolFromHistory(history = []) {
  if (!Array.isArray(history) || !history.length) return '';
  const assistantBlocks = history
    .filter((item) => String(item?.role || '') === 'assistant')
    .map((item) => String(item?.content || ''));
  const preferred = assistantBlocks.length ? assistantBlocks.join('\n') : '';
  const fallback = history
    .slice(-12)
    .map((item) => String(item?.content || ''))
    .join('\n');
  const primary = extractCodesAndNames(preferred);
  if (primary.code || primary.name) return primary.code || primary.name;
  const secondary = extractCodesAndNames(fallback);
  return secondary.code || secondary.name;
}

export function buildTaskPrompt({ query, task, historyText = '', history = [] }) {
  const userQuery = String(query || '').trim();
  const normalizedTask = normalizeTask(task);
  const followUp =
    hasPriorAssistant(history) &&
    !hasExplicitSymbol(userQuery) &&
    (isFollowUpQuery(userQuery) || isShortFollowUpQuestion(userQuery));
  const lastSymbol = followUp ? extractLastSymbolFromHistory(history) : '';
  const effectiveQuery = followUp && lastSymbol
    ? `${userQuery}（默认沿用上一轮标的：${lastSymbol}）`
    : userQuery;

  let prefix = '';
  if (normalizedTask === 'quick_check') {
    prefix = '请做快速技术面判断（偏短线），重点给出方向、关键价位、风控。';
  } else {
    prefix = '请做完整技术分析并给出短中线交易计划。';
  }
  if (followUp) {
    prefix += '\n这是会话追问：请先给“与上一轮相比的变化点（最多3条）”，然后再给本轮操作建议；禁止整段复述上一轮内容。';
  }

  if (!historyText.trim()) {
    return `${prefix}\n用户请求：${effectiveQuery}`;
  }

  return [
    prefix,
    `用户请求：${effectiveQuery}`,
    '',
    '会话上下文（仅作参考，优先以最新请求和工具数据为准）：',
    historyText,
  ].join('\n');
}
