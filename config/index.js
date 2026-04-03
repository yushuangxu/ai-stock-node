import 'dotenv/config';

const config = {
  moonshot: {
    apiKey: process.env.MOONSHOT_API_KEY || '',
    baseUrl: process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1',
    model: process.env.MOONSHOT_MODEL || 'moonshot-v1-32k',
    /** 用于截图识读；需支持视觉的模型，如 kimi-k2.5、moonshot-v1-32k-vision-preview */
    visionModel: process.env.MOONSHOT_VISION_MODEL || 'kimi-k2.5',
  },
};

export default config;
