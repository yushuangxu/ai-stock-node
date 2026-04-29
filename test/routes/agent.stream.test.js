import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Fastify from 'fastify';
import agentRoutes from '../../routes/agent/index.js';

test('agent stream done event carries structured payload', async () => {
  const fastify = Fastify();
  const previousMemoryFile = process.env.AGENT_SESSION_MEMORY_FILE;
  const memoryFile = path.join(
    os.tmpdir(),
    `ai-stock-agent-stream-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  process.env.AGENT_SESSION_MEMORY_FILE = memoryFile;

  fastify.decorate('tradingAgentV1', {
    async *streamEvents() {
      yield { event: 'on_stage', name: 'rule_checked', data: { triggeredRules: ['low_confidence_watch'] } };
      yield { event: 'on_chat_model_stream', data: { chunk: { content: 'token-1' } } };
      yield {
        event: 'on_chat_model_end',
        data: {
          output: { content: 'final-output', tool_calls: [] },
          result: {
            decision: { action: 'watch', confidence: 40, reasons: [], risks: [], plan: {} },
            meta: { rule_meta: { triggeredRules: ['low_confidence_watch'] } },
          },
        },
      };
    },
  });
  fastify.decorate('guardAgentAccess', async () => true);
  fastify.decorate('recordAuditLog', () => {});
  fastify.decorate('opsCounters', {
    requestsTotal: 0,
    authFailed: 0,
    rateLimited: 0,
    streamDone: 0,
    errors: 0,
  });

  fastify.register(agentRoutes, { prefix: '/agent' });
  await fastify.ready();

  const res = await fastify.inject({
    method: 'POST',
    url: '/agent/analyze/stream',
    payload: { query: '测试', task: 'quick_check' },
  });

  assert.equal(res.statusCode, 200);
  assert.match(res.payload, /"type":"stage","stage":"rule_checked"/);
  assert.match(res.payload, /"type":"done","data":\{"decision"/);
  assert.match(res.payload, /"triggeredRules":\["low_confidence_watch"\]/);

  await fastify.close();
  rmSync(memoryFile, { force: true });
  if (typeof previousMemoryFile === 'string') {
    process.env.AGENT_SESSION_MEMORY_FILE = previousMemoryFile;
  } else {
    delete process.env.AGENT_SESSION_MEMORY_FILE;
  }
});
