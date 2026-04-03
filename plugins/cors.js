import fp from 'fastify-plugin';
import cors from '@fastify/cors';

export default fp(async function (fastify) {
  fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });
});
