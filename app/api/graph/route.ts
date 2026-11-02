import { currentUser } from "@/lib/session";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * 关系图谱的物化：一次返回全部节点与边。
 * 结果按「文章指纹 + 实体指纹」（count + max(updated_at/created_at)）缓存：
 * 数据没变的重复访问直接命中缓存返回，不再实时跑 jsonb 展开 SQL。
 * 节点：a = 文章，au = 作者，e = 实体
 * 边：quote = 库内引用，author = 作者写了该篇，entity = 实体出现在文章里
 */

type Payload = { ok: true; nodes: unknown[]; edges: unknown[]; progress: { extracted: number; total: number } };
type Cached = { fp: string; payload: Payload };
const cache = new Map<string, Cached>();

async function fingerprint(userId: string): Promise<string> {
  const a = await db()`select count(*)::int as n, coalesce(max(updated_at)::text, '') as mu from articles where user_id = ${userId} and deleted = false`;
  const e = await db()`select count(*)::int as n, coalesce(max(created_at)::text, '') as mu from entities where user_id = ${userId}`;
  return `${userId}:${a[0].n}:${a[0].mu}:${e[0].n}:${e[0].mu}`;
}

export async function GET() {
const me = await currentUser();
  const userId = me?.id ?? null;
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });

  const fp = await fingerprint(userId);
  const hit = cache.get(fp);
  if (hit) return Response.json(hit.payload);
  if (cache.size > 8) cache.clear();

  const articles = await db()`
    select a.article_id as id, a.data->>'title' as t, a.data->>'sourceUrl' as u,
           a.data->>'topic' as topic, a.data->>'addedAt' as at
    from articles a
    where a.user_id = ${userId} and a.deleted = false
    order by a.data->>'addedAt' desc nulls last`;

  const nodes: { id: string; k: "a" | "au" | "e"; t: string; s?: string; n?: number }[] = [];
  const edges: { s: string; t: string; k: "quote" | "author" | "entity" }[] = [];
  const authorNode = (name: string) => `au:${name}`;

  for (const r of articles) {
    nodes.push({ id: String(r.id), k: "a", t: String(r.t ?? ""), s: String(r.topic ?? "unsorted"), });
    const au = String(r.au ?? "").trim();
    if (au) {
      nodes.push({ id: authorNode(au), k: "au", t: au });
      edges.push({ s: String(r.id), t: authorNode(au), k: "author" });
    }
  }

  const quotes = await db()`
    select a.article_id as src, t.article_id as dst
    from articles a
    cross join lateral jsonb_array_elements(a.doc->'blocks') b
    join articles t on t.user_id = a.user_id and t.deleted = false
      and t.data->>'sourceUrl' = b->>'quoteUrl'
    where a.user_id = ${userId} and a.deleted = false`;
  const seen = new Set<string>();
  for (const r of quotes) {
    const k = `${r.src}->${r.dst}`;
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push({ s: String(r.src), t: String(r.dst), k: "quote" });
  }

  const ents = await db()`
    select e.name, coalesce(e.display, e.name) as label, e.type, count(*)::int as n,
           array_agg(e.article_id) as arts
    from entities e
    where e.user_id = ${userId}
    group by e.name, e.type, label
    order by n desc`;
  for (const e of ents) {
    const eid = `e:${e.name}`;
    nodes.push({ id: eid, k: "e", t: String(e.label), n: Number(e.n) });
    for (const a of (e.arts as string[] | undefined) ?? []) edges.push({ s: eid, t: String(a), k: "entity" });
  }

  const extracted = await db()`
    select count(distinct article_id)::int n from entities where user_id = ${userId}`;
  const total = await db()`
    select count(*)::int n from articles where user_id = ${userId} and deleted = false`;

  const payload: Payload = {
    ok: true,
    nodes,
    edges,
    progress: { extracted: Number(extracted[0].n), total: Number(total[0].n) },
  };
  cache.set(fp, { fp, payload });
  return Response.json(payload);
}
