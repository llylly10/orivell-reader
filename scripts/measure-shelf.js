/**
 * 量一下本地书架到底有多大 —— 用来判断新增的 held 记录会不会把配额推爆。
 *
 * 读账号里真实用户的全部正文，算出：
 *   - 书架本身（gloss:v1）的大小
 *   - 同步基线（gloss:sync:*）的大小
 *   - held 记录（每个 id 一个 true）的大小
 *
 * 跑法：node scripts/measure-shelf.js
 */
const fs = require("fs");
const path = require("path");
const { neon } = require("@neondatabase/serverless");

const ROOT = path.join(__dirname, "..");
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const USER = process.argv[2] || "user_3L5fuAOEc9L4CDjPa8EQc83Yh49";

const sql = neon(url);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

(async () => {
  console.log(`\n量一下 ${USER} 的书架\n`);

  let shelfBytes = 0;
  let baselineBytes = 0;
  let heldBytes = 0;
  let ids = 0;

  for (const t of ["articles", "highlights", "glosses", "briefs", "progress"]) {
    const rows = await sql.query(
      `select id, article_id, data::text as data from ${t} where user_id = $1 and not deleted`,
      [USER]
    );
    if (!rows.length) continue;
    const shelf = {};
    const seen = {};
    let held = {};
    for (const r of rows) {
      const d = r.data ? JSON.parse(r.data) : {};
      // 书架里放的是 data 本身
      shelf[r.id] = d;
      // 基线里放的是 [稳定 key, articleId]；key 是 data 的稳定序列化，这里用它的大小估算
      seen[r.id] = [JSON.stringify(d), r.article_id];
      // held 记录：每个 id 一个 true
      held[r.id] = true;
      ids++;
    }
    const s = JSON.stringify(shelf).length;
    const b = JSON.stringify(seen).length;
    const h = JSON.stringify(held).length;
    shelfBytes += s;
    baselineBytes += b;
    heldBytes += h;
    console.log(`  ${t.padEnd(11)} ${String(rows.length).padStart(5)} 行   书架 ${kb(s).padStart(10)}   基线 ${kb(b).padStart(10)}   held ${kb(h).padStart(9)}`);
  }

  console.log(`\n  合计 ${ids} 行`);
  console.log(`  书架（gloss:v1）      ${mb(shelfBytes)}`);
  console.log(`  基线（gloss:sync:*）  ${mb(baselineBytes)}`);
  console.log(`  held 记录（新增）     ${mb(heldBytes)}`);
  const total = shelfBytes + baselineBytes + heldBytes;
  console.log(`  三者相加              ${mb(total)}   （localStorage 通常 5 MB）`);

  // 真正挤爆的常常不是书架，而是每篇文章的正文全文。
  const docs = await sql.query(
    `select count(*)::int as n, sum(length(doc::text))::int as bytes from articles where user_id = $1`,
    [USER]
  );
  const n = docs[0]?.n ?? 0;
  const bytes = docs[0]?.bytes ?? 0;
  console.log(`\n  文章正文共 ${n} 篇，${mb(bytes)}`);
  console.log(`  正文现在存在 IndexedDB（gloss:doc:*），不占 localStorage。`);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
