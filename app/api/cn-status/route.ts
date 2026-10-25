const SIDECAR = process.env.GLOSS_CNSPIDER_URL || "http://127.0.0.1:8899";

/** 国内平台登录态一览：直接转发 sidecar 的 /status。sidecar 没跑时如实说明。 */
export async function GET() {
  try {
    const res = await fetch(`${SIDECAR}/status`, { signal: AbortSignal.timeout(2500) });
    const j = await res.json();
    return Response.json({ ok: true, sidecar: true, ...j });
  } catch {
    return Response.json({ ok: false, sidecar: false, loginState: null });
  }
}
