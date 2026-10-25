import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { canonicalUrl, textHash } from "@/lib/normalize";

export const runtime = "nodejs";
export const maxDuration = 60;

type Related = { id: string; title: string; url: string; author: string; source: string; reason: string; score: number };

/**
 * 一篇文章的"相关"条目——确定性信号打分：
 * - 同文（规范化正文哈希相同）：+100（病毒式同文不同推/同内容异源）
 * - 引用关系：它引用我，或我引用它（quoteUrl 图）:+80
 * - 同作者：+30　- 同来源：+15
 * 纯 SQL 信号，零额外成本；语义（pgvector）另线再接。
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await params;

  const self = await db()`
    select article_id, data->>'sourceUrl' as u, data->>'title' as t,
           data->>'author' as a, data->>'source' as s
    from articles where user_id = ${userId} and article_id = ${id} and deleted = false`;
  if (!self[0]) return Response.json({ error: "Not found." }, { status: 404 });
  const selfUrl = String(self[0].u ?? "");
  const selfAuthor = String(self[0].a ?? "");
  const selfSource = String(self[0].s ?? "");

  const textDigest = await db()`
    select md5(lower(regexp_replace(string_agg(coalesce(rr->>'text', ''), ' '), '\\s+', ' ', 'g'))) as th
    from articles a
    left join lateral jsonb_array_elements(a.doc->'blocks') bb on true
    left join lateral jsonb_array_elements(bb->'runs') rr on true
    where a.user_id = ${userId} and a.article_id = ${id} and a.deleted = false`;
  const th = String(textDigest[0]?.th ?? "");

  // 引用图：别人引用了我的链接；以及我引用了谁
  const quotedByMe = await db()`
    select distinct b->>'quoteUrl' as qu
    from articles a, jsonb_array_elements(a.doc->'blocks') b
    where a.user_id = ${userId} and a.article_id = ${id} and b->>'quoteUrl' is not null`;
  const myQuoteUrls = quotedByMe.map((r) => String(r.qu));
  const selfQuotedBy = selfUrl
    ? await db()`
        select distinct a.article_id as id, a.data->>'title' as t
        from articles a, jsonb_array_elements(a.doc->'blocks') b
        where a.user_id = ${userId} and a.deleted = false and b->>'quoteUrl' = ${selfUrl}`
    : [];
  const quotedMe = new Set(selfQuotedBy.map((r) => String(r.id)));

  // 同文（规范化哈希）
  const sameText = th
    ? await db()`
        select x.id, x.t, x.u, x.au, x.ss
        from (
          select a.article_id as id, a.data->>'title' as t, a.data->>'sourceUrl' as u,
                 a.data->>'author' as au, a.data->>'source' as ss
          from articles a
          left join lateral jsonb_array_elements(a.doc->'blocks') bb on true
          left join lateral jsonb_array_elements(bb->'runs') rr on true
          where a.user_id = ${userId} and a.deleted = false and a.article_id <> ${id}
          group by a.article_id, u, t, au, ss
          having md5(lower(regexp_replace(string_agg(coalesce(rr->>'text', ''), ' '), '\\s+', ' ', 'g'))) = ${th}
        ) x`
    : [];

  // 同标题（归一化）——不同推文发同一句 viral 文案时靠它聚类
  const selfTitleKey = String(self[0].t ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const sameTitle = selfTitleKey
    ? await db()`
        select a.article_id as id, a.data->>'title' as t, a.data->>'sourceUrl' as u,
               a.data->>'author' as a, a.data->>'source' as s
        from articles a
        where a.user_id = ${userId} and a.deleted = false and a.article_id <> ${id}
          and lower(regexp_replace(a.data->>'title', '\\s+', ' ', 'g')) = ${selfTitleKey}
        limit 20`
    : [];

  // 同作者 / 同来源
  const sameMeta = await db()`
    select a.article_id as id, a.data->>'title' as t, a.data->>'sourceUrl' as u,
           a.data->>'author' as a, a.data->>'source' as s
    from articles a
    where a.user_id = ${userId} and a.deleted = false and a.article_id <> ${id}
      and ((selfAuthor <> '' and a.data->>'author' = selfAuthor) or (selfSource <> '' and a.data->>'source' = selfSource))
    limit 60`;

  const scored = new Map<string, Related>();
  const add = (c: Related, base: number) => {
    const prev = scored.get(c.id);
    if (prev) {
      prev.score += base;
      if (c.reason && !prev.reason.includes(c.reason)) prev.reason += "、" + c.reason;
    } else scored.set(c.id, c);
  };

  for (const r of sameTitle)
    add({ id: String(r.id), title: String(r.t ?? ""), url: String(r.u ?? ""), author: String(r.a ?? ""), source: String(r.s ?? ""), reason: "同标题", score: 50 }, 50);

  for (const r of sameText)
    add({ id: String(r.id), title: String(r.t ?? ""), url: String(r.u ?? ""), author: String(r.au ?? ""), source: String(r.ss ?? ""), reason: "同文", score: 100 }, 100);
  for (const r of selfQuotedBy)
    add({ id: String(r.id), title: String(r.t ?? ""), url: "", author: "", source: "", reason: "引用了我", score: 80 }, 80);
  for (const qu of myQuoteUrls) {
    const hits = await db()`
      select a.article_id as id, a.data->>'title' as t, a.data->>'sourceUrl' as u,
             a.data->>'author' as a, a.data->>'source' as s
      from articles a
      where a.user_id = ${userId} and a.deleted = false and a.article_id <> ${id}
        and a.data->>'sourceUrl' = ${qu}`;
    for (const r of hits)
      add({ id: String(r.id), title: String(r.t ?? ""), url: String(r.u ?? ""), author: String(r.a ?? ""), source: String(r.s ?? ""), reason: "我引用了它", score: 80 }, 80);
  }
  for (const r of sameMeta) {
    const sameAuthor = selfAuthor && String(r.a) === selfAuthor;
    const sameSource = selfSource && String(r.s) === selfSource && Boolean(selfUrl);
    add(
      { id: String(r.id), title: String(r.t ?? ""), url: String(r.u ?? ""), author: String(r.a ?? ""), source: String(r.s ?? ""), reason: sameAuthor ? "同作者" : "同来源", score: sameAuthor ? 30 : 15 },
      sameAuthor ? 30 : 15,
    );
  }

  const related = [...scored.values()]
    .filter((r) => r.title || r.url)
    .sort((x, y) => y.score - x.score)
    .slice(0, 8)
    .map(({ id, title, url, author, source, reason }) => ({ id, title, url, author, source, reason }));
  return Response.json({ ok: true, related });
}
