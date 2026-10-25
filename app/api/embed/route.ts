import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * 语义索引的回填：每批 20 篇未索引文章，标题+开头文字送读者自己的
 * OpenAI 兼容 /embeddings 端点（浏览器三件套的地址与密钥；模型默认
 * text-embedding-v3——1024 维，可用 AI_EMBED_MODEL 覆盖）。
 * 向量入库同时增量维护语料均值（embed_mean），关联查询用它做均值中心化。
 */

const DIM = 1024;
const BATCH = 10; // 百炼 embeddings 单次输入上限
const DEFAULT_MODEL = process.env.AI_EMBED_MODEL?.trim() || "text-embedding-v3";

type EmbedResponse = { data?: { index?: number; embedding?: number[] }[]; error?: { message?: string } | string };

const vec = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : 0)).join(",")}]`;

/** 语义索引进度：已索引 / 总文章数 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const done = await db()`select count(*)::int n from embeddings where user_id = ${userId}`;
  const total = await db()`select count(*)::int n from articles where user_id = ${userId} and deleted = false`;
  return Response.json({ ok: true, done: done[0].n, total: total[0].n, model: DEFAULT_MODEL });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });
  let body: { baseUrl?: string; apiKey?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const base = (body.baseUrl?.trim() || process.env.AI_BASE_URL?.trim() || "").replace(/\/+$/, "");
  const key = body.apiKey?.trim() || process.env.AI_API_KEY?.trim() || process.env.TOGETHER_API_KEY || "";
  const model = body.model?.trim() || DEFAULT_MODEL;
  if (!base || !key) return Response.json({ error: "语义索引需要请求地址和密钥——在密钥弹窗里配好再来。" }, { status: 400 });

  const rows = await db()`
    select a.article_id as id, a.data->>'title' as t, a.data->>'dek' as d,
           string_agg(coalesce(r->>'text',''), ' ') as fulltext
    from articles a
    left join lateral jsonb_array_elements(a.doc->'blocks') bb on true
    left join lateral jsonb_array_elements(bb->'runs') r on true
    where a.user_id = ${userId} and a.deleted = false
      and not exists (select 1 from embeddings e where e.user_id = ${userId} and e.article_id = a.article_id)
    group by a.article_id, t, d
    order by a.data->>'addedAt' desc nulls last
    limit 20`;
  if (!rows.length) {
    const done = await db()`select count(*)::int n from embeddings where user_id = ${userId}`;
    const total = await db()`select count(*)::int n from articles where user_id = ${userId} and deleted = false`;
    return Response.json({ ok: true, embedded: 0, done: done[0].n, total: total[0].n });
  }

  const texts = rows.map((r) => `${String(r.t ?? "")}\n${String(r.d ?? "")}\n${String(r.fulltext ?? "").replace(/\s+/g, " ").slice(0, 900)}`.trim().slice(0, 1100) || "(空)");
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    let res: Response;
    try {
      res = await fetch(`${base}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, input: texts.slice(i, i + BATCH) }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      return Response.json({ error: "连不上嵌入服务——检查密钥弹窗里的地址。" }, { status: 502 });
    }
    const j = (await res.json().catch(() => ({}))) as EmbedResponse;
    if (!res.ok || !j.data?.length) {
      const msg = typeof j.error === "string" ? j.error : j.error?.message ?? res.status;
      return Response.json({ error: `嵌入服务返回错误：${msg}` }, { status: 502 });
    }
    for (const d of j.data) if (d.embedding) vectors.push(d.embedding);
  }

  if (vectors.some((v) => v.length !== DIM)) {
    return Response.json({ error: `嵌入模型输出 ${vectors[0]?.length} 维，语义索引需要 ${DIM} 维（默认 text-embedding-v3）。` }, { status: 400 });
  }

  // 归一化后入库；同时增量维护语料均值（均值中心化用）
  const meanRow = await db()`select mean, n from embed_mean where user_id = ${userId}`;
  let mean = meanRow[0] ? (JSON.parse(`[${String(meanRow[0].mean).replace(/[\[\]]/g, "")}]`) as number[]) : new Array(DIM).fill(0);
  let n = meanRow[0] ? Number(meanRow[0].n) : 0;
  if (mean.length !== DIM) mean = new Array(DIM).fill(0);

  for (let i = 0; i < rows.length; i++) {
    const v = vectors[i];
    const norm = Math.hypot(...v) || 1;
    const unit = v.map((x) => x / norm);
    await db()`
      insert into embeddings (user_id, article_id, model, embedding)
      values (${userId}, ${String(rows[i].id)}, ${model}, ${vec(unit)}::vector)
      on conflict (user_id, article_id) do update set embedding = excluded.embedding, model = excluded.model, updated_at = now()`;
    for (let d = 0; d < DIM; d++) mean[d] = (mean[d] * n + unit[d]) / (n + 1);
    n++;
  }
  await db()`
    insert into embed_mean (user_id, mean, n) values (${userId}, ${vec(mean)}::vector, ${n})
    on conflict (user_id) do update set mean = excluded.mean, n = excluded.n`;

  const done = await db()`select count(*)::int n from embeddings where user_id = ${userId}`;
  const total = await db()`select count(*)::int n from articles where user_id = ${userId} and deleted = false`;
  return Response.json({ ok: true, embedded: rows.length, done: done[0].n, total: total[0].n });
}
