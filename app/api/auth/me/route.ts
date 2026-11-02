import { currentUser } from "@/lib/session";

export const runtime = "nodejs";

/** Who is reading, for the client's useViewer hook. */
export async function GET() {
  const me = await currentUser();
  return Response.json({ id: me?.id ?? null, name: me?.name ?? null });
}
