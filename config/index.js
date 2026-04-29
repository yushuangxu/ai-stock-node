import 'dotenv/config';

const config = {
  moonshot: {
    apiKey: process.env.MOONSHOT_API_KEY || '',
    baseUrl: process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1',
    model: process.env.MOONSHOT_MODEL || 'moonshot-v1-32k',
    /** 用于截图识读；需支持视觉的模型，如 kimi-k2.5、moonshot-v1-32k-vision-preview */
    visionModel: process.env.MOONSHOT_VISION_MODEL || 'kimi-k2.5',
  },
  session: {
    /** 本地会话记忆落盘文件，可挂载到 docker volume 防止重启丢失 */
    memoryFile: process.env.SESSION_MEMORY_FILE || './data/session-memory.json',
  },
  ops: {
    /** 可选：配置后，/agent 与 /journal 接口需携带 Bearer Token */
    apiToken: process.env.AGENT_API_TOKEN || '',
    /** 限流窗口（毫秒） */
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    /** 每个 IP+scope 在窗口内最大请求次数 */
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 40),
    /** 审计日志文件（NDJSON） */
    auditLogFile: process.env.AUDIT_LOG_FILE || './data/audit-log.ndjson',
    /** 可选：Redis 连接串，配置后使用 Redis 做分布式限流 */
    redisUrl: process.env.REDIS_URL || '',
    /** Redis key 前缀 */
    redisPrefix: process.env.REDIS_PREFIX || 'ai-stock-node',
  },
};

export default config;
