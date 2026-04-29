import fp from 'fastify-plugin';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import Redis from 'ioredis';
import config from '../config/index.js';

const rateBuckets = new Map();

function nowIso() {
  return new Date().toISOString();
}

function parseBearerToken(authHeader = '') {
  const text = String(authHeader || '').trim();
  const match = text.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function auditWrite(filePath, row) {
  try {
    const dir = path.dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf-8');
  } catch {
    // avoid breaking request flow due to audit io errors
  }
}

function hitRateLimit({ key, windowMs, max }) {
  const ts = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || ts - bucket.start >= windowMs) {
    rateBuckets.set(key, { start: ts, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}

async function hitRateLimitRedis({
  redis,
  prefix,
  key,
  windowMs,
  max,
}) {
  const slot = Math.floor(Date.now() / windowMs);
  const redisKey = `${prefix}:rate:${key}:${slot}`;
  const ttlSec = Math.max(1, Math.ceil((windowMs * 2) / 1000));
  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, ttlSec);
  }
  return count > max;
}

function formatPrometheusMetrics(counters, extras = {}) {
  const lines = [];
  lines.push('# HELP ai_stock_requests_total Total guarded requests');
  lines.push('# TYPE ai_stock_requests_total counter');
  lines.push(`ai_stock_requests_total ${counters.requestsTotal}`);
  lines.push('# HELP ai_stock_auth_failed_total Total auth failures');
  lines.push('# TYPE ai_stock_auth_failed_total counter');
  lines.push(`ai_stock_auth_failed_total ${counters.authFailed}`);
  lines.push('# HELP ai_stock_rate_limited_total Total rate limited requests');
  lines.push('# TYPE ai_stock_rate_limited_total counter');
  lines.push(`ai_stock_rate_limited_total ${counters.rateLimited}`);
  lines.push('# HELP ai_stock_stream_done_total Total completed streams');
  lines.push('# TYPE ai_stock_stream_done_total counter');
  lines.push(`ai_stock_stream_done_total ${counters.streamDone}`);
  lines.push('# HELP ai_stock_errors_total Total handled errors');
  lines.push('# TYPE ai_stock_errors_total counter');
  lines.push(`ai_stock_errors_total ${counters.errors}`);
  lines.push('# HELP ai_stock_uptime_seconds Service uptime in seconds');
  lines.push('# TYPE ai_stock_uptime_seconds gauge');
  lines.push(`ai_stock_uptime_seconds ${Math.round(process.uptime())}`);
  lines.push('# HELP ai_stock_rate_limit_backend Rate limit backend (1 redis, 0 memory)');
  lines.push('# TYPE ai_stock_rate_limit_backend gauge');
  lines.push(`ai_stock_rate_limit_backend ${extras.rateLimitBackend === 'redis' ? 1 : 0}`);
  return `${lines.join('\n')}\n`;
}

export default fp(
  async function (fastify) {
    const counters = {
      requestsTotal: 0,
      authFailed: 0,
      rateLimited: 0,
      streamDone: 0,
      errors: 0,
    };
    let redis = null;
    let rateLimitBackend = 'memory';

    if (config.ops.redisUrl) {
      try {
        redis = new Redis(config.ops.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableReadyCheck: true,
        });
        await redis.connect();
        rateLimitBackend = 'redis';
      } catch (error) {
        fastify.log.warn(`Redis not available, fallback to memory limiter: ${error.message}`);
        if (redis) {
          try {
            redis.disconnect();
          } catch {
            // ignore
          }
        }
        redis = null;
      }
    }

    fastify.decorate('opsCounters', counters);
    fastify.decorate('getOpsSnapshot', () => ({
      ...counters,
      uptimeSec: Math.round(process.uptime()),
      rateLimitBackend,
      redisConnected: Boolean(redis),
    }));
    fastify.decorate('getPrometheusMetrics', () =>
      formatPrometheusMetrics(counters, { rateLimitBackend }),
    );

    fastify.decorate('recordAuditLog', (row = {}) => {
      auditWrite(config.ops.auditLogFile, {
        ts: nowIso(),
        ...row,
      });
    });

    fastify.decorate('guardAgentAccess', async (request, reply, scope = 'default') => {
      counters.requestsTotal += 1;

      const expectedToken = String(config.ops.apiToken || '').trim();
      if (expectedToken) {
        const token = parseBearerToken(request.headers?.authorization || '');
        if (!token || token !== expectedToken) {
          counters.authFailed += 1;
          await reply.status(401).send({
            success: false,
            error: '未授权，请提供有效的 Bearer Token',
          });
          return false;
        }
      }

      const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown';
      const key = `${scope}:${ip}`;
      const windowMs = Math.max(1_000, config.ops.rateLimitWindowMs || 60_000);
      const max = Math.max(1, config.ops.rateLimitMax || 40);
      let isLimited = false;
      if (redis) {
        try {
          isLimited = await hitRateLimitRedis({
            redis,
            prefix: config.ops.redisPrefix || 'ai-stock-node',
            key,
            windowMs,
            max,
          });
        } catch {
          isLimited = hitRateLimit({ key, windowMs, max });
        }
      } else {
        isLimited = hitRateLimit({ key, windowMs, max });
      }
      if (isLimited) {
        counters.rateLimited += 1;
        await reply.status(429).send({
          success: false,
          error: '请求过于频繁，请稍后再试',
        });
        return false;
      }

      return true;
    });

    fastify.addHook('onClose', async () => {
      if (redis) {
        try {
          await redis.quit();
        } catch {
          redis.disconnect();
        }
      }
    });
  },
  { name: 'ops-guard' },
);
