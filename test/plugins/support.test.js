import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import Support from '../../plugins/support.js';

test('support works standalone', async () => {
  const fastify = Fastify();
  fastify.register(Support);
  await fastify.ready();
  assert.equal(fastify.someSupport(), 'hugs');
  await fastify.close();
});
