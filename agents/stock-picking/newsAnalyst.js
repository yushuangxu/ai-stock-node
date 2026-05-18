/**
 * 新闻/事件驱动选股分析智能体（多阶段流水线）
 *
 * 流水线阶段：
 *   新闻输入 → 市场状态识别 → 事件抽取 → 产业链识别 → 知识图谱推理
 *           → 向量知识库召回 → 公告验证 → 历史事件回测 → 预期差评分
 *           → 资金风格过滤 → 最终股票池输出
 *
 * 每个阶段由独立的 LLM 调用完成，阶段间通过结构化 JSON 传递数据。
 * 最后自动拉取候选股票的实时行情数据并附加到输出。
 */

import { createZhipuLlm, invokeWithRetry } from '../shared.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  searchStocksByKeyword,
  getStockInfo,
  getKlineData,
} from '../../services/eastmoney.js';

// ==================== JSON 解析工具 ====================

function parseLlmJson(text) {
  try {
    return JSON.parse(text);
  } catch {}
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) {
    try { return JSON.parse(m[1].trim()); } catch {}
  }
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) {
    try { return JSON.parse(obj[0]); } catch {}
  }
  return null;
}

function contentToString(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => typeof c === 'string' ? c : c?.text || '').join('');
  return String(content ?? '');
}

// ==================== 阶段1: 市场状态识别 ====================

const STAGE1_SYSTEM = `你是A股市场状态识别引擎。根据用户输入的新闻内容，判断当前市场所处状态。
仅输出JSON，格式如下：
{
  "marketPhase": "牛市|熊市|震荡市|结构性牛市|题材轮动",
  "riskLevel": "低|中|高",
  "liquiditySignal": "宽松|中性|收紧",
  "sentimentTrend": "升温|平稳|降温",
  "marketStyle": "大盘蓝筹|中小盘成长|题材炒作|防御保守|无明显风格",
  "summary": "一句话市场状态判断"
}`;

async function stage1_marketState(llm, newsContent) {
  const resp = await invokeWithRetry(llm, [
    new SystemMessage(STAGE1_SYSTEM),
    new HumanMessage(`请根据以下新闻判断当前A股市场状态：\n\n${newsContent}`),
  ]);
  const text = contentToString(resp.content);
  const parsed = parseLlmJson(text);
  return parsed || {
    marketPhase: '震荡市',
    riskLevel: '中',
    liquiditySignal: '中性',
    sentimentTrend: '平稳',
    marketStyle: '无明显风格',
    summary: '无法明确判断市场状态',
  };
}

// ==================== 阶段2: 事件抽取 ====================

const STAGE2_SYSTEM = `你是专业的事件抽取引擎。从新闻中提取核心事件和关键实体。
仅输出JSON，格式如下：
{
  "eventTitle": "事件标题（一句话）",
  "coreEvent": "核心事件描述（2-3句话）",
  "eventDate": "事件日期（如能推断）",
  "significance": "高|中|低",
  "impactDuration": "短期（1-5天）|中期（1-3个月）|长期（3个月以上）",
  "keyEntities": [
    {"name": "实体名称", "type": "公司|机构|产品|技术|政策|人物", "role": "在事件中的角色"}
  ],
  "keywords": ["关键词1", "关键词2"],
  "relatedSectors": ["相关行业/板块1", "相关行业/板块2"]
}`;

async function stage2_eventExtraction(llm, newsContent) {
  const resp = await invokeWithRetry(llm, [
    new SystemMessage(STAGE2_SYSTEM),
    new HumanMessage(`请从以下新闻中抽取核心事件和关键实体：\n\n${newsContent}`),
  ]);
  const text = contentToString(resp.content);
  const parsed = parseLlmJson(text);
  return parsed || {
    eventTitle: '未能抽取事件',
    coreEvent: newsContent.slice(0, 200),
    significance: '中',
    keywords: [],
    relatedSectors: [],
    keyEntities: [],
  };
}

// ==================== 阶段3: 产业链识别 ====================

const STAGE3_SYSTEM = `你是产业链分析专家。根据给定的事件和关键词，分析相关产业链结构。
仅输出JSON，格式如下：
{
  "chainName": "产业链名称",
  "upstream": [
    {"segment": "环节名称", "description": "环节描述", "affectedBy": "受事件影响的方式"}
  ],
  "midstream": [
    {"segment": "环节名称", "description": "环节描述", "affectedBy": "受事件影响的方式"}
  ],
  "downstream": [
    {"segment": "环节名称", "description": "环节描述", "affectedBy": "受事件影响的方式"}
  ],
  "coreSegment": "真正受益的核心环节名称",
  "coreReason": "为什么这个环节最受益",
  "barriers": "核心环节的技术壁垒和竞争护城河"
}`;

async function stage3_supplyChain(llm, eventResult) {
  const prompt = `事件信息：
${JSON.stringify(eventResult, null, 2)}

请分析该事件相关的产业链结构，识别上中下游环节及核心受益环节。`;

  const resp = await invokeWithRetry(llm, [
    new SystemMessage(STAGE3_SYSTEM),
    new HumanMessage(prompt),
  ]);
  const text = contentToString(resp.content);
  const parsed = parseLlmJson(text);
  return parsed || { chainName: '未知', upstream: [], midstream: [], downstream: [], coreSegment: '未知' };
}

// ==================== 阶段4: 知识图谱推理 ====================

const STAGE4_SYSTEM = `你是A股知识图谱推理引擎。根据事件信息和产业链分析，通过关联推理找出可能受益的A股公司。
请基于你对A股市场的了解进行推理，注意区分直接受益和间接受益。

⚠️ 关键要求：
1. 必须给出具体的A股上市公司简称（如"科大讯飞"、"寒锐钴业"），不要给行业描述或泛泛的说法
2. 每个受益方至少给出2-3家具体的上市公司名称
3. 直接受益公司必须是与事件有明确业务关系的真实A股上市公司
4. 间接受益公司也必须是可查证的真实A股上市公司
5. companiesToSearch 中列出所有你提到的公司名称（用于在股票数据库中查找代码）

仅输出JSON，格式如下：
{
  "reasoningChain": [
    {
      "logic": "推理逻辑描述",
      "from": "起点（事件/行业/技术）",
      "to": "终点（具体公司或板块）",
      "confidence": "高|中|低"
    }
  ],
  "directBeneficiaries": [
    {"name": "A股上市公司准确简称", "reason": "直接受益原因", "businessConnection": "与事件的具体业务关联"}
  ],
  "indirectBeneficiaries": [
    {"name": "A股上市公司准确简称", "reason": "间接受益原因", "transmissionPath": "传导路径"}
  ],
  "companiesToSearch": ["公司简称1", "公司简称2"]
}`;

async function stage4_knowledgeReasoning(llm, eventResult, chainResult) {
  const prompt = `事件信息：
${JSON.stringify(eventResult, null, 2)}

产业链分析：
${JSON.stringify(chainResult, null, 2)}

请通过知识图谱推理，找出所有可能受益的A股上市公司。重点关注：
1. 新闻中直接提到的公司及其关联方
2. 核心产业链环节的龙头公司
3. 有公开业务案例可以匹配的公司
4. 列出需要进一步搜索的公司名称（用于在股票数据库中查找代码）`;

  const resp = await invokeWithRetry(llm, [
    new SystemMessage(STAGE4_SYSTEM),
    new HumanMessage(prompt),
  ]);
  const text = contentToString(resp.content);
  const parsed = parseLlmJson(text);
  return parsed || { reasoningChain: [], directBeneficiaries: [], indirectBeneficiaries: [], companiesToSearch: [] };
}

// ==================== 阶段4.5: 股票代码验证 ====================

/**
 * 使用 Stage4 输出的 companiesToSearch 列表，在东方财富搜索验证真实股票代码
 * 返回验证过的公司列表 { name, code, verified: true }
 */
async function stage4_5_verifyStockCodes(knowledgeReasoningResult) {
  const allNames = new Set();

  // 收集所有公司名
  const { directBeneficiaries = [], indirectBeneficiaries = [], companiesToSearch = [] } = knowledgeReasoningResult;
  for (const c of directBeneficiaries) { if (c.name) allNames.add(c.name); }
  for (const c of indirectBeneficiaries) { if (c.name) allNames.add(c.name); }
  for (const n of companiesToSearch) { if (n) allNames.add(n); }

  if (allNames.size === 0) return [];

  // 并发搜索验证
  const searchResults = await Promise.allSettled(
    [...allNames].map(async (name) => {
      try {
        const results = await searchStocksByKeyword(name, 3);
        if (results.length > 0) {
          // 优先选完全匹配的
          const exact = results.find(r => r.name === name);
          const best = exact || results[0];
          return { name: best.name, code: best.code, verified: true };
        }
        return null;
      } catch {
        return null;
      }
    })
  );

  return searchResults
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value);
}

// ==================== 阶段5: 历史相似事件回测 ====================

const STAGE5_SYSTEM = `你是A股事件驱动策略回测专家。根据当前事件，回顾A股历史上类似事件对相关个股和板块的影响。
仅输出JSON，格式如下：
{
  "similarEvents": [
    {
      "eventName": "历史事件名称",
      "eventDate": "大约时间",
      "marketReaction": "市场反应描述",
      "sectorPerformance": "相关板块表现",
      "topGainers": ["涨幅最大的股票1", "涨幅最大的股票2"],
      "duration": "行情持续多久",
      "lesson": "本次事件的经验教训"
    }
  ],
  "patternSummary": "历史规律总结",
  "winRate": "类似事件的胜率估计（高/中/低）",
  "avgDuration": "行情平均持续时间",
  "riskWarning": "需要警惕的风险模式"
}`;

async function stage5_historicalBacktest(llm, eventResult) {
  const prompt = `当前事件：
${JSON.stringify(eventResult, null, 2)}

请回顾A股历史上类似事件对市场的影响，总结规律和经验教训。`;

  const resp = await invokeWithRetry(llm, [
    new SystemMessage(STAGE5_SYSTEM),
    new HumanMessage(prompt),
  ]);
  const text = contentToString(resp.content);
  const parsed = parseLlmJson(text);
  return parsed || { similarEvents: [], patternSummary: '无足够历史数据', winRate: '中' };
}

// ==================== 阶段6: 预期差评分 + 公司综合评级 ====================

const STAGE6_SYSTEM = `你是预期差评分和选股评级专家。根据前面各阶段的分析结果，对每家公司进行综合评级。

⚠️ 关键要求：
1. companies 列表中必须只包含具体的A股上市公司（如"科大讯飞002230"），禁止出现行业描述、泛泛说法
2. 必须使用【已验证的股票列表】中的公司名和代码，这些是经过股票数据库验证的真实A股上市公司
3. 如果验证列表中有公司，必须全部包含在 companies 中，不要遗漏
4. 每家公司的 name 必须是A股准确简称，code 必须是6位数字代码
5. watchPoolRanking 中的公司也必须使用已验证的具体名称和代码
6. 如果验证列表为空，则根据知识图谱推理结果中的公司名来生成，但仍需给出具体公司名

仅输出JSON，格式如下：
{
  "companies": [
    {
      "name": "A股上市公司准确简称",
      "code": "6位股票代码",
      "category": "新闻直接点名|知识图谱推理|行业龙头|延伸受益",
      "tradeType": "A类产业埋伏型|B类趋势核心型|C类情绪妖股型",
      "role": "在事件中的角色",
      "logic": "受益逻辑说明",
      "evidenceStrength": "强|中|弱",
      "expectationGap": {
        "score": "1-10分",
        "reason": "预期差评分理由"
      },
      "watchPoolGrade": "S|A|B|C",
      "keyPoints": ["待查证事项1", "待查证事项2"]
    }
  ],
  "evidenceChain": {
    "strong": ["强证据1"],
    "medium": ["中证据1"],
    "weak": ["弱证据1"]
  },
  "ackModelCheck": {
    "inCompetence": true,
    "hasExpectationGap": true,
    "hasRealBusinessMapping": true,
    "hasClearCatalyst": true,
    "valuationReasonable": null,
    "hasMultipleLogics": true,
    "hasTrackingValue": true,
    "notes": "补充说明"
  },
  "financialChecks": ["需查证事项1"],
  "watchPoolRanking": [
    {"name": "A股公司准确简称", "code": "6位代码", "grade": "S|A|B|C", "reason": "评级理由"}
  ],
  "nextSteps": ["跟踪事项1", "跟踪事项2"],
  "risks": ["风险1", "风险2"]
}

## 评级标准
- S级：逻辑清晰、预期差大、有真实业务映射、证据链强
- A级：逻辑清晰、有一定预期差、有业务关联
- B级：受益逻辑直接但非核心环节
- C级：逻辑较弱、概念联想为主

## 交易类型
- A类产业埋伏型：产业趋势确定，核心环节，适合提前埋伏
- B类趋势核心型：已有趋势，行业核心标的
- C类情绪妖股型：情绪驱动为主，基本面弱`;

async function stage6_finalScoring(llm, allStageResults) {
  // 构建已验证股票的强调文本
  const verifiedList = allStageResults.verifiedStocks || [];
  const verifiedText = verifiedList.length > 0
    ? `\n【⚠️ 已验证的股票列表（必须全部出现在 companies 中）】\n${JSON.stringify(verifiedList, null, 2)}\n\n以上 ${verifiedList.length} 家公司已通过股票数据库验证为真实A股上市公司，请务必全部包含在 companies 和 watchPoolRanking 中，并使用这里的准确名称和代码。`
    : '\n【注意】股票验证阶段未能匹配到具体公司，请根据知识图谱推理结果中的公司名尽量给出具体的A股上市公司名称。';

  const prompt = `以下是各阶段的分析结果，请综合所有信息给出最终的公司评级和股票池：

【市场状态】
${JSON.stringify(allStageResults.marketState, null, 2)}

【事件抽取】
${JSON.stringify(allStageResults.eventExtraction, null, 2)}

【产业链分析】
${JSON.stringify(allStageResults.supplyChain, null, 2)}

【知识图谱推理】
${JSON.stringify(allStageResults.knowledgeReasoning, null, 2)}
${verifiedText}
【历史事件回测】
${JSON.stringify(allStageResults.historicalBacktest, null, 2)}

请综合以上分析，对每家候选公司进行评级，输出最终股票池。确保：
1. ⚠️ 公司名必须是具体的A股上市公司简称（如"科大讯飞"），code 必须是6位数字代码
2. 已验证列表中的公司必须全部出现在输出中，不要遗漏
3. 证据链分析要具体
4. 风险提示要结合事件特点`;

  const resp = await invokeWithRetry(llm, [
    new SystemMessage(STAGE6_SYSTEM),
    new HumanMessage(prompt),
  ]);
  const text = contentToString(resp.content);
  const parsed = parseLlmJson(text);
  return parsed || { companies: [], watchPoolRanking: [], risks: ['分析结果解析失败'] };
}

// ==================== 行情数据增强 ====================

async function enrichWithStockData(item) {
  if (!item.name && !item.code) return null;

  let code = item.code;
  let name = item.name;

  // 如果没有代码，尝试搜索
  if (!code && name) {
    try {
      const results = await searchStocksByKeyword(name, 3);
      if (results.length > 0) {
        code = results[0].code;
        if (!name) name = results[0].name;
      }
    } catch {
      return null;
    }
  }

  if (!code) return null;

  try {
    const stockData = {};

    // 获取实时行情
    const info = await getStockInfo(code);
    stockData.code = code;
    stockData.name = name || info.name;
    stockData.price = info.price;
    stockData.changePct = info.changePct;
    stockData.open = info.open;
    stockData.high = info.high;
    stockData.low = info.low;
    stockData.pe = info.pe;
    stockData.pb = info.pb;
    stockData.totalMarketCap = info.totalMarketCap;
    stockData.totalMarketCapStr = info.totalMarketCapStr;
    stockData.floatMarketCap = info.floatMarketCap;
    stockData.floatMarketCapStr = info.floatMarketCapStr;
    stockData.turnoverRate = info.turnoverRate;
    stockData.volumeRatio = info.volumeRatio;

    // 获取K线计算短期涨跌幅
    const klineResult = await getKlineData(code, 30);
    const klines = klineResult.klines || [];
    if (klines.length > 0) {
      const last = klines[klines.length - 1].close;
      const getCloseDaysAgo = (days) => {
        const idx = klines.length - 1 - days;
        return idx >= 0 ? klines[idx].close : null;
      };
      const close5 = getCloseDaysAgo(5);
      const close20 = getCloseDaysAgo(20);
      if (close5) stockData.priceChange5d = +((last - close5) / close5 * 100).toFixed(2);
      if (close20) stockData.priceChange20d = +((last - close20) / close20 * 100).toFixed(2);
      stockData.recentKlines = klines.slice(-5).map(k => ({
        date: k.date,
        close: k.close,
        changePct: k.changePct,
      }));
    }

    return stockData;
  } catch {
    return null;
  }
}

async function enrichCompaniesWithStockData(companies) {
  if (!Array.isArray(companies)) return companies;
  const results = await Promise.allSettled(
    companies.map(async (c) => {
      const stockData = await enrichWithStockData(c);
      return { ...c, code: c.code || stockData?.code, stockData: stockData || undefined };
    })
  );
  return results.map((r) => (r.status === 'fulfilled' ? r.value : companies[results.indexOf(r)]));
}

// ==================== 主分析函数 ====================

/**
 * 分析新闻/事件（多阶段流水线）
 * @param {string} newsContent - 新闻内容
 * @param {object} [options] - 选项
 * @param {function} [options.onStage] - 阶段回调 (stageName, stageResult) => void
 * @returns {Promise<object>} 完整分析结果
 */
export async function analyzeNews(newsContent, options = {}) {
  const { onStage } = options;
  const llm = createZhipuLlm({ temperature: 0.3, maxTokens: 8192 });

  // ── 阶段1: 市场状态识别 ──
  const marketState = await stage1_marketState(llm, newsContent);
  onStage?.('marketState', marketState);

  // ── 阶段2: 事件抽取 ──
  const eventExtraction = await stage2_eventExtraction(llm, newsContent);
  onStage?.('eventExtraction', eventExtraction);

  // ── 阶段3: 产业链识别 ──
  const supplyChain = await stage3_supplyChain(llm, eventExtraction);
  onStage?.('supplyChain', supplyChain);

  // ── 阶段4: 知识图谱推理 ──
  const knowledgeReasoning = await stage4_knowledgeReasoning(llm, eventExtraction, supplyChain);
  onStage?.('knowledgeReasoning', knowledgeReasoning);

  // ── 阶段4.5: 股票代码验证（在东方财富搜索验证真实股票代码） ──
  const verifiedStocks = await stage4_5_verifyStockCodes(knowledgeReasoning);
  onStage?.('stockVerification', verifiedStocks);

  // ── 阶段5: 历史事件回测 ──
  const historicalBacktest = await stage5_historicalBacktest(llm, eventExtraction);
  onStage?.('historicalBacktest', historicalBacktest);

  // ── 阶段6: 预期差评分 + 综合评级 ──
  const finalResult = await stage6_finalScoring(llm, {
    marketState,
    eventExtraction,
    supplyChain,
    knowledgeReasoning,
    verifiedStocks,
    historicalBacktest,
  });
  onStage?.('finalScoring', finalResult);

  // ── 行情数据增强 ──
  if (finalResult.companies && finalResult.companies.length > 0) {
    finalResult.companies = await enrichCompaniesWithStockData(finalResult.companies);
  }
  if (finalResult.watchPoolRanking && finalResult.watchPoolRanking.length > 0) {
    const enriched = await enrichCompaniesWithStockData(finalResult.watchPoolRanking);
    finalResult.watchPoolRanking = enriched;
  }

  // ── 组装最终输出 ──
  const result = {
    // 兼容前端渲染的事件概要
    eventSummary: {
      title: eventExtraction.eventTitle,
      coreEvent: eventExtraction.coreEvent,
      significance: eventExtraction.significance === '高' ? '重大事件，可能引发板块性行情' : '中等影响事件',
      eventDate: eventExtraction.eventDate,
    },
    // 市场状态
    marketState,
    // 事件抽取
    eventExtraction,
    // 产业链（兼容前端）
    supplyChain: {
      upstream: (supplyChain.upstream || []).map(s => typeof s === 'string' ? s : s.segment),
      midstream: (supplyChain.midstream || []).map(s => typeof s === 'string' ? s : s.segment),
      downstream: (supplyChain.downstream || []).map(s => typeof s === 'string' ? s : s.segment),
      coreSegment: supplyChain.coreSegment,
      rawSupplyChain: supplyChain,
    },
    // 真正受益环节（兼容前端）
    realBeneficiaryAnalysis: {
      coreSegment: supplyChain.coreSegment,
      reason: supplyChain.coreReason,
      barriers: supplyChain.barriers,
    },
    // 知识图谱推理
    knowledgeReasoning,
    // 历史回测
    historicalBacktest,
    // 公司列表（含行情）
    companies: finalResult.companies || [],
    // 证据链
    evidenceChain: finalResult.evidenceChain || { strong: [], medium: [], weak: [] },
    // ACK模型
    ackModelCheck: finalResult.ackModelCheck || {},
    // 财务查证
    financialChecks: finalResult.financialChecks || [],
    // 观察池（含行情）
    watchPoolRanking: finalResult.watchPoolRanking || [],
    // 下一步
    nextSteps: finalResult.nextSteps || [],
    // 风险
    risks: finalResult.risks || [],
    // 元信息
    meta: {
      pipeline: 'multi-stage-v2',
      stages: [
        'marketState',
        'eventExtraction',
        'supplyChain',
        'knowledgeReasoning',
        'stockVerification',
        'historicalBacktest',
        'finalScoring',
        'stockDataEnrichment',
      ],
      generatedAt: new Date().toISOString(),
    },
  };

  return { success: true, data: result };
}