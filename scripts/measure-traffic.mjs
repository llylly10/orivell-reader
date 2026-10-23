/**
 * 多人一起用时，Neon 免费版够不够？—— 实测流量与计算消耗。
 *
 * 用 PGlite 跑真实的 schema 与真实的数据量，然后量：
 *   1. 一次 pull 往返的响应体有多大（这是流量的主要来源）
 *   2. 一次 push 的请求体有多大
 *   3. 每个人占多少存储
 *   4. 按这些数字，5GB/月流量能撑多少人
 *
 * 跑法：node scripts/measure-traffic.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const db = await PGlite.create();
for (const s of schema.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean)) await db.exec(s);

const kb = (n) => (n / 1024).toFixed(2);
const MB = 1024 * 1024;
const GB = 1024 ** 3;

// 造一个用户：10 篇文章 + 每篇 5 高亮 + 3 批注 + 进度
const WORDS = 6000;
const mkDoc = (i) => {
  const blocks = [];
  let rem = WORDS;
  while (rem > 0) {
    const n = Math.min(rem, 120);
    blocks.push({ type: "p", text: Array.from({ length: n }, () => "字").join("") });
    rem -= n;
  }
  return { id: `a${i}`, title: `文章 ${i}`, author: "某人", source: "example.com", sourceUrl: "https://example.com/x", blocks, origin: "url", addedAt: 1760000000000 };
};
const mkShelf = (d) => ({ id: d.id, title: d.title, author: d.author, source: d.source, sourceUrl: d.sourceUrl, words: WORDS, origin: d.origin, addedAt: d.addedAt });
const mkHl = (i, k) => ({ id: `h${i}_${k}`, article_id: `a${i}`, data: { quote: "被划出来的一段话", colour: "vermilion", createdAt: 1760000000000, anchor: { start: k * 10, end: k * 10 + 20 } }, deleted: false });
const mkGl = (i, k) => ({ id: `g${i}_${k}`, article_id: `a${i}`, data: { action: "ask", question: "这段在说什么？", turns: [{ role: "assistant", content: "一段回答。".repeat(30), streaming: false }], createdAt: 1760000000000 }, deleted: false });

const ARTICLES = 10;
const user = "u1";

const docs = [];
const shelf = [];
const hls = [];
const gls = [];
for (let i = 0; i < ARTICLES; i++) {
  const d = mkDoc(i);
  docs.push(d);
  shelf.push(mkShelf(d));
  for (let k = 0; k < 5; k++) hls.push(mkHl(i, k));
  for (let k = 0; k < 3; k++) gls.push(mkGl(i, k));
}

await db.query(
  `insert into articles (user_id, id, article_id, data, doc, deleted)
   select $1, r.id, r.id, r.data, r.doc, false from jsonb_to_recordset($2::jsonb) as r(id text, data jsonb, doc jsonb)`,
  [user, JSON.stringify(docs.map((d, i) => ({ id: d.id, data: shelf[i], doc: d })))]
);
await db.query(
  `insert into highlights (user_id, id, article_id, data, deleted)
   select $1, r.id, r.article_id, r.data, r.deleted from jsonb_to_recordset($2::jsonb) as r(id text, article_id text, data jsonb, deleted boolean)`,
  [user, JSON.stringify(hls)]
);
await db.query(
  `insert into glosses (user_id, id, article_id, data, deleted)
   select $1, r.id, r.article_id, r.data, r.deleted from jsonb_to_recordset($2::jsonb) as r(id text, article_id text, data jsonb, deleted boolean)`,
  [user, JSON.stringify(gls)]
);

console.log("\n多人场景实测\n");

// ---------- 1. 存储：每人占多少 ----------
const cols = await db.query(`
  select
    (select coalesce(sum(octet_length(doc::text)),0) from articles) +
    (select coalesce(sum(octet_length(data::text)),0) from articles) +
    (select coalesce(sum(octet_length(data::text)),0) from highlights) +
    (select coalesce(sum(octet_length(data::text)),0) from glosses) as s
`);
const perUser = Number(cols.rows[0].s);
console.log(`  每人存储（10 篇文章 + 50 高亮 + 30 批注）：${kb(perUser)} KB`);
console.log(`  → 1 GB 够放 ${Math.floor(GB / perUser).toLocaleString()} 个人\n`);

// ---------- 2. pull 往返：全量首次拉 ----------
// 这是最坏情况：新设备第一次同步，拉全部变化
const pullAll = await db.query(`
  select 'articles' as t, id, article_id, data, deleted from articles where user_id = $1
  union all select 'highlights', id, article_id, data, deleted from highlights where user_id = $1
  union all select 'glosses', id, article_id, data, deleted from glosses where user_id = $1
  union all select 'briefs', id, article_id, data, deleted from briefs where user_id = $1
  union all select 'progress', id, article_id, data, deleted from progress where user_id = $1
`, [user]);
const pullAllBytes = JSON.stringify({ now: new Date().toISOString(), changes: { articles: pullAll.rows } }).length;
console.log(`  pull 响应体（首次全量，不含正文）：${kb(pullAllBytes)} KB`);

// ---------- 3. pull 往返：增量（日常） ----------
// 30 秒重叠窗口内没有变化时，响应体只有 now + 空 changes
const pullEmpty = JSON.stringify({ now: new Date().toISOString(), changes: { articles: [], highlights: [], glosses: [], briefs: [], progress: [] } }).length;
console.log(`  pull 响应体（日常增量，无变化）：${kb(pullEmpty)} KB`);

// 一次典型改动：1 篇文章的标题变了
const oneChange = JSON.stringify({ now: new Date().toISOString(), changes: { articles: [pullAll.rows[0]] } }).length;
console.log(`  pull 响应体（改了 1 篇文章）：${kb(oneChange)} KB\n`);

// ---------- 4. push 请求体 ----------
const pushBody = JSON.stringify({ changes: { articles: shelf.map((s) => ({ id: s.id, articleId: s.id, data: s })) } }).length;
console.log(`  push 请求体（10 篇文章的书架条目）：${kb(pushBody)} KB`);

// ---------- 5. 流量测算 ----------
console.log("  流量测算（每人每天）：\n");
const WATCH_SEC = Number(process.env.WATCH_SEC || 5); // 书架页的拉取间隔（秒）
const dailyPulls = Math.floor((24 * 60 * 60) / WATCH_SEC);
const dailyTraffic = dailyPulls * pullEmpty * 2; // 请求 + 响应，各算一份
console.log(`    书架页每 ${WATCH_SEC} 秒拉一次 → 一天约 ${dailyPulls} 次`);
console.log(`    日常拉取流量：${kb(dailyTraffic)} KB/天`);
console.log(`    新设备首次全量同步：${kb(pullAllBytes)} KB（一次性）`);

const MONTH = 30;
const freeTraffic = 5 * GB; // 每项目每月 5GB
const perPersonMonthly = dailyTraffic * MONTH + pullAllBytes;
const people = Math.floor(freeTraffic / perPersonMonthly);
console.log(`\n  每人每月约 ${kb(perPersonMonthly)} KB`);
console.log(`  5 GB/月 的免费流量 → 约支撑 ${people.toLocaleString()} 人（都只增量同步、无新设备）\n`);

// 不同同步间隔下的对比
console.log("  换同步间隔（间隔越长，流量与查询越省）：\n");
for (const sec of [5, 15, 30, 60]) {
  const n = Math.floor((24 * 60 * 60) / sec);
  const traffic = (n * pullEmpty * 2 * MONTH + pullAllBytes) / 1024;
  const p = Math.floor(freeTraffic / (traffic * 1024));
  console.log(`    ${String(sec).padStart(2)} 秒 → 每人 ${(traffic / 1024).toFixed(0).padStart(5)} KB/月，支撑 ${p.toLocaleString().padStart(7)} 人`);
}
console.log();

// ---------- 6. 计算（CU-小时）----------
// 一次 pull 是一组查询：1 个 clock + 5 个 select = 6 次
const queriesPerPull = 6;
console.log(`  计算消耗：一次 pull = ${queriesPerPull} 个查询（1 个时钟 + 5 张表）`);
console.log(`  每天 ${dailyPulls} 次 → 每人每天约 ${dailyPulls * queriesPerPull} 个查询`);
console.log(`  Neon 的计费单位是 CU-小时（0.25 CU 可跑 400 小时/月 = 100 CU-小时）`);
console.log(`  个人使用时计算几乎不占；多人时每个读者都在拉，主要成本是查询次数。\n`);

// ---------- 7. 真正的瓶颈 ----------
console.log("  结论：真正的瓶颈不是 Neon 的额度，是别的：\n");
console.log("    · Clerk 免费版 50,000 月活 —— 人数上限在这");
console.log("    · 存储 1GB —— 每个人 10 篇文章约占 240KB，1GB 够 4,000+ 人");
console.log("    · 流量 5GB/月 —— 纯增量同步的话够上千人");
console.log("    · 但每篇文章的正文只存一份（不按人重复），共享书架其实更省\n");
console.log("  跑法：node scripts/measure-traffic.mjs");
