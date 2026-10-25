/**
 * A painted cover for one text, on the server: the scene the classifier
 * wrote, as a two-colour risograph print in its topic's inks. The title is
 * never in the prompt, or the model letters it onto the picture.
 *
 * 图像生成同样可插拔：默认 Together 的 FLUX；设了 AI_IMAGE_MODEL（可选配
 * AI_IMAGE_BASE_URL / AI_IMAGE_API_KEY）就走自己的 OpenAI 兼容图像服务
 * （百炼通义万相、智谱 CogView、OpenAI 等都有 images/generations 端点）。
 * 浏览器「添加密钥」里的地址/密钥优先——与对话通道同一套三件套。
 */

import { shelfDef } from "./library";
import { APP_UA } from "./together";

const DEFAULT_MODEL = "black-forest-labs/FLUX.2-dev";
const SIZE = 640;
/**
 * What one cover costs, charged to the free allowance. FLUX.2 [dev] at 640px:
 * an estimate on the high side until Together's per-megapixel price is checked.
 * 自定义图像服务时成本随服务商，gloss 记 0。
 */
export const COVER_USD = 0.02;

const IMAGE_BASE = process.env.AI_IMAGE_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
const IMAGE_KEY = process.env.AI_IMAGE_API_KEY?.trim() ?? "";
const IMAGE_MODEL = process.env.AI_IMAGE_MODEL?.trim() ?? "";

export async function paintCover(req: {
  scene: string;
  topic: string;
  apiKey?: string;
  baseUrl?: string;
  /** 浏览器「添加密钥」里存的封面绘制模型——优先于 AI_IMAGE_MODEL 环境变量 */
  imageModel?: string;
  signal?: AbortSignal;
}): Promise<{ ok: true; jpeg: Uint8Array } | { ok: false; error: string }> {
  // 三件套的优先级：浏览器（添加密钥）> 服务端图像专用 env > Together 默认
  const browserBase = req.baseUrl?.trim().replace(/\/+$/, "") ?? "";
  const base = browserBase || IMAGE_BASE || "https://api.together.xyz";
  const isTogether = /together\.xyz/.test(base);
  const imageModel = req.imageModel?.trim() || IMAGE_MODEL || DEFAULT_MODEL;
  const key = browserBase
    ? req.apiKey?.trim() || ""
    : IMAGE_BASE
      ? IMAGE_KEY || req.apiKey?.trim() || ""
      : req.apiKey?.trim() || process.env.TOGETHER_API_KEY || "";
  if (!key && !isTogether) return { ok: false, error: "No API key for the image provider." };

  const prompt = `Editorial risograph print. ${req.scene.replace(/\.?$/, ".")} Two-colour palette of ${shelfDef(req.topic).inks} ink on warm cream paper filling the whole image, grain and halftone texture, mid-century book-cover illustration, wordless, no lettering, no border.`;
  let res: Response;
  try {
    res = await fetch(`${base}/images/generations`, {
      method: "POST",
      signal: req.signal,
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}), "User-Agent": APP_UA },
      // width/height 是 Together 的参数，size 是 OpenAI 兼容写法——两个都发，
      // 各家忽略不认识的字段；response_format 两家叫法不同（base64 / b64_json），
      // 解析端 b64_json 和 url 都接。
      body: JSON.stringify({
        model: imageModel,
        prompt,
        n: 1,
        width: SIZE,
        height: SIZE,
        size: `${SIZE}x${SIZE}`,
        response_format: isTogether ? "base64" : "b64_json",
        ...(isTogether ? { prompt_upsampling: false } : {}),
      }),
    });
  } catch (e) {
    return { ok: false, error: `Could not reach the image provider: ${String(e)}` };
  }
  const j = (await res.json().catch(() => ({}))) as {
    data?: { b64_json?: string; url?: string }[];
    error?: { message?: string };
    message?: string;
  };
  const first = j.data?.[0];
  let bytes: Uint8Array | null = null;
  if (first?.b64_json) bytes = Uint8Array.from(Buffer.from(first.b64_json, "base64"));
  else if (first?.url) {
    // 有的服务返回临时 URL（CogView 等），拉回来变成字节
    try {
      const img = await fetch(first.url, { signal: req.signal });
      if (img.ok) bytes = Uint8Array.from(Buffer.from(await img.arrayBuffer()));
    } catch {}
  }
  if (!res.ok || !bytes) {
    return { ok: false, error: j.error?.message ?? j.message ?? `The image provider answered ${res.status}.` };
  }
  return { ok: true, jpeg: bytes };
}
