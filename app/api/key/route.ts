import { peekFree } from "@/lib/quota";
import { usingCustomAI, APP_UA } from "@/lib/together";

export const runtime = "nodejs";

/** Validates a pasted key with a zero-cost model listing. The key is never stored or logged.
    自定义 AI 服务模式下跳过 Together 验证（key 是别家的），由设置页直接保存。 */
export async function POST(req: Request) {
  let body: { apiKey?: string } = {};
  try {
    body = await req.json();
  } catch {}
  const key = body.apiKey?.trim();
  if (!key) return Response.json({ ok: false });
  if (usingCustomAI()) return Response.json({ ok: true, custom: true });
  try {
    const res = await fetch("https://api.together.xyz/v1/models", {
      headers: { Authorization: `Bearer ${key}`, "User-Agent": APP_UA },
      signal: AbortSignal.timeout(10_000),
    });
    return Response.json({ ok: res.ok });
  } catch {
    return Response.json({ ok: false });
  }
}

/** Whether there is a shared key, and how much of today's free allowance is left on it. */
export async function GET(req: Request) {
  const house = Boolean(process.env.TOGETHER_API_KEY);
  const custom = usingCustomAI();
  return Response.json({ house, custom, free: house && !custom ? await peekFree(req) : null });
}
