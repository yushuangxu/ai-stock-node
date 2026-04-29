import { createSessionMemoryStore } from '../../modules/sessionMemory.js';
import { buildAssistantSessionContent } from '../../modules/replyFormat.js';

const bodySchema = {
  type: 'object',
  required: ['query'],
  properties: {
    sessionId: { type: 'string', default: '' },
    query: { type: 'string', minLength: 1 },
    task: {
      type: 'string',
      enum: ['full_analysis', 'quick_check'],
      default: 'full_analysis',
    },
    history: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string' },
          content: { type: 'string' },
        },
      },
      default: [],
    },
  },
};

function parseBody(body = {}) {
  return {
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.trim() : '',
    query: typeof body.query === 'string' ? body.query.trim() : '',
    task: body.task === 'quick_check' ? 'quick_check' : 'full_analysis',
    history: Array.isArray(body.history) ? body.history : [],
  };
}

export default async function (fastify) {
  const sessionStore = createSessionMemoryStore({
    memoryFile: process.env.AGENT_SESSION_MEMORY_FILE || process.env.SESSION_MEMORY_FILE,
    maxTurns: 8,
  });

  fastify.post(
    '/analyze',
    {
      schema: {
        body: bodySchema,
      },
    },
    async (request, reply) => {
      if (!(await fastify.guardAgentAccess(request, reply, 'agent_analyze'))) return;

      if (!fastify.tradingAgentV1) {
        return reply.status(503).send({
          success: false,
          error: '智能体服务未就绪，请检查 MOONSHOT_API_KEY 配置',
        });
      }

      const { sessionId, query, task, history } = parseBody(request.body);
      if (!query) {
        return reply.status(400).send({
          success: false,
          error: 'query 不能为空',
        });
      }

      try {
        const mergedHistory = sessionStore.mergeHistory(sessionId, history);
        const data = await fastify.tradingAgentV1.analyze({ query, task, history: mergedHistory });
        const assistantTurn = buildAssistantSessionContent({
          analysis: data.analysis,
          decision: data.decision,
        });
        sessionStore.appendTurn(sessionId, query, assistantTurn);
        fastify.recordAuditLog({
          scope: 'agent.analyze',
          sessionId,
          task,
          query_preview: query.slice(0, 80),
          ok: true,
          action: data?.decision?.action || '',
          confidence: data?.decision?.confidence ?? null,
        });
        return { success: true, data };
      } catch (error) {
        fastify.log.error(error);
        fastify.opsCounters.errors += 1;
        fastify.recordAuditLog({
          scope: 'agent.analyze',
          sessionId,
          task,
          ok: false,
          error: error.message || 'unknown_error',
        });
        return reply.status(500).send({
          success: false,
          error: error.message || '智能体分析失败',
        });
      }
    },
  );

  fastify.post(
    '/analyze/stream',
    {
      schema: {
        body: bodySchema,
      },
    },
    async (request, reply) => {
      if (!(await fastify.guardAgentAccess(request, reply, 'agent_analyze_stream'))) return;

      if (!fastify.tradingAgentV1) {
        return reply.status(503).send({
          success: false,
          error: '智能体服务未就绪，请检查 MOONSHOT_API_KEY 配置',
        });
      }

      const { sessionId, query, task, history } = parseBody(request.body);
      if (!query) {
        return reply.status(400).send({
          success: false,
          error: 'query 不能为空',
        });
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      reply.raw.write(`data: ${JSON.stringify({ type: 'start' })}\n\n`);

      const mergedHistory = sessionStore.mergeHistory(sessionId, history);
      let finalOutput = '';
      let donePayload = null;
      try {
        const stream = fastify.tradingAgentV1.streamEvents({
          query,
          task,
          history: mergedHistory,
        });
        const iterator = stream[Symbol.asyncIterator]();

        while (true) {
          const { value: event, done } = await iterator.next();
          if (done) break;

          if (event.event === 'on_tool_start') {
            reply.raw.write(
              `data: ${JSON.stringify({ type: 'tool_start', tool: event.name || '' })}\n\n`,
            );
          } else if (event.event === 'on_tool_end') {
            reply.raw.write(
              `data: ${JSON.stringify({ type: 'tool_end', tool: event.name || '' })}\n\n`,
            );
          } else if (event.event === 'on_stage') {
            reply.raw.write(
              `data: ${JSON.stringify({ type: 'stage', stage: event.name || '', data: event.data || {} })}\n\n`,
            );
          } else if (event.event === 'on_chat_model_stream') {
            const chunk = event?.data?.chunk?.content;
            if (chunk) {
              finalOutput += chunk;
              reply.raw.write(
                `data: ${JSON.stringify({ type: 'token', content: chunk })}\n\n`,
              );
            }
          } else if (event.event === 'on_chat_model_end') {
            const fullText = event?.data?.output?.content;
            if (typeof fullText === 'string' && fullText.trim()) {
              finalOutput = fullText;
            }
            donePayload = event?.data?.result || null;
          }
        }

        sessionStore.appendTurn(sessionId, query, finalOutput);
        fastify.opsCounters.streamDone += 1;
        fastify.recordAuditLog({
          scope: 'agent.analyze.stream',
          sessionId,
          task,
          query_preview: query.slice(0, 80),
          ok: true,
          output_size: finalOutput.length,
          action: donePayload?.decision?.action || '',
          confidence: donePayload?.decision?.confidence ?? null,
          triggered_rules:
            donePayload?.meta?.rule_meta?.triggeredRules || [],
        });
        reply.raw.write(
          `data: ${JSON.stringify({ type: 'done', data: donePayload || {} })}\n\n`,
        );
      } catch (error) {
        fastify.log.error(error);
        fastify.opsCounters.errors += 1;
        fastify.recordAuditLog({
          scope: 'agent.analyze.stream',
          sessionId,
          task,
          ok: false,
          error: error.message || 'stream_error',
        });
        reply.raw.write(
          `data: ${JSON.stringify({ type: 'error', message: error.message || '流式分析失败' })}\n\n`,
        );
      }

      reply.raw.end();
    },
  );
}
