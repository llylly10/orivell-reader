import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Cron endpoints answer only to a bearer secret, so an open URL cannot be
 * farmed. Set CRON_SECRET in the environment and send
 * `Authorization: Bearer <secret>` (or ?key=<secret> for plain cron).
 */
export function verifyCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const given = bearer || new URL(req.url).searchParams.get("key") || "";
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
