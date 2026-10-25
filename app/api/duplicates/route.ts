import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { canonicalUrl, textHash } from "@/lib/normalize";

export const runtime = "nodejs";
export const maxDuration = 120;

type Item = { id: string; url: string; title: string; addedAt: number };
type Group = { kind: "url" | "text" | "title"; items: Item[] };

/**
 * 重复候选扫描。三类信号：
 * - url：规范化后的地址相同（同页不同参数/入口）
 * - text：规范化正文哈希相同（病毒式逐字复制、同文不同推）
 * - title：归一化标题相同（兜底：正文缺失但有同题）
 * 绝不自动删除——合并由设置页人工确认。
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to scan." }, { status: 401 });

  const rows = await db()`
    select a.article_id as id,
           a.data->>'sourceUrl' as url,
           a.data->>'title' as title,
           a.data->>'addedAt' as added,
           md5(lower(regexp_replace(string_agg(coalesce(rr->>'text', ''), ' '), '\\s+', ' ', 'g'))) as th
    from articles a
    left join lateral jsonb_array_elements(a.doc->'blocks') bb on true
    left join lateral jsonb_array_elements(bb->'runs') rr on true
    where a.user_id = ${userId} and a.deleted = false
    group by a.article_id, url, title
    order by added desc
  `;

  const items: (Item & { th: string })[] = rows.map((r) => ({
    id: String(r.id),
    url: String(r.url ?? ""),
    title: String(r.title ?? ""),
    addedAt: Number(r.added ?? 0),
    th: String(r.th ?? ""),
  }));

  const groups: Group[] = [];

  // url：规范化地址相同
  const byUrl = new Map<string, Item[]>();
  for (const it of items) {
    if (!it.url) continue;
    const k = canonicalUrl(it.url);
    (byUrl.get(k) ?? byUrl.set(k, []).get(k)!).push(it);
  }
  for (const g of byUrl.values()) if (g.length > 1) groups.push({ kind: "url", items: g });

  // text：规范化正文哈希相同（排除无正文的）
  const byText = new Map<string, Item[]>();
  for (const it of items) {
    if (!it.th || it.title === "（无正文）") continue;
    (byText.get(it.th) ?? byText.set(it.th, []).get(it.th)!).push(it);
  }
  for (const g of byText.values()) if (g.length > 1) groups.push({ kind: "text", items: g });

  // title：归一化标题相同（兜底信号）
  const byTitle = new Map<string, Item[]>();
  for (const it of items) {
    const k = it.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (!k || k === "（无正文）") continue;
    (byTitle.get(k) ?? byTitle.set(k, []).get(k)!).push(it);
  }
  for (const g of byTitle.values()) {
    if (g.length > 1 && !groups.some((G) => G.items.some((i) => g.some((j) => j.id === i.id)))) {
      groups.push({ kind: "title", items: g });
    }
  }

  // 组内按时间排（最旧的在前，作为默认保留项）
  for (const g of groups) g.items.sort((a, b) => a.addedAt - b.addedAt);
  return Response.json({ ok: true, groups, scanned: items.length });
}

/** 合并：保留 keep，其余墓碑下架（划线批注跟随文章，随 sync 同步到所有设备）。 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });
  let body: { keep?: string; drop?: string[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const keep = String(body.keep ?? "");
  const drop = (body.drop ?? []).map(String).filter((d) => d && d !== keep);
  if (!keep || !drop.length) return Response.json({ error: "keep and drop are required." }, { status: 400 });

  // 保留项必须存在且属于该用户
  const owned = await db()`
    select count(*)::int n from articles
    where user_id = ${userId} and article_id = ${keep} and deleted = false`;
  if (!owned[0].n) return Response.json({ error: "Keep target not found." }, { status: 404 });

  const r = await db()`
    update articles set deleted = true, updated_at = now()
    where user_id = ${userId} and article_id = any(${drop}) and deleted = false
    returning article_id`;
  return Response.json({ ok: true, dropped: r.length });
}
