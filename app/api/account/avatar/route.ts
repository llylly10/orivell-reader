import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";
import { allow, clientId } from "@/lib/ratelimit";

export const runtime = "nodejs";

const MAX_CHARS = 120_000; // ~90 KB jpeg as a data URL — the client resizes to 128px first
const PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/** Save or clear the reader's avatar (a small data URL the browser made). */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!allow(`avatar:${clientId(req)}`, 10, 60_000)) {
    return Response.json({ error: "Too many tries. Wait a minute." }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { dataUrl?: string };
  const data = String(body.dataUrl ?? "");

  if (!data) {
    await db().query("update users set avatar = null where id = $1", [me.id]);
    return Response.json({ ok: true, avatar: null });
  }
  if (data.length > MAX_CHARS || !PATTERN.test(data)) {
    return Response.json({ error: "That image is not something we can store — try a smaller one." }, { status: 400 });
  }
  await db().query("update users set avatar = $1 where id = $2", [data, me.id]);
  return Response.json({ ok: true, avatar: data });
}
