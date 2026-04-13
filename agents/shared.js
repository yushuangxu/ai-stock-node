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
