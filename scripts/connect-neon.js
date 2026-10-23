/**
 * 接上 Neon —— 一步到位。
 *
 * 用法：node scripts/connect-neon.js
 *
 * 它会问你要连接串（也可以直接传：node scripts/connect-neon.js "postgresql://..."），
 * 然后自动做完剩下的事：
 *   1. 备份 .env.local
 *   2. 写入 DATABASE_URL
 *   3. 建表（npm run db:migrate 的活）
 *   4. 体检（表齐不齐、索引齐不齐、写得进去读得出来吗）
 *   5. 报告结果
 *
 * 不想交互的话，也可以先自己把连接串填进 .env.local 的 DATABASE_URL=，
 * 然后只跑 `npm run db:check` 看结果。
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const readline = require("readline");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env.local");

const kb = (n) => (n / 1024).toFixed(1);
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => console.log(`  ❌ ${m}`);
const warn = (m) => console.log(`  ⚠️  ${m}`);

/* ---------- Neon HTTP API ---------- */

function neonQuery(url, sql, params = []) {
  const u = new URL(url);
  const body = JSON.stringify({ query: sql, params });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: u.hostname,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Neon-Connection-String": url,
          ...(u.searchParams.get("channel_binding")
            ? { "Neon-Channel-Binding": u.searchParams.get("channel_binding") }
            : {}),
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(b);
            if (j.error) reject(new Error(j.error.message || JSON.stringify(j.error)));
            else resolve(j.result?.rows ?? j.rows ?? []);
          } catch {
            reject(new Error(`响应不对：${b.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/* ---------- 读 schema 并执行 ---------- */

const TABLES = ["articles", "highlights", "glosses", "briefs", "progress", "free_usage", "covers", "agent_tokens"];
const INDEXES = [
  "articles_user_updated",
  "highlights_user_updated",
  "glosses_user_updated",
  "briefs_user_updated",
  "progress_user_updated",
  "agent_tokens_user",
];

async function migrate(url) {
  const schema = fs.readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8");
  const statements = schema
    .replace(/--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of statements) await neonQuery(url, s);
  return statements.length;
}

async function check(url) {
  const report = {};

  const tables = await neonQuery(
    url,
    "select table_name from information_schema.tables where table_schema = 'public' order by 1"
  );
  const have = new Set(tables.map((t) => t.table_name));
  report.missingTables = TABLES.filter((t) => !have.has(t));

  const idx = await neonQuery(url, "select indexname from pg_indexes where schemaname = 'public'");
  const haveIdx = new Set(idx.map((i) => i.indexname));
  report.missingIndexes = INDEXES.filter((n) => !haveIdx.has(n));

  // 写进去、读回来、删掉
  const probe = `__probe_${Date.now()}`;
  await neonQuery(
    url,
    "insert into progress (user_id, id, article_id, data, deleted) values ($1,$2,$2,$3::jsonb,false)",
    [probe, probe, JSON.stringify({ pct: 0.5 })]
  );
  const back = await neonQuery(url, "select data from progress where user_id = $1 and id = $2", [probe, probe]);
  report.writeRead = back.length === 1 && Number(back[0].data?.pct) === 0.5;
  await neonQuery(url, "delete from progress where user_id = $1 and id = $2", [probe, probe]);
  const gone = await neonQuery(url, "select id from progress where user_id = $1 and id = $2", [probe, probe]);
  report.cleanedUp = gone.length === 0;

  // 额度表的金额列
  const cols = await neonQuery(
    url,
    "select column_name from information_schema.columns where table_name = 'free_usage'"
  );
  report.hasUsd = cols.map((c) => c.column_name).includes("usd");

  // 现在有多少数据
  for (const t of ["articles", "highlights", "glosses", "progress", "agent_tokens"]) {
    try {
      const rows = await neonQuery(url, `select count(*)::int as n from ${t}`);
      if (rows[0]?.n) report[t] = rows[0].n;
    } catch {
      /* 概况可有可无 */
    }
  }

  return report;
}

/* ---------- 交互 ---------- */

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
    console.log("  形状：postgresql://user:pass@ep-xxx.xxx.aws.neon.tech/neondb?sslmode=require\n");
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
  let now;
  try {
    const rows = await neonQuery(url, "select now() as now, current_user as usr");
    now = rows[0]?.now;
    ok(`连上了 —— 服务器时间 ${now}，用户 ${rows[0]?.usr}`);
  } catch (e) {
    bad(`连不上：${e.message}`);
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
    const n = await migrate(url);
    ok(`${n} 条语句执行完毕`);
  } catch (e) {
    bad(`建表失败：${e.message}`);
    process.exit(1);
  }

  // 4. 体检
  console.log("\n  体检…\n");
  const r = await check(url);
  if (r.missingTables.length) bad(`少了表：${r.missingTables.join(", ")}`);
  else ok(`${TABLES.length} 张表都在`);
  if (r.missingIndexes.length) warn(`少了索引：${r.missingIndexes.join(", ")}（不影响功能，只是查询慢些）`);
  else ok(`${INDEXES.length} 个同步索引都在`);
  if (r.writeRead) ok("写入、读回、删除都正常");
  else bad("写入读回不对");
  if (r.cleanedUp) ok("测试数据已清理干净");
  if (r.hasUsd) ok("free_usage 有 usd 列（按金额计费已就绪）");
  else warn("free_usage 缺 usd 列");

  const counts = Object.entries(r).filter(
    ([k]) => ["articles", "highlights", "glosses", "progress", "agent_tokens"].includes(k)
  );
  if (counts.length) {
    console.log("\n  现在的数据：");
    for (const [k, v] of counts) console.log(`    ${k}: ${v} 行`);
  }

  console.log("\n  接下来：重启 dev server（Ctrl+C 然后 npm run dev），然后登录看看同步。");
  console.log("  想再确认一次：npm run db:check\n");
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
