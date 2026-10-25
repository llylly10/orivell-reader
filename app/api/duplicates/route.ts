import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { canonicalUrl } from "@/lib/normalize";

export const runtime = "nodejs";
export const maxDuration = 120;

type Item = { id: string; url: string; title: string; opening: string; addedAt: number };
type Group = { kind: "url" | "text" | "title" | "fuzzy" | "media"; items: Item[] };

/** 标题 trigram 重叠系数——模糊预筛，捞出精确匹配漏掉的微调变体 */
function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of b) if (a.has(x)) inter++;
  return inter / Math.max(1, Math.min(a.size, b.size));
}
function trigrams(s: string): Set<string> {
  const t = new Set<string>();
  const x = `  ${s.toLowerCase().replace(/\s+/g, " ").trim()}  `;
  for (let i = 0; i < x.length - 2; i++) t.add(x.slice(i, i + 3));
  return t;
}

/**
 * 重复候选扫描。四类信号：
 * - url：规范化后的地址相同（同页不同参数/入口）
 * - text：规范化正文哈希相同（逐字复制）
 * - title：归一化标题完全相同
 * - fuzzy：标题 trigram 重叠 ≥0.72（微调变体：表情前缀、标点、个别词差异）
 *   ——模糊层会混入假阳性（同句式不同主题），由「智能判定」交给 LLM 分拣。
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
           string_agg(coalesce(r->>'text',''), ' ') as fulltext,
           coalesce(array_agg(distinct bb->>'src') filter (where bb->>'src' like '%twimg.com%'), '{}') as srcs,
           md5(lower(regexp_replace(string_agg(coalesce(r->>'text',''), ' '), '\\s+', ' ', 'g'))) as th
    from articles a
    left join lateral jsonb_array_elements(a.doc->'blocks') bb on true
    left join lateral jsonb_array_elements(bb->'runs') r on true
    where a.user_id = ${userId} and a.deleted = false
    group by a.article_id, url, title, added
    order by added desc`;

  const items: (Item & { th: string; srcs: string[] })[] = rows.map((r) => ({
    id: String(r.id),
    url: String(r.url ?? ""),
    title: String(r.title ?? ""),
    opening: String(r.fulltext ?? "").replace(/\s+/g, " ").slice(0, 160),
    addedAt: Number(r.added ?? 0),
    th: String(r.th ?? ""),
    srcs: Array.isArray(r.srcs) ? (r.srcs as string[]) : [],
  }));

  /** X 图媒体的稳定键：pbs.twimg.com/media/<key> 的 <key>（尺寸后缀剥离后同图同键） */
  const mediaKey = (src: string): string | null => {
    const m = /pbs\.twimg\.com\/media\/([\w-]+)/.exec(src);
    return m?.[1] ?? null;
  };
  const isBlank = (it: Item) => !it.title || it.title === "（无正文）";

  const groups: Group[] = [];

  const byUrl = new Map<string, Item[]>();
  for (const it of items) {
    if (!it.url) continue;
    const k = canonicalUrl(it.url);
    (byUrl.get(k) ?? byUrl.set(k, []).get(k)!).push(it);
  }
  for (const g of byUrl.values()) if (g.length > 1) groups.push({ kind: "url", items: g });

  const byText = new Map<string, Item[]>();
  for (const it of items) {
    if (!it.th || isBlank(it)) continue;
    (byText.get(it.th) ?? byText.set(it.th, []).get(it.th)!).push(it);
  }
  for (const g of byText.values()) if (g.length > 1) groups.push({ kind: "text", items: g });

  const byTitle = new Map<string, Item[]>();
  for (const it of items) {
    if (isBlank(it)) continue;
    const k = it.title.toLowerCase().replace(/\s+/g, " ").trim();
    if (k) (byTitle.get(k) ?? byTitle.set(k, []).get(k)!).push(it);
  }
  for (const g of byTitle.values()) if (g.length > 1) groups.push({ kind: "title", items: g });

  // 媒体键：同一张 X 图片（键相同，尺寸/格式变体不同）被多条内容引用
  const byMedia = new Map<string, Item[]>();
  for (const it of items) {
    const keys = new Set(it.srcs.map(mediaKey).filter(Boolean) as string[]);
    for (const k of keys) (byMedia.get(k) ?? byMedia.set(k, []).get(k)!).push(it);
  }
  for (const g of byMedia.values()) {
    if (g.length > 1) {
      const groupedAlready = new Set(groups.flatMap((G) => G.items.map((i) => i.id)));
      if (g.filter((i) => !groupedAlready.has(i.id)).length >= 2) groups.push({ kind: "media", items: g });
    }
  }

  // 模糊层：只在标题（≥4 字符）间算重叠；已被上面任何组收编的成员 ≥2 个就跳过
  const grouped = new Set<string>();
  for (const g of groups) for (const it of g.items) grouped.add(it.id);
  const fuzzyItems = items.filter((it) => !isBlank(it) && it.title.trim().length >= 4);
  const tri = fuzzyItems.map((it) => trigrams(it.title));
  const used = new Set<number>();
  for (let i = 0; i < fuzzyItems.length; i++) {
    if (used.has(i)) continue;
    const cluster = [i];
    for (let j = i + 1; j < fuzzyItems.length; j++) {
      if (used.has(j)) continue;
      if (overlapCoefficient(tri[i], tri[j]) >= 0.72) {
        cluster.push(j);
        used.add(j);
      }
    }
    if (cluster.length > 1) {
      used.add(i);
      const members = cluster.map((k) => fuzzyItems[k]);
      const already = members.filter((m) => grouped.has(m.id)).length;
      if (already < 2) groups.push({ kind: "fuzzy", items: members });
    }
  }

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
