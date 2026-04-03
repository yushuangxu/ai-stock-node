import fp from 'fastify-plugin';
import { createTradingReviewer } from '../agents/tradingReviewer.js';

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
  },
  { name: 'trading-reviewer-agent' },
);
