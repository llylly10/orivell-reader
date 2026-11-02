import { consumeResetToken, setPassword } from "@/lib/auth";
import { allow, clientId } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** Consumes the emailed token and sets the new password. Every existing
 *  session of the reader dies here, on every device. */
export async function POST(req: Request) {
  if (!allow(`reset:${clientId(req)}`, 10, 60_000)) {
    return Response.json({ error: "Too many tries. Wait a minute." }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { token?: string; password?: string };
  const token = String(body.token ?? "");
  const password = String(body.password ?? "");
  if (password.length < 10) return Response.json({ error: "Use at least 10 characters." }, { status: 400 });

  const userId = await consumeResetToken(token);
  if (!userId) return Response.json({ error: "This reset link is invalid or has expired." }, { status: 401 });

  await setPassword(userId, password);
  return Response.json({ ok: true });
}
