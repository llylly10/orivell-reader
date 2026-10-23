/**
 * 接上 Neon —— 一步到位。
 *
 * 用法：node scripts/connect-neon.js
 *   或者：node scripts/connect-neon.js "postgresql://..."
 *
 * 它会问你要连接串（也可以直接传），然后自动做完剩下的事：
 *   1. 备份 .env.local
 *   2. 写入 DATABASE_URL
 *   3. 建表（db/schema.sql，幂等）
 *   4. 体检（表齐不齐、索引齐不齐、写得进去读得出来吗）
 *   5. 报告结果
 *
 * 查询走 Neon 官方的 serverless 驱动（@neondatabase/serverless），
 * 和应用里用的是同一个 —— 走 https，不占 TCP 连接。
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { neon } = require("@neondatabase/serverless");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env.local");

const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => console.log(`  ❌ ${m}`);
const warn = (m) => console.log(`  ⚠️  ${m}`);

const TABLES = ["articles", "highlights", "glosses", "briefs", "progress", "free_usage", "covers", "agent_tokens"];
const INDEXES = [
  "articles_user_updated",
  "highlights_user_updated",
  "glosses_user_updated",
  "briefs_user_updated",
  "progress_user_updated",
  "agent_tokens_user",
];

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

function isValidUrl(s) {
  try {
    const u = new URL(s);
    // URL 的 protocol 带冒号（"postgresql:"），所以比的是不带斜杠的部分
    return /^postgres(ql)?$/.test(u.protocol.replace(/:$/, "")) && u.hostname.length > 0;
  } catch {
    return false;
  }
}

(async () => {
  console.log("\n接上 Neon\n");

  let url = process.argv[2];
  if (!url) {
    console.log("  把你从 Neon Console 复制来的连接串贴进来（或按 Ctrl+C 退出）：");
    console.log("  形状：postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require\n");
    url = await ask("  连接串：");
  }

  if (!isValidUrl(url)) {
    bad("这不像一个连接串。应该是 postgresql:// 开头。");
    process.exit(1);
  }

  // 连接串里有密码，别打出来
  const safe = url.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@");
  console.log(`\n  连接串：${safe}\n`);

  // 1. 测连通
  console.log("  测连通性…");
  const sql = neon(url);
  let now;
  try {
    const rows = await sql`select now() as now, current_user as usr, current_database() as db`;
    now = rows[0]?.now;
    ok(`连上了 —— 服务器时间 ${now}，用户 ${rows[0]?.usr}，库 ${rows[0]?.db}`);
  } catch (e) {
    bad(`连不上：${String(e.message).slice(0, 200)}`);
    console.log("\n  常见原因：");
    console.log("    · 连接串没复制全（面板上有个复制按钮）");
    console.log("    · 少了 ?sslmode=require");
    console.log("    · 密码里含特殊字符时需要 URL 编码");
    process.exit(1);
  }

  // 2. 备份并写入 .env.local
  const backup = `${ENV_PATH}.bak-${new Date().toISOString().slice(0, 10)}`;
  fs.copyFileSync(ENV_PATH, backup);
  const raw = fs.readFileSync(ENV_PATH, "utf8");
  const next = /^DATABASE_URL=/m.test(raw)
    ? raw.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url}`)
    : `${raw.trimEnd()}\n\n# Postgres on Neon\nDATABASE_URL=${url}\n`;
  fs.writeFileSync(ENV_PATH, next, "utf8");
  ok(`已写入 .env.local（原文件备份为 ${path.basename(backup)}）`);

  // 3. 建表
  console.log("\n  建表…");
  try {
    const schema = fs.readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8");
    const statements = schema
      .replace(/--.*$/gm, "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of statements) await sql.query(s);
    ok(`${statements.length} 条语句执行完毕`);
  } catch (e) {
    bad(`建表失败：${String(e.message).slice(0, 200)}`);
    process.exit(1);
  }

  // 4. 体检
  console.log("\n  体检…\n");
  const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
  const have = new Set(tables.map((t) => t.table_name));
  const missingTables = TABLES.filter((t) => !have.has(t));
  if (missingTables.length) bad(`少了表：${missingTables.join(", ")}`);
  else ok(`${TABLES.length} 张表都在`);

  const idx = await sql`select indexname from pg_indexes where schemaname = 'public'`;
  const haveIdx = new Set(idx.map((i) => i.indexname));
  const missingIdx = INDEXES.filter((n) => !haveIdx.has(n));
  if (missingIdx.length) warn(`少了索引：${missingIdx.join(", ")}（不影响功能，只是查询慢些）`);
  else ok(`${INDEXES.length} 个同步索引都在`);

  // 写进去、读回来、删掉
  const probe = `__probe_${Date.now()}`;
  try {
    await sql.query(
      "insert into progress (user_id, id, article_id, data, deleted) values ($1,$2,$2,$3::jsonb,false)",
      [probe, probe, JSON.stringify({ pct: 0.5 })]
    );
    const back = await sql.query("select data from progress where user_id = $1 and id = $2", [probe, probe]);
    if (back.length === 1 && Number(back[0].data?.pct) === 0.5) ok("写入、读回、删除都正常");
    else bad(`写入读回不对：${JSON.stringify(back[0]?.data)}`);
    await sql.query("delete from progress where user_id = $1 and id = $2", [probe, probe]);
    const gone = await sql.query("select id from progress where user_id = $1 and id = $2", [probe, probe]);
    if (gone.length === 0) ok("测试数据已清理干净");
  } catch (e) {
    bad(`读写往返失败：${String(e.message).slice(0, 200)}`);
  }

  // 额度表的金额列
  const cols = await sql`select column_name from information_schema.columns where table_name = 'free_usage'`;
  if (cols.map((c) => c.column_name).includes("usd")) ok("free_usage 有 usd 列（按金额计费已就绪）");
  else warn("free_usage 缺 usd 列");

  // 现在有多少数据
  for (const t of ["articles", "highlights", "glosses", "progress", "agent_tokens"]) {
    const rows = await sql.query(`select count(*)::int as n from ${t}`);
    if (rows[0]?.n) console.log(`\n     ${t}: ${rows[0].n} 行`);
  }

  console.log("\n  接下来：重启 dev server（Ctrl+C 然后 npm run dev），然后登录看看同步。");
  console.log("  想再确认一次：npm run db:check\n");
})().catch((e) => {
  console.error("FAIL:", String(e.message).slice(0, 300));
  process.exit(1);
});
