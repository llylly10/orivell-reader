import { auth } from "@clerk/nextjs/server";
import { completeJSON } from "@/lib/together";

export const runtime = "nodejs";
export const maxDuration = 120;

type GroupIn = { kind?: string; items: { id: string; title: string; opening: string }[] };

const TASK = `判断一组收藏内容是否重复。组内每条给出标题和正文开头。
- "duplicate"：同一内容（逐字或微调复制——表情、前缀、标点差异不算不同）
- "variant"：同一话题/故事的不同帖子（各有各的内容，应都保留）
- "unrelated"：只是标题相似，内容其实是两回事
返回严格 JSON：{"verdict":"duplicate|variant|unrelated","reason":"一句话中文理由"}`;

/**
 * 重复候选的 LLM 判定：每组一次调用，用读者浏览器里的三件套（地址/密钥/模型名）。
 * 判定只是建议——合并与否始终由设置页里的人决定。
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });
  let body: { groups?: GroupIn[]; baseUrl?: string; apiKey?: string; modelName?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const groups = (body.groups ?? []).filter((g) => g.items?.length > 1).slice(0, 60);
  if (!groups.length) return Response.json({ error: "No candidate groups sent." }, { status: 400 });

  const verdicts: { verdict: string; reason: string }[] = [];
  for (const g of groups) {
    const listing = g.items
      .slice(0, 6)
      .map((it, i) => `[${i + 1}] ${it.title}\n${it.opening || "(无正文)"}`)
      .join("\n\n");
    const r = await completeJSON<{ verdict?: unknown; reason?: unknown }>({
      model: "flash",
      apiKey: body.apiKey,
      modelName: body.modelName,
      baseUrl: body.baseUrl,
      maxTokens: 200,
      messages: [{ role: "user", content: `${TASK}\n\n---\n${listing}` }],
    });
    const v = r.ok ? String((r.data.verdict as string) ?? "") : "";
    verdicts.push(
      r.ok && (v === "duplicate" || v === "variant" || v === "unrelated")
        ? { verdict: v, reason: String((r.data.reason as string) ?? "").slice(0, 120) }
        : { verdict: "unknown", reason: r.ok ? "模型未给出明确判定。" : r.error },
    );
  }
  return Response.json({ ok: true, verdicts });
}
