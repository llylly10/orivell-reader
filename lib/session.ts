/**
 * Who is reading, from the session cookie. The only thing the rest of Gloss
 * needs. Returns null when there is no session or it has expired.
 *
 * Server-side only: reads cookies(), which cannot run in the browser.
 */

import { cookies } from "next/headers";
import { db } from "./db";
import { COOKIE, hashSession } from "./auth";

export type Viewer = { id: string; name: string | null; email: string; avatar: string | null; sessionId: string };

export async function currentUser(): Promise<Viewer | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const rows = await db().query(
    `update sessions set expires_at = least(expires_at + interval '1 day', now() + interval '30 days')
     where token_hash = $1 and expires_at > now()
     returning id, user_id`,
    [hashSession(token)]
  );
  if (!rows.length) return null;
  const u = await db().query("select name, email, avatar from users where id = $1", [rows[0].user_id]);
  return {
    id: rows[0].user_id as string,
    name: (u[0]?.name as string) ?? null,
    email: String(u[0]?.email ?? ""),
    avatar: (u[0]?.avatar as string | null) ?? null,
    sessionId: rows[0].id as string,
  };
}
