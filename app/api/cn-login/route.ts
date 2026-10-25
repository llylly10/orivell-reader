const SIDECAR = process.env.GLOSS_CNSPIDER_URL || "http://127.0.0.1:8899";

/** 弹窗登录：fire-and-forget 调 sidecar 的 /login——那是一个要等用户扫完码的
    长请求，所以这里不 await 它；设置页靠轮询 /api/cn-status 看结果。 */
export async function POST(req: Request) {
  let body: { platform?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }
  const platform = String(body.platform ?? "");
  if (!platform) return Response.json({ ok: false, error: "platform is required." }, { status: 400 });
  void fetch(`${SIDECAR}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ platform }),
    signal: AbortSignal.timeout(360_000),
  }).catch(() => {});
  return Response.json({ ok: true, started: true });
}
