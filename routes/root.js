export default async function (fastify) {
  fastify.get('/', async function () {
    return {
      name: 'AI Trading Journal',
      version: '1.0.0',
      description: '交易复盘笔记系统',
      endpoints: {
        'GET /ops/healthz': '服务健康检查',
        'GET /ops/metrics': '运行指标统计',
        'GET /ops/metrics/prometheus': 'Prometheus 文本指标',
        'POST /agent/analyze': '股票智能体第一版分析入口（技术分析 + 决策建议）',
        'POST /agent/analyze/stream': '股票智能体流式分析入口（SSE）',
        'POST /journal/review': '提交交易笔记进行AI复盘（可选 images[] 截图，先视觉识读再复盘）',
        'POST /journal/review/stream': 'SSE 流式复盘（body 同 review，支持 images）',
      },
    };
  });
}
