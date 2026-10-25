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

  // 相似变体（标题 trigram 重叠 ≥0.72）：微调复制的帖子——非破坏性软聚簇的信号面
  const tri = (s: string): Set<string> => {
    const t = new Set<string>();
    const x = `  ${s.toLowerCase().replace(/\s+/g, " ").trim()}  `;
    for (let i = 0; i < x.length - 2; i++) t.add(x.slice(i, i + 3));
    return t;
  };
  const selfTri = tri(selfTitleKey);
  const variants: { id: string; t: string; u: string; a: string; s: string }[] = [];
  if (selfTitleKey.length >= 4) {
    const allTitles = await db()`
      select a.article_id as id, a.data->>'title' as t, a.data->>'sourceUrl' as u,
             a.data->>'author' as a, a.data->>'source' as s
      from articles a
      where a.user_id = ${userId} and a.deleted = false and a.article_id <> ${id}
        and a.data->>'title' <> '' and a.data->>'title' <> '（无正文）'`;
    for (const r of allTitles) {
      const other = tri(String(r.t ?? ""));
      let inter = 0;
      for (const g of other) if (selfTri.has(g)) inter++;
      if (inter / Math.max(1, Math.min(selfTri.size, other.size)) >= 0.72) {
        variants.push({ id: String(r.id), t: String(r.t ?? ""), u: String(r.u ?? ""), a: String(r.a ?? ""), s: String(r.s ?? "") });
      }
    }
  }

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

  for (const r of variants)
    add({ id: r.id, title: r.t, url: r.u, author: r.a, source: r.s, reason: "相似变体", score: 40 }, 40);

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

  // 语义关联（pgvector + 均值中心化）：与确定性信号混合排序——不是替代，是补位
  try {
    const emb = await db()`select embedding from embeddings where user_id = ${userId} and article_id = ${id}`;
    const meanRow = await db()`select mean from embed_mean where user_id = ${userId}`;
    if (emb[0] && meanRow[0]) {
      const parse = (s: unknown) => String(s ?? "").replace(/[\[\]]/g, "").split(",").map(Number);
      const selfV = parse(emb[0].embedding);
      const meanV = parse(meanRow[0].mean);
      if (selfV.length === meanV.length && selfV.length) {
        const centered = selfV.map((x, i) => x - meanV[i]);
        const centeredStr = `[${centered.map((x) => x.toFixed(6)).join(",")}]`;
        const meanStr = `[${meanV.map((x) => x.toFixed(6)).join(",")}]`;
        const sims = await db()`
          select a.article_id as id, a.data->>'title' as t, a.data->>'sourceUrl' as u,
                 a.data->>'author' as au, a.data->>'source' as s,
                 ((e.embedding - ${meanStr}::vector) <=> (${centeredStr}::vector)) as dist
          from embeddings e join articles a on a.user_id = e.user_id and a.article_id = e.article_id
          where e.user_id = ${userId} and e.article_id <> ${id} and a.deleted = false
          order by dist
          limit 30`;
        for (const r of sims) {
          const sim = 1 - Number(r.dist);
          if (sim < 0.35) continue; // 中心化后无关 ≈ 0；只收真相关的
          add(
            { id: String(r.id), title: String(r.t ?? ""), url: String(r.u ?? ""), author: String(r.au ?? ""), source: String(r.s ?? ""), reason: "语义相关", score: Math.min(45, sim * 60) },
            Math.min(45, sim * 60),
          );
        }
      }
    }
  } catch {
    // 语义层是锦上添花——数据库没开 vector 扩展等情况下一律静默跳过
  }

  const related = [...scored.values()]
    .filter((r) => r.title || r.url)
    .sort((x, y) => y.score - x.score)
    .slice(0, 8)
    .map(({ id, title, url, author, source, reason }) => ({ id, title, url, author, source, reason }));
  return Response.json({ ok: true, related });
}
