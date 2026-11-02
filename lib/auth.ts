/**
 * Accounts: the reader signs in with an email and a password, and carries a
 * cookie that names a session. Everything else in Gloss only ever needs the
 * user's id, which is what the signed-in cookie resolves to.
 *
 * - Passwords are hashed with scrypt and a per-user salt. The hash is stored
 *   with its parameters, so an old cost can still be verified later.
 * - The cookie carries a random id. Only the hash of the cookie's token is
 *   kept, so a leaked database does not hand over live sessions.
 * - Sessions expire, and slide: each use renews the expiry, capped at 30 days.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db";

/** The cookie that carries the session id. Shared with lib/session.ts, which reads it. */
export const COOKIE = "gloss_session";
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* ---------- password hashing ---------- */

const enc = (b: Buffer) => b.toString("base64url");

/** What the sessions table stores instead of the cookie's value. Shared with lib/session.ts so the two never drift. */
export const hashSession = (token: string) => createHash("sha256").update(`gloss-session:${token}`).digest("hex");

/** `"scrypt$N$r$p$salt$hash"`, so the cost can be raised later without invalidating old hashes. */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain.normalize("NFKC"), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${enc(salt)}$${enc(hash)}`;
}

/** Constant-time when it matters: a wrong hash must take the same time as a wrong password. */
export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, hash] = parts;
  try {
    const expected = Buffer.from(hash, "base64url");
    const got = scryptSync(plain.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return expected.length === got.length && timingSafeEqual(expected, got);
  } catch {
    return false;
  }
}

/* ---------- users ---------- */

const newId = (prefix: string) => `${prefix}_${randomBytes(16).toString("base64url")}`;

export async function createUser(email: string, password: string, name?: string, id?: string): Promise<{ id: string } | { error: string }> {
  const key = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(key)) return { error: "That email does not look right." };
  if (password.length < 10) return { error: "Use at least 10 characters." };

  // An explicit id is only ever passed by the one-off adoption script, which
  // re-creates an existing reader under their old Clerk user id so the whole
  // library keeps pointing at the right owner without touching any row.
  const userId = id ?? newId("usr");
  try {
    await db().query(
      "insert into users (id, email, name, hash) values ($1, $2, $3, $4)",
      [userId, key, name?.trim().slice(0, 80) || null, hashPassword(password)]
    );
  } catch {
    return { error: "That email is already registered." }; // unique violation
  }
  return { id: userId };
}

/** A new session row; returns the cookie value, which the caller must not log. */
export async function startSession(userId: string, userAgent?: string): Promise<string> {
  const id = newId("ses");
  const token = randomBytes(32).toString("base64url");
  await db().query(
    "insert into sessions (id, user_id, token_hash, expires_at, user_agent) values ($1, $2, $3, now() + interval '30 days', $4)",
    [id, userId, hashSession(token), userAgent?.slice(0, 200) ?? null]
  );
  return token;
}

export async function endSession(sessionId: string) {
  await db().query("delete from sessions where id = $1", [sessionId]).catch(() => {});
}

/* ---------- password reset ---------- */

/**
 * A "forgot password" request: one single-use token, 30 minutes to live. The
 * email carries the raw token; the table keeps its hash, so a leaked database
 * or mailbox dump cannot reset anyone. The token is salted with a "reset:"
 * prefix so it can never be replayed as a session cookie and vice versa.
 */
export async function createResetToken(userId: string): Promise<string> {
  const id = newId("rst");
  const token = randomBytes(32).toString("base64url");
  await db().query(
    "insert into password_resets (id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '30 minutes')",
    [id, userId, hashSession(`reset:${token}`)]
  );
  return token;
}

/** Marks the token used and returns its owner, or null for unknown/expired/used tokens. */
export async function consumeResetToken(token: string): Promise<string | null> {
  const rows = await db().query(
    "update password_resets set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning user_id",
    [hashSession(`reset:${token}`)]
  );
  return rows.length ? (rows[0].user_id as string) : null;
}

/** Sets a new password and ends every session of the reader, on every device. */
export async function setPassword(userId: string, password: string): Promise<void> {
  await db().query("update users set hash = $1 where id = $2", [hashPassword(password), userId]);
  await db().query("delete from sessions where user_id = $1", [userId]).catch(() => {});
}

/** Expired sessions are swept opportunistically; nobody runs a cron for this. */
export async function sweepSessions() {
  await db().query("delete from sessions where expires_at <= now()").catch(() => {});
}
