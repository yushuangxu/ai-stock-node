export default async function (fastify) {
  fastify.get('/healthz', async () => {
    const metrics = fastify.getOpsSnapshot();
    return {
      status: 'ok',
      ts: new Date().toISOString(),
      services: {
        tradingReviewer: Boolean(fastify.tradingReviewer),
        tradingAgentV1: Boolean(fastify.tradingAgentV1),
      },
      ops: {
        rateLimitBackend: metrics.rateLimitBackend,
        redisConnected: metrics.redisConnected,
      },
    };
  });

  fastify.get('/metrics', async () => {
    return {
      success: true,
      metrics: fastify.getOpsSnapshot(),
    };
  });

  fastify.get('/metrics/prometheus', async (_request, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return fastify.getPrometheusMetrics();
  });
}
