import { ChatOpenAI } from '@langchain/openai';
import config from '../config/index.js';

export function assertMoonshotApiKey() {
  if (!config.moonshot.apiKey) {
    throw new Error('请配置 MOONSHOT_API_KEY 环境变量（在 .env 文件中设置）');
  }
}

export function createMoonshotLlm({ temperature = 0.3, maxTokens = 4096 } = {}) {
  return new ChatOpenAI({
    modelName: config.moonshot.model,
    openAIApiKey: config.moonshot.apiKey,
    configuration: {
      baseURL: config.moonshot.baseUrl,
    },
    temperature,
    maxTokens,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isEngineOverloadedError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return (
    msg.includes('engine is currently overloaded') ||
    msg.includes('server is busy') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('503')
  );
}

export async function invokeWithRetry(llm, prompt, options = {}) {
  const {
    maxAttempts = 3,
    initialDelayMs = 800,
    backoffFactor = 2,
  } = options;

  let delay = initialDelayMs;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await llm.invoke(prompt);
    } catch (error) {
      lastError = error;
      const retryable = isEngineOverloadedError(error);
      if (!retryable || attempt === maxAttempts) break;
      await sleep(delay);
      delay *= backoffFactor;
    }
  }

  if (isEngineOverloadedError(lastError)) {
    throw new Error('模型服务繁忙，请稍后重试（已自动重试多次）');
  }
  throw lastError;
}
