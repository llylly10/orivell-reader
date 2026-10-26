/**
 * 服务端一键全库归类：把所有未分类的文章交给读者自己的模型（AI_BASE_URL +
 * AI_API_KEY，模型 AI_MODEL 默认 qwen-plus），写 topic/tags/scene 进 Neon。
 *
 * 与客户端 /api/shelve 同一提示词、同一主题枚举；直接更新 data jsonb 并
 * 提 updated_at，客户端下次 pull 即收架。手动归过的（topic 已有）不动。
 *
 * 跑法：node --env-file-if-exists=.env.local --experimental-strip-types scripts/classify-all.mts [--limit 50]
 */
import { neon } from "@neondatabase/serverless";
import { TOPICS } from "../lib/library.ts";

const url = process.env.DATABASE_URL;
const base = (process.env.AI_BASE_URL || "").replace(/\/+$/, "");
const key = process.env.AI_API_KEY || "";
const model = process.env.AI_MODEL || "qwen-plus";
const UID = process.env.GLOSS_USER_ID || "user_3L5fuAOEc9L4CDjPa8EQc83Yh49";
const LIMIT = Number(/--limit (\d+)/.exec(process.argv.join(" "))?.[1] ?? 0);

if (!url || !base || !key) {
  console.log("缺配置：DATABASE_URL / AI_BASE_URL / AI_API_KEY（.env.local）。");
  process.exit(1);
}

const SYSTEM = `You shelve texts in a reader's personal library.

Pick the one topic that fits best, by its key:
${TOPICS.filter((t) => t.key !== "unsorted")
  .map((t) => `- ${t.key}: ${t.hint}`)
  .join("\n")}

Then up to 3 tags: short lowercase words or phrases that say what the text is about, more specific than the topic.

Then a scene for a wordless book-cover illustration: one concrete visual metaphor, under 30 words, no text/letters/logos.

Reply with JSON only: {"topic": "<key>", "tags": ["..."], "scene": "..."}`;

const sql = neon(url);

async function classifyOne(item: { id: string; t: string; d: string; open: string }) {
  const lines = [item.t, item.d, item.open].filter(Boolean).join("\n").slice(0, 1200);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0.3, max_tokens: 220, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: lines }] }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = j.choices?.[0]?.message?.content ?? "";
  const txt = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  return JSON.parse(txt) as { topic?: string; tags?: string[]; scene?: string };
}

const rows = await sql`
  select a.article_id as id, a.data->>'title' as t, a.data->>'dek' as d,
         string_agg(coalesce(r->>'text',''), ' ') as fulltext
  from articles a
  left join lateral jsonb_array_elements(a.doc->'blocks') bb on true
  left join lateral jsonb_array_elements(bb->'runs') r on true
  where a.user_id = ${UID} and a.deleted = false
    and (a.data->>'topic' is null or a.data->>'topic' = '' or a.data->>'topic' = 'unsorted')
  group by a.article_id, t, d
  order by a.data->>'addedAt' desc`;
const todo = LIMIT ? rows.slice(0, LIMIT) : rows;
console.log(`未分类 ${rows.length} 篇，本次处理 ${todo.length} 篇（模型 ${model}）`);

const KEYS = new Set(TOPICS.map((t) => t.key));
let done = 0;
let failed = 0;
let i = 0;
const worker = async () => {
  while (i < todo.length) {
    const item = todo[i++];
    const it = { id: String(item.id), t: String(item.t ?? ""), d: String(item.d ?? ""), open: String(item.fulltext ?? "").replace(/\s+/g, " ").slice(0, 600) };
    try {
      const c = await classifyOne(it);
      const topic = c.topic && KEYS.has(c.topic) ? c.topic : "unsorted";
      const tags = Array.isArray(c.tags) ? c.tags.filter((x) => typeof x === "string").slice(0, 3) : [];
      const scene = typeof c.scene === "string" ? c.scene.slice(0, 300) : undefined;
      await sql`
        update articles set
          data = data || jsonb_build_object('topic', ${topic}, 'tags', ${JSON.stringify(tags)}::jsonb, 'scene', ${scene ?? null}::jsonb),
          updated_at = now()
        where user_id = ${UID} and article_id = ${it.id}`;
      done++;
    } catch (e) {
      failed++;
      if (failed <= 3) console.log(`  失败 #${it.id}: ${String(e).slice(0, 100)}`);
    }
    if ((done + failed) % 50 === 0) console.log(`  进度 ${done + failed}/${todo.length}（成功 ${done} 失败 ${failed}）`);
  }
};
await Promise.all([worker(), worker()]);
console.log(`完成：成功 ${done}，失败 ${failed}。打开书架刷新即可看到分区。`);
