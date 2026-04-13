import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { extractTradingNoteFromImages } from '../../services/imageExtract.js';

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
  const content = typeof body.content === 'string' ? body.content : '';
  const images = Array.isArray(body.images) ? body.images : [];
  const history = Array.isArray(body.history) ? body.history : [];
  const text = content.trim();
  if (!text && !images.length) {
    return {
      error: '请填写交易说明文字，或上传至少一张截图（也可图文一起提交）',
    };
  }
  return { content: text, images, history };
}

async function buildReviewInput({ content, images }) {
  if (!images?.length) return content;
  const extracted = await extractTradingNoteFromImages(images, content);
  if (!content.trim()) return extracted;
  return `${content}\n\n---\n【图片识别摘录】\n${extracted}`;
}

export default async function (fastify) {
  fastify.post(
    '/review',
    {
      schema: {
        body: journalBodySchema,
      },
    },
    async (request, reply) => {
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
        const chat_history = buildChatHistory(parsed.history);
        const result = await withTimeout(
          fastify.tradingReviewer.invoke({ input, chat_history }),
          180_000,
        );
        return { success: true, review: result.output };
      } catch (error) {
        fastify.log.error(error);
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
        const chat_history = buildChatHistory(parsed.history);
        const eventStream = fastify.tradingReviewer.streamEvents(
          { input, chat_history },
          { version: 'v2' },
        );
        const iterator = eventStream[Symbol.asyncIterator]();

        let tokenBuffer = [];

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
            }
          } else if (event.event === 'on_chat_model_end') {
            const msg = event.data?.output;
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
        reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      } catch (error) {
        reply.raw.write(
          `data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`,
        );
      }

      reply.raw.end();
    },
  );
}
