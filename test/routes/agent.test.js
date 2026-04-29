import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../helper.js';
import config from '../../config/index.js';

test('agent analyze validates empty query', async (t) => {
  const app = await build(t);
  const res = await app.inject({
    method: 'POST',
    url: '/agent/analyze',
    payload: { query: '' },
  });
  assert.equal(res.statusCode, 400);
});

test('agent analyze stream validates empty query', async (t) => {
  const app = await build(t);
  const res = await app.inject({
    method: 'POST',
    url: '/agent/analyze/stream',
    payload: { query: '' },
  });
  assert.equal(res.statusCode, 400);
});

test('agent analyze requires token when configured', async (t) => {
  const prev = config.ops.apiToken;
  config.ops.apiToken = 'test-token';
  t.after(() => {
    config.ops.apiToken = prev;
  });
  const app = await build(t);

  const res = await app.inject({
    method: 'POST',
    url: '/agent/analyze',
    payload: { query: '分析平安银行' },
  });
  assert.equal(res.statusCode, 401);
});
