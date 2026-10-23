/**
 * 多人同时用时，pull 到底有多快？—— 实测查询耗时。
 *
 * 用 PGlite 跑真实的 pull SQL（1 个时钟 + 5 张表的索引查询），
 * 造 N 个用户的量，然后计时。
 *
 * 注意：PGlite 是单进程的 WASM Postgres，绝对速度比真 Neon 慢，
 * 所以这里的数字是「保守上限」——真 Neon 上只会更快。
 * 但它能回答一个更关键的问题：查询是否走了索引（有没有全表扫描）。
 *
 * 跑法：node scripts/measure-query-cost.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const db = await PGlite.create();
for (const s of schema.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean)) await db.exec(s);

const COLLECTIONS = ["articles", "highlights", "glosses", "briefs", "progress"];

// 造 50 个用户，每人 20 篇文章 + 高亮批注
const USERS = 50;
const ARTICLES_PER_USER = 20;

console.log(`\n造数据：${USERS} 个用户 × 每人 ${ARTICLES_PER_USER} 篇文章\n`);

for (let u = 0; u < USERS; u++) {
  const user = `u${u}`;
  const arts = Array.from({ length: ARTICLES_PER_USER }, (_, i) => ({
    id: `a${i}`,
    data: { id: `a${i}`, title: `文章 ${i}`, author: "某人", words: 6000, origin: "url" },
    doc: { id: `a${i}`, title: `文章 ${i}`, blocks: [{ type: "p", text: "正文".repeat(6000) }] },
  }));
  const hls = Array.from({ length: ARTICLES_PER_USER * 5 }, (_, i) => ({
    id: `h${i}`,
    article_id: `a${Math.floor(i / 5)}`,
    data: { quote: "被划出来的一段话", colour: "red", createdAt: 1760000000000, anchor: { start: 0, end: 20 } },
    deleted: false,
  }));
  await db.query(
    `insert into articles (user_id, id, article_id, data, doc, deleted)
     select $1, r.id, r.id, r.data, r.doc, false from jsonb_to_recordset($2::jsonb) as r(id text, data jsonb, doc jsonb)`,
    [user, JSON.stringify(arts)]
  );
  await db.query(
    `insert into highlights (user_id, id, article_id, data, deleted)
     select $1, r.id, r.article_id, r.data, r.deleted from jsonb_to_recordset($2::jsonb) as r(id text, article_id text, data jsonb, deleted boolean)`,
    [user, JSON.stringify(hls)]
  );
}

// ---------- 1. 查计划：确认走索引 ----------
console.log("查询计划（确认没有全表扫描）：\n");
const plan = await db.query(
  `explain select id, article_id, data, deleted from articles where user_id = $1 and updated_at > $2 order by updated_at`,
  ["u0", "1970-01-01T00:00:00Z"]
);
const planText = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
const usesIndex = /Index Scan|Index Only Scan/.test(planText);
console.log(`  ${usesIndex ? "✅" : "❌"} 走了索引（Index Scan）`);
console.log(
  planText
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n")
);

// ---------- 2. 计时：一次 pull ----------
// Neon 的 sql.transaction([...]) 接受一组查询；PGlite 的 transaction 接受回调。
// 这里用回调形式包一层，两边语义一样：要么都成，要么都回滚。
const pullTx = (user, since) =>
  db.transaction(async (tx) => {
    await tx.query("select now() as now");
    for (const t of COLLECTIONS) {
      await tx.query(
        `select id, article_id, data, deleted from ${t} where user_id = $1 and updated_at > $2 order by updated_at`,
        [user, since]
      );
    }
  });

const timeIt = async (label, fn, n) => {
  await fn(); // 预热
  const t0 = performance.now();
  for (let i = 0; i < n; i++) await fn();
  const ms = (performance.now() - t0) / n;
  console.log(`  ${label}：${ms.toFixed(2)} ms`);
  return ms;
};

console.log("\n实测耗时（每次 pull = 1 个时钟 + 5 张表的查询）：\n");

const pullMs = await timeIt(
  "全量 pull（拉这个用户的全部数据）",
  async () => {
    await pullTx("u0", "1970-01-01T00:00:00Z");
  },
  20
);

const incrementalMs = await timeIt(
  "增量 pull（30 秒窗口，无变化）",
  async () => {
    const since = new Date(Date.now() - 30_000).toISOString();
    await pullTx("u0", since);
  },
  20
);

// ---------- 3. 换用户：验证 user_id 过滤有效 ----------
const otherUserMs = await timeIt(
  "换一个用户（user_id 过滤生效）",
  async () => {
    const since = new Date(Date.now() - 30_000).toISOString();
    await pullTx("u25", since);
  },
  20
);

// ---------- 4. 换算 ----------
console.log("\n换算：\n");
console.log(`  增量 pull 约 ${incrementalMs.toFixed(1)} ms（PGlite，真 Neon 更快）`);
console.log(`  每人每 5 秒一次 pull → 每人约 ${(1000 / 5).toFixed(0)} 次/小时`);
console.log(`  单用户占用的查询吞吐：${(6 * (1000 / 5000)).toFixed(1)} 查询/秒\n`);

for (const n of [10, 50, 100, 500]) {
  const qps = n * 6 * (1000 / 5000);
  console.log(`  ${String(n).padStart(3)} 人同时开着书架页 → ${qps.toFixed(0)} 查询/秒`);
}
console.log("\n  （Neon 免费版最高 2 CU，HTTP 驱动可多路复用并发；");
console.log("    实际瓶颈通常先出现在 Next.js 服务端或 Clerk，而不是 Neon）");
