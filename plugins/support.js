import fp from 'fastify-plugin';

export default fp(async function (fastify) {
  fastify.decorate('someSupport', function () {
    return 'hugs';
  });
});
