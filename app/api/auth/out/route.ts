import { cookies } from "next/headers";
import { COOKIE, endSession } from "@/lib/auth";
import { currentUser } from "@/lib/session";

export const runtime = "nodejs";

/** Sign out: drop this browser's session, leave the others alone. */
export async function POST() {
  const me = await currentUser();
  if (me) await endSession(me.sessionId);
  (await cookies()).delete(COOKIE);
  return Response.json({ ok: true });
}
