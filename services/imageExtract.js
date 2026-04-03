import config from '../config/index.js';

const VISION_SYSTEM =
  '你是证券截图识读助手，只根据用户提供的图片内容输出交易相关笔记，不要编造图中没有的信息。';

const MAX_B64_PER_IMAGE = 8_000_000;
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

function stripDataUrl(base64) {
  const s = String(base64 ?? '').trim();
  if (!s.startsWith('data:')) return s.replace(/\s/g, '');
  const m = s.match(/^data:image\/[\w+.-]+;base64,(.+)$/is);
  return m ? m[1].replace(/\s/g, '') : s.replace(/\s/g, '');
}

/**
 * @param {{ mimeType: string, base64: string }[]} images
 * @param {string} [userHint]
 * @returns {Promise<string>}
 */
export async function extractTradingNoteFromImages(images, userHint = '') {
  const apiKey = config.moonshot.apiKey;
  if (!apiKey) throw new Error('未配置 MOONSHOT_API_KEY');

  if (!Array.isArray(images) || !images.length) {
    throw new Error('请至少提供一张图片');
  }

  const model = config.moonshot.visionModel;
  const baseUrl = config.moonshot.baseUrl.replace(/\/$/, '');

  for (const img of images) {
    if (!ALLOWED_MIME.has(img.mimeType)) {
      throw new Error(`不支持的图片类型: ${img.mimeType}`);
    }
    const b64 = stripDataUrl(img.base64);
    if (!b64.length) throw new Error('图片数据为空');
    if (b64.length > MAX_B64_PER_IMAGE) {
      throw new Error('单张图片过大，请压缩后重试');
    }
  }

  const userContent = [
    ...images.map((img) => ({
      type: 'image_url',
      image_url: {
        url: `data:${img.mimeType};base64,${stripDataUrl(img.base64)}`,
      },
    })),
    {
      type: 'text',
      text:
        (String(userHint).trim()
          ? `用户已输入的文字说明（可与图片合并理解）：\n${String(userHint).trim()}\n\n`
          : '') +
        '请根据图片识别与A股交易、持仓、成交、资金相关的信息，整理为一段简洁的中文笔记。包含能看清的股票名称或代码、买卖方向、数量、价格、时间等。无法识别的内容请标注「未识别」。不要输出 Markdown 标题，纯文本即可。',
    },
  ];

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: VISION_SYSTEM },
        { role: 'user', content: userContent },
      ],
      max_tokens: 4096,
    }),
  });

  let json;
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (!res.ok) {
    const msg =
      json?.error?.message || json?.message || `视觉接口 HTTP ${res.status}`;
    throw new Error(msg);
  }
  const text = json?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('视觉模型未返回有效文本');
  return text;
}
