import { SITE_URL } from "@/lib/brand";
import { verifyCron } from "@/lib/cron";
import { db, hasDatabase } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { todaysReview } from "@/lib/review";
import type { Highlight } from "@/lib/store";

export const runtime = "nodejs";

type Row = { email: string; name: string | null; highlights: Highlight[] };

/** Every reader's highlights due today: the review algorithm runs on the server here, straight off the synced rows. */
async function queue(): Promise<{ email: string; name: string | null; deck: Highlight[]; done: number }[]> {
  const users = await db().query<{ id: string; email: string; name: string | null }>(
    "select id, email, name from users order by created_at"
  );
  const out: { email: string; name: string | null; deck: Highlight[]; done: number }[] = [];
  for (const u of users) {
    const rows = await db().query<{ data: Highlight }>(
      `select h.data from highlights h
       left join articles a on a.user_id = h.user_id and a.id = h.article_id
       where h.user_id = $1 and not h.deleted and (a.id is null or not a.deleted)`,
      [u.id]
    );
    const { deck, done } = todaysReview(rows.map((r) => r.data));
    if (deck.length) out.push({ email: u.email, name: u.name, deck, done });
  }
  return out;
}

function html(name: string | null, deck: Highlight[]): string {
  const items = deck
    .map((h) => {
      const quote = h.anchor.quote.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<li style="margin:0 0 14px;"><p style="margin:0 0 2px;font-size:15px;line-height:1.55;">${quote}</p></li>`;
    })
    .join("");
  return `<div style="font-family:Georgia,'Songti SC',serif;max-width:560px;margin:0 auto;color:#1f1d1a;">
  <p style="font-size:13px;color:#8a857c;margin:24px 0 0;">Orivell${name ? ` · ${name}` : ""}</p>
  <h1 style="font-size:20px;font-weight:500;margin:4px 0 18px;">今天的复习 · ${deck.length} 条</h1>
  <ol style="list-style:none;padding:0;margin:0 0 24px;">${items}</ol>
  <p style="font-size:14px;margin:0;">
    <a href="${SITE_URL}/library" style="color:#1f1d1a;">回到书架</a>
  </p>
</div>`;
}

/** The morning push: whatever each reader should review today. Vercel cron or a plain curl with CRON_SECRET. */
export async function GET(req: Request) {
  if (!verifyCron(req)) return Response.json({ error: "No." }, { status: 401 });
  if (!hasDatabase()) return Response.json({ error: "No database is configured." }, { status: 503 });
  const due = await queue();
  let sent = 0;
  const failures: string[] = [];
  for (const reader of due) {
    const r = await sendMail({ to: reader.email, subject: `Orivell · 今天的复习 ${reader.deck.length} 条`, html: html(reader.name, reader.deck) });
    if (r.sent) sent++;
    else failures.push(`${reader.email}: ${r.reason}`);
  }
  return Response.json({ ok: true, sent, readers: due.length, ...(failures.length ? { failures } : {}) });
}
