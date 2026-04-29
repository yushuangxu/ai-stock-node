import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../helper.js';

test('example route is loaded', async (t) => {
  const app = await build(t);
  const res = await app.inject({ url: '/example' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload, 'this is an example');
});
