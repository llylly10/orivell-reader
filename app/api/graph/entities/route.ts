import { auth } from "@clerk/nextjs/server";
import { completeJSON } from "@/lib/together";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * 实体抽取提示词（v2，依 2025-26 实证研究升级）：
 * - 保留原文文字不翻译——翻译后的名字永远无法与另一语言里的同一实体汇合
 * - 每实体可带 aliases（别名），作为归一化的免费种子数据
 * - 「不确定的不抽」精度指令（few-shot 研究里显著优于零容忍缺失）
 * - handle 与话题标签通常不是实体
 */
const EXTRACT_TASK = `从这篇内容中提取关键实体（最多 6 个）：人名、项目名、公司或产品名、技术或概念名。
规则：
- 实体名保留原文文字（中文就是中文，英文就是英文），不要翻译
- 不确定的、只在句子里顺带一提的，不要抽
- @handle 和 #话题标签 不是实体
返回严格 JSON：{"entities":[{"name":"实体名","type":"person|project|company|concept","aliases":["可选别名"]}]}
没有实体就返回 {"entities":[]}。`;

/** 归一化键：拉丁转小写、去标点空白；CJK 原样（同物异写由后续别名合并处理） */
function canonicalName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .trim()
    .toLowerCase() // CJK 无大小写，不受影响
    .replace(/\s+/g, " ");
}

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

/** 抽一批（服务端自取未抽取的下 20 篇）：浏览器三件套出模型，结果落 entities。 */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in first." }, { status: 401 });
  let body: { baseUrl?: string; apiKey?: string; modelName?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

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
    const res = await completeJSON<{ entities?: { name?: unknown; type?: unknown; aliases?: unknown }[] }>({
      model: "flash",
      apiKey: body.apiKey,
      modelName: body.modelName,
      baseUrl: body.baseUrl,
      maxTokens: 400,
      messages: [{ role: "user", content: `${EXTRACT_TASK}\n\n---\n${text}` }],
    });
    if (!res.ok) continue;
    for (const e of res.data.entities ?? []) {
      const display = typeof e?.name === "string" ? e.name.trim().slice(0, 60) : "";
      const name = canonicalName(display);
      const type = typeof e?.type === "string" && /^(person|project|company|concept)$/.test(e.type) ? e.type : "concept";
      if (!name) continue;
      const aliases = Array.isArray(e?.aliases) ? JSON.stringify(e.aliases.filter((x) => typeof x === "string").slice(0, 4)) : null;
      await db()`
        insert into entities (user_id, article_id, name, type, display, aliases)
        values (${userId}, ${String(r.id)}, ${name}, ${type}, ${display}, ${aliases})
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
