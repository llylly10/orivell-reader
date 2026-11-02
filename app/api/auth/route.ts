import { cookies } from "next/headers";
import { COOKIE, createUser, hashPassword, startSession, sweepSessions, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { allow, clientId } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** Sign in or create an account. One route, because one form posts to it either way. */
export async function POST(req: Request) {
  // Brute-force guard: 20 tries a minute per address. Everything on the LAN
  // demo shares one bucket (no XFF behind a direct connection), so the budget
  // has room for a register → logout → login round of testing.
  if (!allow(`auth:${clientId(req)}`, 20, 60_000)) {
    return Response.json({ error: "Too many tries. Wait a minute." }, { status: 429 });
  }
  sweepSessions(); // fire and forget; failures are ignored on purpose

  const body = (await req.json().catch(() => ({}))) as { mode?: string; email?: string; password?: string; name?: string };
  const email = String(body.email ?? "");
  const password = String(body.password ?? "");
  const mode = body.mode === "up" ? "up" : "in";

  let userId: string;
  if (mode === "up") {
    const made = await createUser(email, password, body.name);
    if ("error" in made) return Response.json(made, { status: 400 });
    userId = made.id;
  } else {
    const u = await db().query("select id, hash from users where email = $1", [email.trim().toLowerCase()]);
    // Hash a throwaway when the account is missing, so "no such email" and
    // "wrong password" take the same time and cannot be told apart. Both
    // branches below must call hashPassword exactly once.
    if (!u.length) {
      hashPassword(password);
      return Response.json({ error: "That email and password do not match." }, { status: 401 });
    }
    if (!verifyPassword(password, u[0].hash as string)) {
      return Response.json({ error: "That email and password do not match." }, { status: 401 });
    }
    userId = u[0].id as string;
  }

  const token = await startSession(userId, req.headers.get("user-agent") ?? undefined);
  // secure only when the reader is actually on https: a plain-http LAN run
  // must still get the cookie (browsers drop secure cookies over http).
  const https = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https" || new URL(req.url).protocol === "https:";
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: https,
    path: "/", maxAge: 30 * 24 * 60 * 60,
  });
  return Response.json({ ok: true, returnTo: "/" });
}
