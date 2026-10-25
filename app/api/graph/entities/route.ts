import { auth } from "@clerk/nextjs/server";
import { completeJSON } from "@/lib/together";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

const EXTRACT_TASK = `从这篇内容中提取关键实体（最多 6 个）：人名、项目名、公司或产品名、技术或概念名。
返回严格的 JSON：{"entities":[{"name":"实体名","type":"person|project|company|concept"}]}。
只用内容里明确出现的名字，不要臆造；没有实体就返回 {"entities":[]}。`;

/** 实体抽取进度：已抽取的文章数 / 总文章数 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });
  const done = await db()`
    select count(distinct article_id)::int n from entities where user_id = ${userId}`;
  const total = await db()`
    select count(*)::int n from articles where user_id = ${userId} and deleted = false`;
  return Response.json({ ok: true, done: done[0].n, total: total[0].n });
}

/** 抽一批（≤20 篇）：由浏览器的三件套调用读者自己的 AI 服务，抽取结果落 entities。 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });
  let body: { ids?: string[]; baseUrl?: string; apiKey?: string; modelName?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const ids = (body.ids ?? []).map(String).filter(Boolean).slice(0, 20);
  if (!ids.length) return Response.json({ ok: true, extracted: 0 });

  const rows = await db()`
    select a.article_id as id, a.data->>'title' as t, a.data->>'dek' as d
    from articles a
    where a.user_id = ${userId} and a.deleted = false
      and not exists (select 1 from entities e where e.user_id = ${userId} and e.article_id = a.article_id)
    order by a.data->>'addedAt' desc nulls last
    limit 20`;

  let extracted = 0;
  for (const r of rows) {
    const text = [r.t, r.d].filter(Boolean).join("。 ").slice(0, 600);
    if (!text) continue;
    const res = await completeJSON<{ entities?: { name?: unknown; type?: unknown }[] }>({
      model: "flash",
      apiKey: body.apiKey,
      modelName: body.modelName,
      baseUrl: body.baseUrl,
      maxTokens: 400,
      messages: [
        { role: "user", content: `${EXTRACT_TASK}\n\n---\n${text}` },
      ],
    });
    if (!res.ok) continue;
    for (const e of res.data.entities ?? []) {
      const name = typeof e?.name === "string" ? e.name.trim().slice(0, 60) : "";
      const type = typeof e?.type === "string" && /^(person|project|company|concept)$/.test(e.type) ? e.type : "concept";
      if (!name) continue;
      await db()`
        insert into entities (user_id, article_id, name, type)
        values (${userId}, ${String(r.id)}, ${name}, ${type})
        on conflict (user_id, article_id, name) do nothing`;
      extracted++;
    }
  }

  const done = await db()`
    select count(distinct article_id)::int n from entities where user_id = ${userId}`;
  const total = await db()`
    select count(*)::int n from articles where user_id = ${userId} and deleted = false`;
  return Response.json({ ok: true, extracted, done: done[0].n, total: total[0].n });
}
