export default async function (fastify) {
  fastify.get('/', async function () {
    return {
      name: 'AI Trading Journal',
      version: '1.0.0',
      description: '交易复盘笔记系统',
      endpoints: {
        'POST /journal/review': '提交交易笔记进行AI复盘（可选 images[] 截图，先视觉识读再复盘）',
        'POST /journal/review/stream': 'SSE 流式复盘（body 同 review，支持 images）',
      },
    };
  });
}
