import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../helper.js';

test('root route returns app metadata', async (t) => {
  const app = await build(t);
  const res = await app.inject({ url: '/' });
  const payload = JSON.parse(res.payload);

  assert.equal(res.statusCode, 200);
  assert.equal(payload.name, 'AI Trading Journal');
  assert.equal(payload.version, '1.0.0');
  assert.equal(typeof payload.endpoints, 'object');
  assert.equal(typeof payload.endpoints['POST /agent/analyze'], 'string');
});
