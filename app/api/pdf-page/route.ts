import { chargeFree, checkFree, needKey } from "@/lib/quota";
import { APP_UA, TOGETHER_URL, usingCustomAI } from "@/lib/together";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * One PDF page the text layer cannot give us (a scan, an image of text, garbled
 * glyphs), read by a vision model into Markdown. Qwen3.8 Flash is the vision
 * model Together serves per request; the dedicated OCR models (GLM-OCR,
 * DeepSeek-OCR-2) need their own endpoint. Checked 2026-10-10.
 *
 * 引擎可插拔（设置页切换）：
 * - cloud（默认）：OpenAI 兼容视觉模型——地址/密钥/模型名来自浏览器三件套，
 *   回落 AI_VISION_* 环境变量，最后才是 Together
 * - local：本地 Indra OCR sidecar（免费离线，D:\shujia\indra-ocr）
 */
const MODEL = "Qwen/Qwen3.8-Flash";
const PRICE = { inPerM: 0.15, outPerM: 0.47 };
/**
 * mode "layout": a page whose text layer reads but whose layout came out
 * badly (columns, tables, maths), read again in the background
 * (lib/upgrade.ts). Qwen3.5-9B scored 6.9/10 on such pages in
 * scripts/pdf-eval against 3.9 for the text layer, at about $0.0005 a page.
 */
const LAYOUT_MODEL = "Qwen/Qwen3.5-9B";
const LAYOUT_PRICE = { inPerM: 0.17, outPerM: 0.25 };
const MAX_IMAGE_CHARS = 3_500_000;

const PROMPT = `Transcribe this document page into clean Markdown, in reading order.
- Multiple columns: the whole left column first, then the next.
- Keep each paragraph whole on one line; join words hyphenated across line breaks.
- # and ## for headings, - for list items, Markdown tables for tables.
- Leave out page numbers, running headers and footers.
- For a picture or chart, write its caption only, if it has one. Never write image links.
- Write only what is on the page. No commentary, no code fences around the whole.`;

const LAYOUT_PROMPT = `${PROMPT}
- Maths as LaTeX between $ signs, inline, or $$ on its own line for a displayed equation.
- Keep equation numbers such as (3) beside their equation.`;

/** Reasoning some models print into the answer, and fences some wrap it in. */
function clean(md: string): string {
  let t = md.replace(/<think>[\s\S]*?<\/think>/g, "");
  if (t.includes("</think>")) t = t.slice(t.lastIndexOf("</think>") + 8);
  return t
    .replace(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i, "$1")
    // Author marks written as LaTeX ($^{1,2}$, $^{\dagger}$) read better as plain text.
    .replace(/\$\^\{?([^}$]{1,24})\}?\$/g, (_, m: string) => m.replace(/\\dagger/g, "†").replace(/\\ddagger/g, "‡").replace(/\\ast|\*/g, "\\*"))
    .replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, "")
    .trim();
}

export async function POST(req: Request) {
  let body: { image?: string; apiKey?: string; mode?: string; engine?: string; baseUrl?: string; modelName?: string; apiKeyOverride?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const image = body.image ?? "";
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) return Response.json({ error: "Send the page as an image." }, { status: 400 });
  if (image.length > MAX_IMAGE_CHARS) return Response.json({ error: "That page image is too large." }, { status: 413 });

  const headerKey = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  const own = body.apiKey?.trim() || body.apiKeyOverride?.trim() || headerKey || undefined;
  // 引擎：local = 本地 Indra OCR sidecar（免费离线）；cloud（默认）= OpenAI 兼容视觉模型
  const engineLocal = body.engine === "local";
  const layout = body.mode === "layout";
  // 自定义服务的地址优先级：浏览器 > AI_VISION_BASE_URL > AI_BASE_URL；都没有则走 Together
  const customBase =
    body.baseUrl?.trim().replace(/\/+$/, "") ||
    process.env.AI_VISION_BASE_URL?.trim().replace(/\/+$/, "") ||
    process.env.AI_BASE_URL?.trim().replace(/\/+$/, "") ||
    "";
  const custom = Boolean(customBase) || Boolean(body.modelName?.trim()) || usingCustomAI();
  const model = body.modelName?.trim() || process.env.AI_VISION_MODEL?.trim() || (layout ? LAYOUT_MODEL : MODEL);
  const price = layout ? LAYOUT_PRICE : PRICE;
  let free: Awaited<ReturnType<typeof checkFree>> | null = null;
  if (!own && !engineLocal) {
    if (!custom && !process.env.TOGETHER_API_KEY) return needKey(null);
    if (!custom) {
      free = await checkFree(req, 90);
      if (!free.ok) return needKey(free);
    }
  }

  if (engineLocal) {
    // 本地 Indra OCR sidecar：页面图片进，Markdown 出，免费离线。
    // 没在跑就自动拉起（模型加载约 10-25 秒，之后常驻）。
    const indraUrl = process.env.INDRA_URL || "http://127.0.0.1:8898";
    const indraPy = process.env.INDRA_PY || "D:/shujia/indra-ocr/.venv/Scripts/python.exe";
    const indraSidecar = process.env.INDRA_SIDECAR || "D:/shujia/indra-ocr/sidecar.py";
    let up = false;
    try {
      up = (await fetch(`${indraUrl}/status`, { signal: AbortSignal.timeout(1500) })).ok;
    } catch {}
    if (!up && existsSync(indraPy) && existsSync(indraSidecar)) {
      spawn(indraPy, [indraSidecar], { cwd: "D:/shujia/indra-ocr", detached: true, windowsHide: true, stdio: "ignore" }).unref();
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          up = (await fetch(`${indraUrl}/status`, { signal: AbortSignal.timeout(1500) })).ok;
          if (up) break;
        } catch {}
      }
    }
    if (!up) return Response.json({ error: "本地 OCR sidecar 无法启动。" }, { status: 502 });
    try {
      const r = await fetch(`${indraUrl}/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
        signal: req.signal,
      });
      const j = (await r.json().catch(() => ({}))) as { markdown?: string; error?: string };
      if (!r.ok || !j.markdown) return Response.json({ error: j.error ?? "本地 OCR 未返回内容。" }, { status: 502 });
      return Response.json({ markdown: clean(String(j.markdown)) });
    } catch {
      return Response.json({ error: "本地 OCR 调用失败。" }, { status: 502 });
    }
  }

  const together = !customBase;
  const endpoint = together ? TOGETHER_URL : customBase.endsWith("/chat/completions") ? customBase : `${customBase}/chat/completions`;
  const keyHeader = own ?? (together ? process.env.TOGETHER_API_KEY : process.env.AI_VISION_API_KEY || process.env.AI_API_KEY) ?? "";

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      signal: req.signal,
      headers: { "Content-Type": "application/json", ...(keyHeader ? { Authorization: `Bearer ${keyHeader}` } : {}), "User-Agent": APP_UA },
      body: JSON.stringify({
        model,
        stream: true, // Qwen3.8 Flash only answers as a stream
        stream_options: { include_usage: true },
        temperature: 0,
        max_tokens: 4096,
        // Together 的思考开关是私有扩展，只在 Together 模式发送
        ...(together ? { chat_template_kwargs: { enable_thinking: false } } : {}),
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: image } }, { type: "text", text: layout ? LAYOUT_PROMPT : PROMPT }] }],
      }),
    });
  } catch {
    return Response.json({ error: "Could not reach the page reader." }, { status: 502 });
  }
  if (!res.ok || !res.body) {
    let msg = `The page reader answered ${res.status}.`;
    try {
      const j = (await res.json()) as { error?: { message?: string } | string };
      msg = typeof j.error === "string" ? j.error : j.error?.message ?? msg;
    } catch {}
    return Response.json({ error: msg }, { status: res.status === 401 || res.status === 429 ? res.status : 502 });
  }

  // Gather the stream: the content, and what it cost.
  let text = "";
  type Usage = { prompt_tokens?: number; completion_tokens?: number };
  let usage: Usage | null = null;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, "");
      if (!data || data === "[DONE]" || !line.trim().startsWith("data:")) continue;
      try {
        const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: Usage };
        text += j.choices?.[0]?.delta?.content ?? "";
        if (j.usage) usage = j.usage;
      } catch {}
    }
  }

  if (free) {
    const cost = ((usage?.prompt_tokens ?? 1900) * price.inPerM + (usage?.completion_tokens ?? 1000) * price.outPerM) / 1_000_000;
    await chargeFree(free.subject, cost);
  }
  return Response.json({ markdown: clean(text) });
}
