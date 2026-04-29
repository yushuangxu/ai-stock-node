import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../helper.js';

test('ops healthz returns service readiness', async (t) => {
  const app = await build(t);
  const res = await app.inject({ method: 'GET', url: '/ops/healthz' });
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.payload);
  assert.equal(payload.status, 'ok');
  assert.equal(typeof payload.services, 'object');
  assert.equal(typeof payload.ops.rateLimitBackend, 'string');
});

test('ops metrics returns counters', async (t) => {
  const app = await build(t);
  const res = await app.inject({ method: 'GET', url: '/ops/metrics' });
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.payload);
  assert.equal(payload.success, true);
  assert.equal(typeof payload.metrics.requestsTotal, 'number');
  assert.equal(typeof payload.metrics.rateLimitBackend, 'string');
});

test('ops prometheus endpoint returns text metrics', async (t) => {
  const app = await build(t);
  const res = await app.inject({ method: 'GET', url: '/ops/metrics/prometheus' });
  assert.equal(res.statusCode, 200);
  assert.match(
    res.headers['content-type'],
    /text\/plain/,
  );
  assert.match(res.payload, /ai_stock_requests_total/);
  assert.match(res.payload, /ai_stock_rate_limit_backend/);
});
