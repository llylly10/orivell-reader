/** 应用人工分类结果（修正版）：classify-out-*.json → Neon topic/tags。 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const UID = process.env.GLOSS_USER_ID || "user_3L5fuAOEc9L4CDjPa8EQc83Yh49";
const KEYS = new Set(["ai","programming","infra","data","security","tech","design","product","startups","business","work","economics","money","science","health","mind","climate","philosophy","history","politics","culture","writing","learning","living","unsorted"]);

const all: Record<string, { t: string; g: string[] }> = {};
for (let i = 1; i <= 9; i++) {
  const j = JSON.parse(readFileSync(`D:/shujia/classify-out-${i}.json`, "utf8")) as Record<string, { t: string; g?: string[] }>;
  for (const [id, v] of Object.entries(j)) all[id] = { t: v.t, g: v.g ?? [] };
}
const bad = Object.entries(all).filter(([, v]) => !KEYS.has(v.t));
if (bad.length) { console.log("非法主题键:", bad.slice(0, 5)); process.exit(1); }
console.log(`分类文件共 ${Object.keys(all).length} 篇`);

let done = 0;
const entries = Object.entries(all);
for (let i = 0; i < entries.length; i += 50) {
  const slice = entries.slice(i, i + 50);
  await sql.transaction(
    slice.map(([id, v]) => sql.query(
      `update articles set
         data = data || jsonb_build_object('topic', $2::text, 'tags', $3::jsonb),
         updated_at = now()
       where user_id = $1 and article_id = $4 and deleted = false`,
      [UID, v.t, JSON.stringify(v.g), id]
    ))
  );
  done += slice.length;
}
console.log(`写入完成：${done} 篇`);

const dist = await sql.query(
  `select data->>'topic' t, count(*)::int n from articles
   where user_id = $1 and deleted = false group by 1 order by n desc`, [UID]);
const valid = dist.filter((r: any) => KEYS.has(r.t));
const invalid = dist.filter((r: any) => !KEYS.has(r.t));
console.log("\n主题分布（合法键）：");
for (const r of valid) console.log(`  ${r.t}: ${r.n}`);
const invN = invalid.reduce((s: number, r: any) => s + r.n, 0);
console.log(`\n非法/空 topic 的文章：${invN} 篇（应为 32 篇未覆盖 + 0 篇脏值）`);
