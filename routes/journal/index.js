import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { extractTradingNoteFromImages } from '../../services/imageExtract.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const SESSION_MEMORY = new Map();
const MAX_SESSION_TURNS = 10;
const MEMORY_FILE = process.env.SESSION_MEMORY_FILE
  ? path.resolve(process.env.SESSION_MEMORY_FILE)
  : path.resolve(process.cwd(), 'data', 'session-memory.json');

function loadSessionMemory() {
  try {
    if (!existsSync(MEMORY_FILE)) return;
    const text = readFileSync(MEMORY_FILE, 'utf-8');
    if (!text.trim()) return;
    const json = JSON.parse(text);
    if (!json || typeof json !== 'object') return;
    for (const [key, value] of Object.entries(json)) {
      if (Array.isArray(value)) {
        SESSION_MEMORY.set(key, value);
      }
    }
  } catch {
    // ignore damaged file and continue with memory map
  }
}

function persistSessionMemory() {
  try {
    const dir = path.dirname(MEMORY_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const obj = Object.fromEntries(SESSION_MEMORY);
    writeFileSync(MEMORY_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch {
    // ignore persistence errors to avoid breaking main flow
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('复盘超时，请稍后重试')), ms),
    ),
  ]);
}

function buildChatHistory(history = []) {
  return history
    .filter((m) => m.role && m.content)
    .map((m) =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
    );
}

const journalBodySchema = {
  type: 'object',
  properties: {
    sessionId: { type: 'string', default: '' },
    content: { type: 'string', default: '' },
    images: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        required: ['mimeType', 'base64'],
        properties: {
          mimeType: {
            type: 'string',
            enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
          },
          base64: { type: 'string' },
        },
      },
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

function parseJournalBody(body) {
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const content = typeof body.content === 'string' ? body.content : '';
  const images = Array.isArray(body.images) ? body.images : [];
  const history = Array.isArray(body.history) ? body.history : [];
  const text = content.trim();
  if (!text && !images.length) {
    return {
      error: '请填写交易说明文字，或上传至少一张截图（也可图文一起提交）',
    };
  }
  return { sessionId, content: text, images, history };
}

function getSessionHistory(sessionId) {
  if (!sessionId) return [];
  const list = SESSION_MEMORY.get(sessionId);
  return Array.isArray(list) ? list : [];
}

function mergeHistory(sessionId, requestHistory = []) {
  if (Array.isArray(requestHistory) && requestHistory.length) return requestHistory;
  return getSessionHistory(sessionId);
}

function appendSessionTurn(sessionId, userContent, assistantContent) {
  if (!sessionId) return;
  const current = getSessionHistory(sessionId);
  const next = [
    ...current,
    { role: 'user', content: userContent },
    { role: 'assistant', content: assistantContent },
  ];
  const keep = next.slice(-MAX_SESSION_TURNS * 2);
  SESSION_MEMORY.set(sessionId, keep);
  persistSessionMemory();
}

async function buildReviewInput({ content, images }) {
  if (!images?.length) return content;
  const extracted = await extractTradingNoteFromImages(images, content);
  if (!content.trim()) return extracted;
  return `${content}\n\n---\n【图片识别摘录】\n${extracted}`;
}

export default async function (fastify) {
  loadSessionMemory();

  fastify.post(
    '/review',
    {
      schema: {
        body: journalBodySchema,
      },
    },
    async (request, reply) => {
      if (!(await fastify.guardAgentAccess(request, reply, 'journal_review'))) return;

      const parsed = parseJournalBody(request.body);
      if (parsed.error) {
        return reply.status(400).send({ success: false, error: parsed.error });
      }

      if (!fastify.tradingReviewer) {
        return reply.status(503).send({
          success: false,
          error: '复盘服务未就绪，请检查 MOONSHOT_API_KEY 配置',
        });
      }

      let input;
      try {
        input = await buildReviewInput(parsed);
      } catch (err) {
        fastify.log.error(err);
        return reply.status(502).send({
          success: false,
          error: err.message || '图片识别失败，请检查 MOONSHOT_VISION_MODEL 是否支持视觉',
        });
      }

      try {
        const mergedHistory = mergeHistory(parsed.sessionId, parsed.history);
        const chat_history = buildChatHistory(mergedHistory);
        const result = await withTimeout(
          fastify.tradingReviewer.invoke({ input, chat_history }),
          180_000,
        );
        appendSessionTurn(parsed.sessionId, input, result.output);
        fastify.recordAuditLog({
          scope: 'journal.review',
          sessionId: parsed.sessionId,
          ok: true,
          input_size: input.length,
          output_size: String(result.output || '').length,
        });
        return { success: true, review: result.output };
      } catch (error) {
        fastify.log.error(error);
        fastify.opsCounters.errors += 1;
        fastify.recordAuditLog({
          scope: 'journal.review',
          sessionId: parsed.sessionId,
          ok: false,
          error: error.message || 'review_error',
        });
        return reply.status(500).send({
          success: false,
          error: error.message || '复盘过程中发生错误',
        });
      }
    },
  );

  fastify.post(
    '/review/stream',
    {
      schema: {
        body: journalBodySchema,
      },
    },
    async (request, reply) => {
      if (!(await fastify.guardAgentAccess(request, reply, 'journal_review_stream'))) return;

      const parsed = parseJournalBody(request.body);
      if (parsed.error) {
        return reply.status(400).send({
          success: false,
          error: parsed.error,
        });
      }

      if (!fastify.tradingReviewer) {
        return reply.status(503).send({
          success: false,
          error: '复盘服务未就绪，请检查 MOONSHOT_API_KEY 配置',
        });
      }

      let input;
      try {
        input = await buildReviewInput(parsed);
      } catch (err) {
        fastify.log.error(err);
        return reply.status(502).send({
          success: false,
          error: err.message || '图片识别失败，请检查 MOONSHOT_VISION_MODEL 是否支持视觉',
        });
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      reply.raw.write(`data: ${JSON.stringify({ type: 'start' })}\n\n`);

      try {
        const mergedHistory = mergeHistory(parsed.sessionId, parsed.history);
        const chat_history = buildChatHistory(mergedHistory);
        const eventStream = fastify.tradingReviewer.streamEvents(
          { input, chat_history },
          { version: 'v2' },
        );
        const iterator = eventStream[Symbol.asyncIterator]();

        let tokenBuffer = [];
        let finalOutput = '';

        const flushBuffer = () => {
          for (const t of tokenBuffer) {
            reply.raw.write(
              `data: ${JSON.stringify({ type: 'token', content: t })}\n\n`,
            );
          }
          tokenBuffer = [];
        };

        while (true) {
          const { value: event, done } = await withTimeout(
            iterator.next(),
            180_000,
          );
          if (done) break;

          if (event.event === 'on_tool_start') {
            tokenBuffer = [];
            const toolName = event.name || '';
            const msg = { type: 'tool_start', tool: toolName };
            reply.raw.write(`data: ${JSON.stringify(msg)}\n\n`);
          } else if (event.event === 'on_tool_end') {
            const msg = { type: 'tool_end', tool: event.name || '' };
            reply.raw.write(`data: ${JSON.stringify(msg)}\n\n`);
          } else if (event.event === 'on_chat_model_stream') {
            const chunk = event.data?.chunk?.content;
            if (chunk) {
              tokenBuffer.push(chunk);
              finalOutput += chunk;
            }
          } else if (event.event === 'on_chat_model_end') {
            const msg = event.data?.output;
            if (typeof msg?.content === 'string' && msg.content.trim()) {
              finalOutput = msg.content;
            }
            const hasCalls =
              msg?.tool_calls?.length > 0 ||
              msg?.additional_kwargs?.tool_calls?.length > 0;
            if (hasCalls) {
              tokenBuffer = [];
            } else {
              flushBuffer();
            }
          }
        }

        flushBuffer();
        appendSessionTurn(parsed.sessionId, input, finalOutput);
        fastify.opsCounters.streamDone += 1;
        fastify.recordAuditLog({
          scope: 'journal.review.stream',
          sessionId: parsed.sessionId,
          ok: true,
          input_size: input.length,
          output_size: finalOutput.length,
        });
        reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      } catch (error) {
        fastify.opsCounters.errors += 1;
        fastify.recordAuditLog({
          scope: 'journal.review.stream',
          sessionId: parsed.sessionId,
          ok: false,
          error: error.message || 'review_stream_error',
        });
        reply.raw.write(
          `data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`,
        );
      }

      reply.raw.end();
    },
  );
}
