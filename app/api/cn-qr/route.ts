const SIDECAR = process.env.GLOSS_CNSPIDER_URL || "http://127.0.0.1:8899";

/** 内嵌二维码登录：POST 开会话，GET 轮询截图（base64 jpeg）与登录结果，DELETE 取消。 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}) as { platform?: string });
  const platform = String(body.platform ?? "");
  if (!platform) return Response.json({ ok: false, error: "platform is required." }, { status: 400 });
  try {
    const res = await fetch(`${SIDECAR}/login-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform }),
      signal: AbortSignal.timeout(10_000),
    });
    return Response.json(await res.json());
  } catch {
    return Response.json({ ok: false, error: "sidecar 未运行。" }, { status: 502 });
  }
}

export async function GET(req: Request) {
  const platform = new URL(req.url).searchParams.get("platform") ?? "";
  if (!platform) return Response.json({ ok: false, error: "platform is required." }, { status: 400 });
  try {
    const res = await fetch(`${SIDECAR}/login-qr?platform=${encodeURIComponent(platform)}`, {
      signal: AbortSignal.timeout(5000),
    });
    return Response.json(await res.json());
  } catch {
    return Response.json({ ok: false, error: "sidecar 未运行。" }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const platform = new URL(req.url).searchParams.get("platform") ?? "";
  try {
    await fetch(`${SIDECAR}/login-qr/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {}
  return Response.json({ ok: true });
}
