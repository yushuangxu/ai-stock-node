import fp from 'fastify-plugin';
import { createTradingReviewer } from '../main.js';
import { createTradingAgentV1 } from '../agents/tradingAgentV1.js';

export default fp(
  async function (fastify) {
    try {
      const tradingReviewer = createTradingReviewer();
      fastify.decorate('tradingReviewer', tradingReviewer);
      fastify.log.info('Trading reviewer agent initialized');
    } catch (err) {
      fastify.log.warn(`Agent initialization skipped: ${err.message}`);
      fastify.decorate('tradingReviewer', null);
    }

    try {
      const tradingAgentV1 = createTradingAgentV1();
      fastify.decorate('tradingAgentV1', tradingAgentV1);
      fastify.log.info('Trading agent v1 initialized');
    } catch (err) {
      fastify.log.warn(`Trading agent v1 initialization skipped: ${err.message}`);
      fastify.decorate('tradingAgentV1', null);
    }
  },
  { name: 'trading-reviewer-agent' },
);
