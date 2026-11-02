import { completeJSON, DEFAULT_MODEL, isModelKey, usingCustomAI } from "@/lib/together";
import { chargeFree, checkFree, estimateUsd, needKey } from "@/lib/quota";
import { undash } from "@/lib/article";
import { MODELS } from "@/lib/models";
import type { DocPayload } from "@/lib/prompts";

export const runtime = "nodejs";
export const maxDuration = 300;

type Body = {
  apiKey?: string;
  model?: string;
  modelName?: string;
  baseUrl?: string;
  /** The reader's interface language; the translation target. */
  lang?: string;
  doc?: DocPayload;
};

/**
 * Whole-article, paragraph-by-paragraph translation. The client sends a chunk
 * of paragraphs and gets their translations back keyed by paragraph number;
 * chunking keeps one call inside the model's output budget on long texts.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const doc = body.doc;
  if (!doc?.title || !Array.isArray(doc.paras) || doc.paras.length === 0) {
    return Response.json({ error: "doc is required." }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim() || undefined;
  // Translation spends from the same free allowance as a gloss.
  let free: Awaited<ReturnType<typeof checkFree>> | null = null;
  if (!apiKey) {
    if (!usingCustomAI() && !process.env.TOGETHER_API_KEY) return needKey(null);
    if (!usingCustomAI()) {
      free = await checkFree(req);
      if (!free.ok) return needKey(free);
    }
  }

  const target = body.lang === "en" ? "English" : "Simplified Chinese";
  const model = isModelKey(body.model) ? body.model : DEFAULT_MODEL;
  const text = doc.paras.map((p) => `[¶${p.n}] ${p.text}`).join("\n\n");

  const result = await completeJSON<{ translations?: { n?: unknown; text?: unknown }[] }>({
    model,
    apiKey,
    modelName: body.modelName,
    baseUrl: body.baseUrl,
    signal: req.signal,
    maxTokens: 8000,
    messages: [
      {
        role: "system",
        content: `You are a careful literary translator. Translate each numbered paragraph of the text into ${target}, one at a time. Keep the meaning exact and read naturally in ${target}, not word for word. Keep paragraph breaks, names, numbers, citations and [¶n] markers exactly as they are. Do not add commentary, notes, quotation marks or ==markers==.`,
      },
      {
        role: "user",
        content: `Translate every paragraph below into ${target}. Return JSON only, in this shape:\n{"translations":[{"n":1,"text":"..."}]}\nOne item per paragraph, keep the same n, and text is the full translation of that paragraph.\n\n${text}`,
      },
    ],
  });

  if (free) {
    const chars = doc.paras.reduce((a, p) => a + (p.text?.length ?? 0), 0);
    await chargeFree(free.subject, result.ok ? result.usage.costUsd : estimateUsd(chars, MODELS[model].inPerM));
  }
  if (!result.ok) return Response.json({ error: result.error }, { status: 502 });

  const valid = new Set(doc.paras.map((p) => p.n));
  const translations: Record<string, string> = {};
  for (const item of Array.isArray(result.data?.translations) ? result.data.translations : []) {
    const n = Number(item?.n);
    const t = typeof item?.text === "string" ? undash(item.text).replace(/==/g, "").trim() : "";
    if (valid.has(n) && t) translations[String(n)] = t;
  }
  return Response.json({ translations }, { headers: free ? { "X-Free-Left": free.left.toFixed(3) } : undefined });
}
