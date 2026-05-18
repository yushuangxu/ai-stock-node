/**
 * 新闻/事件驱动选股分析智能体
 * 根据用户输入的新闻或事件，分析产业链、识别受益环节、筛选相关A股公司
 * 并自动拉取相关股票的实时行情数据
 */

import { createZhipuLlm, invokeWithRetry } from './shared.js';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { searchStocksByKeyword, getStockInfo, getKlineData } from '../services/eastmoney.js';

/**
 * 构建新闻分析的系统提示词
 */
function buildNewsAnalysisSystemPrompt() {
  return `你是一位专业的A股事件驱动选股分析师。你的任务是根据用户提供的新闻或事件，进行系统性的产业链分析和受益公司筛选。

## 分析框架

请严格按照以下结构输出你的分析结果（使用JSON格式）：

\`\`\`json
{
  "eventSummary": {
    "title": "事件标题（一句话概括）",
    "coreEvent": "核心事件描述",
    "significance": "事件意义（为什么重要）",
    "eventDate": "事件日期（如已知）"
  },
  "supplyChain": {
    "upstream": ["上游环节1", "上游环节2"],
    "midstream": ["中游环节1", "中游环节2"],
    "downstream": ["下游环节1", "下游环节2"],
    "coreSegment": "真正受益的核心环节"
  },
  "realBeneficiaryAnalysis": {
    "coreSegment": "真正受益环节描述",
    "reason": "为什么这个环节真正受益",
    "barriers": "技术壁垒和竞争护城河"
  },
  "companies": [
    {
      "name": "公司名称（A股简称）",
      "code": "股票代码（6位数字，如不确定填空字符串）",
      "category": "新闻直接点名|知识库强匹配|行业业务相关|延伸受益",
      "tradeType": "A类产业埋伏型|B类趋势核心型|C类情绪妖股型",
      "role": "在事件中的角色",
      "logic": "关联逻辑说明",
      "evidenceStrength": "强|中|弱",
      "watchPoolGrade": "S|A|B|C",
      "keyPoints": ["待查证事项1", "待查证事项2"]
    }
  ],
  "evidenceChain": {
    "strong": ["强证据1", "强证据2"],
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
  "financialChecks": ["需要查证的财务/估值事项1", "需要查证的事项2"],
  "watchPoolRanking": [
    { "name": "公司名", "code": "代码", "grade": "S|A|B|C", "reason": "评级理由" }
  ],
  "nextSteps": ["下一步跟踪事项1", "下一步跟踪事项2"],
  "risks": ["风险提示1", "风险提示2"]
}
\`\`\`

## 公司筛选原则

1. **新闻直接点名主体**：新闻原文中直接提到的公司，优先列出
2. **知识库强匹配候选**：根据新闻关键词（如平台名称、项目名称、技术方向）匹配A股公司的公开业务案例
3. **行业业务相关候选**：根据事件所属产业链，匹配业务方向相关的A股公司
4. **延伸受益候选**：通过产业链传导逻辑，筛选间接受益的公司

## 评级标准

- **S级**：逻辑清晰、预期差大、有真实业务映射、证据链强
- **A级**：逻辑清晰、有一定预期差、有业务关联
- **B级**：受益逻辑直接但非核心环节，或行业龙头但缺乏本次催化直接证据
- **C级**：逻辑较弱、概念联想为主、需更多证据

## 交易类型说明

- **A类产业埋伏型**：产业趋势确定，公司处于核心环节，适合提前埋伏
- **B类趋势核心型**：已有明确趋势，公司是行业核心标的
- **C类情绪妖股型**：主要受情绪驱动，基本面支撑较弱

## 输出要求

1. 必须基于事实和公开信息进行分析，不要编造数据
2. 对于不确定的信息，明确标注"待查证"
3. 公司筛选要覆盖上游、中游、下游全产业链
4. 重点关注A股上市公司，尽量给出准确的股票简称和6位代码
5. 风险提示要具体，不要泛泛而谈
6. 如果新闻中提到具体平台/项目名称，务必尝试匹配相关的技术服务商
7. 公司名称请使用A股标准简称，方便后续匹配实时行情

请确保输出合法的JSON格式，不要添加多余的文字说明。`;
}

/**
 * 解析LLM响应文本为JSON对象
 */
function parseLlmJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1].trim());
    }
    return null;
  }
}

/**
 * 根据LLM分析出的公司列表，拉取实时行情数据
 * @param {Array} companies - LLM返回的公司列表
 * @returns {Promise<Array>} 带实时行情的公司列表
 */
async function enrichCompaniesWithStockData(companies) {
  if (!Array.isArray(companies) || companies.length === 0) return companies;

  const enriched = [];

  for (const company of companies) {
    const entry = { ...company, stockData: null };

    try {
      let stockCode = company.code || '';

      // 如果没有代码，通过公司名称搜索
      if (!stockCode && company.name) {
        const searchResults = await searchStocksByKeyword(company.name, 3);
        if (searchResults.length > 0) {
          stockCode = searchResults[0].code;
          // 如果原名称不精确，使用搜索到的标准名称
          if (searchResults[0].name) {
            entry.name = searchResults[0].name;
          }
        }
      }

      // 如果有代码，获取详细行情
      if (stockCode && /^\d{6}$/.test(stockCode)) {
        entry.code = stockCode;

        try {
          const [stockInfo, klineData] = await Promise.allSettled([
            getStockInfo(stockCode),
            getKlineData(stockCode, 30),
          ]);

          if (stockInfo.status === 'fulfilled') {
            entry.stockData = {
              price: stockInfo.value.price,
              changePct: stockInfo.value.changePct,
              pe: stockInfo.value.pe,
              pb: stockInfo.value.pb,
              totalMarketCap: stockInfo.value.totalMarketCap,
              totalMarketCapStr: stockInfo.value.totalMarketCapStr,
              floatMarketCap: stockInfo.value.floatMarketCap,
              floatMarketCapStr: stockInfo.value.floatMarketCapStr,
              turnoverRate: stockInfo.value.turnoverRate,
              volumeRatio: stockInfo.value.volumeRatio,
              high: stockInfo.value.high,
              low: stockInfo.value.low,
              open: stockInfo.value.open,
              volume: stockInfo.value.volume,
            };
          }

          // 提取近N日涨跌幅
          if (klineData.status === 'fulfilled' && klineData.value.klines.length > 0) {
            const klines = klineData.value.klines;
            const latestKlines = klines.slice(-Math.min(5, klines.length));
            entry.stockData = entry.stockData || {};
            entry.stockData.recentKlines = latestKlines.map((k) => ({
              date: k.date,
              close: k.close,
              changePct: k.changePct,
              volume: k.volume,
            }));

            // 计算近期涨幅
            if (klines.length >= 2) {
              const latest = klines[klines.length - 1].close;
              const prev5 = klines[Math.max(0, klines.length - 5)].close;
              const prev20 = klines[Math.max(0, klines.length - 20)].close;
              entry.stockData.priceChange5d = +((latest - prev5) / prev5 * 100).toFixed(2);
              entry.stockData.priceChange20d = +((latest - prev20) / prev20 * 100).toFixed(2);
            }
          }
        } catch (err) {
          console.warn(`[newsAnalyst] 获取 ${stockCode} 行情失败:`, err.message);
        }
      }
    } catch (err) {
      console.warn(`[newsAnalyst] 处理公司 ${company.name} 时出错:`, err.message);
    }

    enriched.push(entry);
  }

  return enriched;
}

/**
 * 分析新闻/事件
 * @param {string} newsContent - 新闻内容
 * @returns {Promise<object>} 分析结果（含实时行情）
 */
export async function analyzeNews(newsContent) {
  const llm = createZhipuLlm({ temperature: 0.3, maxTokens: 8192 });

  const systemPrompt = buildNewsAnalysisSystemPrompt();
  const userPrompt = `请分析以下新闻/事件，筛选出最相关的A股受益公司：\n\n---\n${newsContent}\n---\n\n请按照分析框架输出JSON格式的分析结果。务必给出准确的A股简称和6位股票代码。`;

  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ];

  try {
    const response = await invokeWithRetry(llm, messages);
    const text = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    // 尝试从响应中提取JSON
    let result = parseLlmJson(text);
    if (!result) {
      result = { rawResponse: text, parseError: true };
      return { success: true, data: result };
    }

    // ===== 第二步：拉取实时行情数据 =====
    if (result.companies && Array.isArray(result.companies)) {
      console.log(`[newsAnalyst] 正在获取 ${result.companies.length} 家公司的实时行情...`);
      result.companies = await enrichCompaniesWithStockData(result.companies);
    }

    // 同样为 watchPoolRanking 补充行情
    if (result.watchPoolRanking && Array.isArray(result.watchPoolRanking)) {
      console.log(`[newsAnalyst] 正在获取观察池排名公司的实时行情...`);
      result.watchPoolRanking = await enrichCompaniesWithStockData(result.watchPoolRanking);
    }

    return { success: true, data: result };
  } catch (error) {
    console.error('[newsAnalyst] 分析失败:', error);
    return { success: false, error: error.message };
  }
}