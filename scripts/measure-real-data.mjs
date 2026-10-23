/**
 * 用真实数据算：你的 X 书签库放进 Neon 要占多少。
 *
 * 数据来源：gloss-library/data/library.db（1039 篇真实文章，
 * 其中 1028 篇是 X 书签、11 篇是网页文章）。
 * 这不是造的数据 —— 是你实际存下来的东西。
 *
 * 做法：把 articles 表原样灌进 Gloss 的 Postgres schema（articles/highlights/
 * glosses/briefs/progress 五张表），然后量 Postgres 里实际占的字节。
 *
 * 跑法：node scripts/measure-real-data.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const db = await PGlite.create();
for (const s of schema.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean)) await db.exec(s);

const KB = (n) => (n / 1024).toFixed(1);
const MB = (n) => (n / 1024 / 1024).toFixed(2);
const GB = 1024 ** 3;

// ---------- 读 SQLite（better-sqlite3 或 node:sqlite 都可能，用哪个都行） ----------
const LIB = "D:/shujia/gloss-library/data/library.db";
if (!existsSync(LIB)) {
  console.log(`\n找不到 ${LIB}\n先跑 gloss-library 的导入脚本生成数据，或改这里的路径。\n`);
  process.exit(1);
}

let rows;
try {
  // node:sqlite（Node 22+ 内置）
  const { DatabaseSync } = await import("node:sqlite");
  const sq = new DatabaseSync(LIB, { readOnly: true });
  rows = sq.prepare("select id,url,title,author,site_name,excerpt,content,word_count,minutes,status,topic,tags,favicon,saved_at,read_at,progress from articles").all();
  sq.close();
} catch (e) {
  console.log("\n读不了 SQLite：", e.message);
  console.log("可以用 python3 -c 把数据导成 JSON 再跑。\n");
  process.exit(1);
}

const N = rows.length;
console.log("\n用你的真实数据算\n");
console.log(`  数据源：gloss-library/data/library.db`);
console.log(`  文章数：${N}`);

// ---------- 分成 X 书签与网页文章 ----------
const isX = (r) => /x\.com|twitter\.com/.test(String(r.url ?? ""));
const xRows = rows.filter(isX);
const webRows = rows.filter((r) => !isX(r));
console.log(`  其中 X 书签 ${xRows.length} 篇，网页文章 ${webRows.length} 篇\n`);

// ---------- 造 Gloss 的数据形态 ----------
// 书架条目 = data（不含正文），正文 = doc
const shelfOf = (r) => ({
  id: String(r.id),
  url: String(r.url ?? ""),
  title: String(r.title ?? ""),
  author: String(r.author ?? ""),
  siteName: String(r.site_name ?? ""),
  excerpt: String(r.excerpt ?? ""),
  words: Number(r.word_count ?? 0),
  minutes: Number(r.minutes ?? 0),
  status: String(r.status ?? "new"),
  topic: String(r.topic ?? ""),
  tags: JSON.parse(String(r.tags ?? "[]")),
  favicon: String(r.favicon ?? ""),
  savedAt: Number(r.saved_at ?? 0),
  readAt: r.read_at ?? null,
  progress: Number(r.progress ?? 0),
  origin: isX(r) ? "x" : "url",
});

const USER = "u1";
const toInsert = rows.map((r) => ({
  data: shelfOf(r),
  doc: { id: String(r.id), title: String(r.title ?? ""), author: String(r.author ?? ""), url: String(r.url ?? ""), content: String(r.content ?? "") },
}));

// 分批插入（一次 1039 条的 jsonb 太大）
// id 必须在 jsonb 顶层，jsonb_to_recordset 才能取到
const BATCH = 100;
for (let i = 0; i < toInsert.length; i += BATCH) {
  const slice = toInsert.slice(i, i + BATCH);
  await db.query(
    `insert into articles (user_id, id, article_id, data, doc, deleted)
     select $1, r.id, r.id, r.data, r.doc, false
     from jsonb_to_recordset($2::jsonb) as r(id text, data jsonb, doc jsonb)`,
    [USER, JSON.stringify(slice.map((s) => ({ id: s.data.id, data: s.data, doc: s.doc })))]
  );
}

// 顺带造高亮与批注（用真实比例：每篇 1-2 条高亮、偶尔有批注）
// 截断引文时按码点切，不能按 UTF-16 码元切 —— 后者会把 emoji 劈成半个，
// 半个代理对进不了 jsonb（Unicode low surrogate must follow a high surrogate）。
const cut = (s, n) => {
  const chars = [...String(s ?? "")]; // 按码点拆
  return chars.length <= n ? chars.join("") : chars.slice(0, n).join("");
};

const highlights = [];
const glosses = [];
rows.forEach((r, i) => {
  const id = String(r.id);
  if (i % 3 === 0) {
    highlights.push({ id: `h${i}`, article_id: id, data: { quote: cut(r.excerpt, 80), colour: "vermilion", createdAt: Number(r.saved_at ?? 0), anchor: { start: 0, end: 40 } }, deleted: false });
  }
  if (i % 50 === 0) {
    glosses.push({ id: `g${i}`, article_id: id, data: { action: "ask", question: "这段在说什么？", turns: [{ role: "assistant", content: "一段回答。".repeat(30), streaming: false }], createdAt: Number(r.saved_at ?? 0) }, deleted: false });
  }
});
if (highlights.length) {
  await db.query(
    `insert into highlights (user_id, id, article_id, data, deleted)
     select $1, r.id, r.article_id, r.data, r.deleted from jsonb_to_recordset($2::jsonb) as r(id text, article_id text, data jsonb, deleted boolean)`,
    [USER, JSON.stringify(highlights)]
  );
}
if (glosses.length) {
  await db.query(
    `insert into glosses (user_id, id, article_id, data, deleted)
     select $1, r.id, r.article_id, r.data, r.deleted from jsonb_to_recordset($2::jsonb) as r(id text, article_id text, data jsonb, deleted boolean)`,
    [USER, JSON.stringify(glosses)]
  );
}

// ---------- 量实际占用 ----------
const sizeOf = async (t, c) => {
  const r = await db.query(`select coalesce(sum(octet_length(${c}::text)),0)::bigint as s from ${t}`);
  return Number(r.rows[0].s);
};

const docBytes = await sizeOf("articles", "doc");
const dataBytes = await sizeOf("articles", "data");
const hlBytes = await sizeOf("highlights", "data");
const glBytes = await sizeOf("glosses", "data");
const total = docBytes + dataBytes + hlBytes + glBytes;

console.log("  Postgres 里实际占的字节（jsonb 存下的，去掉了重复键与空白）：\n");
console.log(`    正文 doc      ${KB(docBytes).padStart(10)} KB`);
console.log(`    书架条目 data  ${KB(dataBytes).padStart(10)} KB`);
console.log(`    高亮          ${KB(hlBytes).padStart(10)} KB  (${highlights.length} 条)`);
console.log(`    批注          ${KB(glBytes).padStart(10)} KB  (${glosses.length} 条)`);
console.log(`    ─────────────────────────────`);
console.log(`    合计          ${KB(total).padStart(10)} KB  (${MB(total)} MB)\n`);

const perArticle = total / N;
console.log(`  平均每篇：${KB(perArticle)} KB\n`);

// ---------- 换算 ----------
console.log("  换成 Neon 免费版：\n");
const freeGB = GB;
console.log(`    存储 1 GB → 你这一库占 ${((total / freeGB) * 100).toFixed(2)}%，`);
console.log(`             还能再放 ${Math.floor((freeGB - total) / perArticle).toLocaleString()} 篇同样的文章`);
console.log(`             即总共约 ${Math.floor(freeGB / perArticle).toLocaleString()} 篇\n`);

console.log("  按人算（每人一份这样的库）：\n");
for (const n of [1, 10, 50, 100]) {
  const need = total * n;
  console.log(`    ${String(n).padStart(3)} 人 → ${MB(need).padStart(8)} MB  ${need <= freeGB ? "✅ 免费额度内" : "❌ 超出免费额度"}`);
}
console.log();

// 跟 SQLite 库对比
const { statSync } = await import("node:fs");
const sqliteSize = statSync(LIB).size;
console.log("  对比你的 SQLite 库：\n");
console.log(`    library.db        ${MB(sqliteSize)} MB（含 FTS 全文索引 + 所有索引）`);
console.log(`    Postgres 需要     ${MB(total)} MB（jsonb 数据本身，不建全文索引）`);
console.log(`    差别主要在 FTS：SQLite 为搜索建了 articles_fts 一整套倒排索引，Postgres 侧不需要。\n`);

// ---------- 流量：新设备第一次同步要拉多少 ----------
// 首次同步是全量的：书架条目全要（正文按需单独取）
const fullShelf = await db.query("select data from articles where user_id = $1", [USER]);
const shelfJson = JSON.stringify(fullShelf.rows.map((r) => r.data));
const fullHl = await db.query("select data from highlights where user_id = $1", [USER]);
const fullGl = await db.query("select data from glosses where user_id = $1", [USER]);

// 加上 HTTP 开销：实测一次空 pull 是 205 字节，头部约 200 字节
const HTTP_OVERHEAD = 400;
const firstSync = shelfJson.length + fullHl.rows.length * 200 + fullGl.rows.length * 200 + HTTP_OVERHEAD;

console.log("  新设备第一次同步（跨设备）要拉多少：\n");
console.log(`    书架条目全量   ${KB(shelfJson.length)} KB`);
console.log(`    高亮 + 批注    ${KB((fullHl.rows.length + fullGl.rows.length) * 200)} KB`);
console.log(`    ───────────────────────`);
console.log(`    合计           ${KB(firstSync)} KB（不含正文，正文按需单独取）\n`);

// 正文是最大的部分，但只在打开某篇时才取
const docJson = await db.query("select doc from articles where user_id = $1 limit 1", [USER]);
const oneDoc = JSON.stringify(docJson.rows[0].doc).length;
console.log(`    另外：打开一篇文章时单独取正文，约 ${KB(oneDoc)} KB/篇\n`);

const GB_ = 1024 ** 3;
const freeTraffic = 5 * GB_;
console.log("  换成 5 GB/月 的免费流量：\n");
console.log(`    每个新设备首次同步 ${KB(firstSync)} KB`);
console.log(`    → 能支撑 ${Math.floor(freeTraffic / firstSync).toLocaleString()} 个新设备首次同步`);
console.log(`    （之后每次同步只拉增量，约 205 字节）\n`);

console.log("  跑法：node --experimental-sqlite scripts/measure-real-data.mjs");
