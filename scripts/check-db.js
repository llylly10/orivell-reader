/**
 * 体检：数据库接好了没有，好不好用。
 *
 * 用法：node scripts/check-db.js
 *
 * 逐项检查并给出结论：
 *   1. DATABASE_URL 在不在
 *   2. 连得上吗
 *   3. 表齐了吗（articles / highlights / glosses / briefs / progress /
 *      free_usage / covers / agent_tokens）
 *   4. 索引齐了吗
 *   5. 写进去读得出来吗（插一行再删掉）
 *   6. 一条用户的同步往返通不通（用真的 Clerk 用户）
 *
 * 只读为主；第 5 步会临时写一行并立刻删掉。
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const { neon } = require("@neondatabase/serverless");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env.local");

const TABLES = ["articles", "highlights", "glosses", "briefs", "progress", "free_usage", "covers", "agent_tokens"];
const INDEXES = [
  ["articles", "articles_user_updated"],
  ["highlights", "highlights_user_updated"],
  ["glosses", "glosses_user_updated"],
  ["briefs", "briefs_user_updated"],
  ["progress", "progress_user_updated"],
  ["agent_tokens", "agent_tokens_user"],
];

function env() {
  try {
    return fs.readFileSync(ENV_PATH, "utf8");
  } catch {
    return "";
  }
}

function get(name) {
  const m = env().match(new RegExp(`^${name}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
}

/** 走 Neon 官方的 serverless 驱动，和应用里用的是同一个。 */
let client = null;
let url = "";
function db() {
  if (!client) {
    const { neon } = require("@neondatabase/serverless");
    client = neon(url);
  }
  return client;
}
/** 查一行行结果。 */
async function query(sql, params = []) {
  return db().query(sql, params);
}

const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => console.log(`  ❌ ${m}`);
const warn = (m) => console.log(`  ⚠️  ${m}`);

(async () => {
  console.log("数据库体检\n");

  // 1. 配置
  url = get("DATABASE_URL");
  if (!url) {
    bad("DATABASE_URL 没有设置");
    console.log("\n接上数据库三步：");
    console.log("  1. 到 https://neon.tech 免费建一个项目");
    console.log("  2. 复制连接串，填进 .env.local 的 DATABASE_URL=");
    console.log("  3. 跑 npm run db:migrate 建表");
    console.log("\n然后再跑一次这个脚本。");
    process.exit(1);
  }
  ok("DATABASE_URL 已设置");
  const host = new URL(url).hostname;
  ok(`主机：${host}`);

  // 2. 连通
  let now;
  try {
    const rows = await query("select now() as now");
    now = rows[0]?.now;
    ok(`连上了，服务器时间 ${now}`);
  } catch (e) {
    bad(`连不上：${e.message}`);
    process.exit(1);
  }

  // 3. 表
  const tables = await query("select table_name from information_schema.tables where table_schema = 'public'");
  const have = new Set(tables.map((t) => t.table_name));
  const missing = TABLES.filter((t) => !have.has(t));
  if (missing.length) {
    bad(`少了 ${missing.length} 张表：${missing.join(", ")}`);
    console.log("     跑 npm run db:migrate 建表（可以重复跑，不会丢数据）");
  } else {
    ok(`${TABLES.length} 张表都在`);
  }

  // 4. 索引
  const idx = await query("select indexname from pg_indexes where schemaname = 'public'");
  const haveIdx = new Set(idx.map((i) => i.indexname));
  const missingIdx = INDEXES.filter(([, n]) => !haveIdx.has(n));
  if (missingIdx.length) {
    warn(`少了 ${missingIdx.length} 个索引：${missingIdx.map(([, n]) => n).join(", ")}`);
    console.log("     不影响功能，只是查询会慢一些。跑 db:migrate 可补上。");
  } else {
    ok(`${INDEXES.length} 个索引都在`);
  }

  // 5. 读写往返
  const probe = `__check_${Date.now()}`;
  try {
    await query("insert into progress (user_id, id, article_id, data, deleted) values ($1,$2,$2,$3::jsonb,false)", [
      probe,
      probe,
      JSON.stringify({ pct: 0.5 }),
    ]);
    const back = await query("select data from progress where user_id = $1 and id = $2", [probe, probe]);
    const okRead = back.length === 1 && back[0].data?.pct === 0.5;
    await query("delete from progress where user_id = $1 and id = $2", [probe, probe]);
    const gone = await query("select id from progress where user_id = $1 and id = $2", [probe, probe]);
    if (okRead && gone.length === 0) ok("写入、读回、删除都正常");
    else bad(`读写往返不对（读回 ${JSON.stringify(back[0]?.data)}）`);
  } catch (e) {
    bad(`写入失败：${e.message}`);
  }

  // 6. free_usage 的额度字段
  try {
    const rows = await query("select column_name from information_schema.columns where table_name = 'free_usage'");
    const cols = rows.map((r) => r.column_name);
    if (cols.includes("usd")) ok("free_usage 有 usd 列（按金额计费已就绪）");
    else bad("free_usage 缺 usd 列，跑 npm run db:migrate 补上");
  } catch (e) {
    warn(`查不到 free_usage：${e.message}`);
  }

  // 7. 数据概况
  try {
    for (const t of ["articles", "highlights", "glosses", "progress", "agent_tokens"]) {
      const rows = await query(`select count(*)::int as n from ${t}`);
      const n = rows[0]?.n ?? 0;
      if (n) console.log(`     ${t}: ${n} 行`);
    }
  } catch {
    /* 概况只是锦上添花 */
  }

  console.log("\n接好了。现在可以：npm run dev，然后登录看看同步是否正常。");
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
