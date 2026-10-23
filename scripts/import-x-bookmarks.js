/**
 * 把 gloss-library 里的 X 书签库导入 Gloss 的 Postgres。
 *
 * 源：gloss-library/data/library.db 的 articles 表（SQLite）
 * 目标：Neon 的 articles 表（Gloss 的 schema）
 *
 * 映射：
 *   SQLite 的 content（Markdown）→ Gloss 的 doc.blocks（段落数组）
 *   SQLite 的其余列            → Gloss 的 data（书架条目）
 *
 * 正文里的图片与视频变成 figure 块；作者行、时间戳这些元数据留在正文里，
 * 因为它们就是推文的一部分。
 *
 * 跑法：
 *   node scripts/import-x-bookmarks.js            # 需要 DATABASE_URL
 *   node scripts/import-x-bookmarks.js --dry      # 只看会导入什么，不写
 */
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const DRY = process.argv.includes("--dry");
const LIB = "D:/shujia/gloss-library/data/library.db";
const KEY = "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY";

/* ---------- 读 .env.local ---------- */
const envRaw = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
const env = (name) => {
  const m = envRaw.match(new RegExp(`^${name}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
};
const DATABASE_URL = env("DATABASE_URL");

/* ---------- Neon HTTP ---------- */
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
import https from "node:https";

// 转换器与检验脚本共用一份，改一处两处都跟着变。
import { toBlocks } from "./lib-import-blocks.mjs";

/* ---------- 读 SQLite ---------- */
if (!existsSync(LIB)) {
  console.log(`\n找不到 ${LIB}`);
  process.exit(1);
}
const { DatabaseSync } = await import("node:sqlite");
const sq = new DatabaseSync(LIB, { readOnly: true });
const rows = sq.prepare(
  "select id,url,title,author,site_name,excerpt,content,word_count,minutes,status,topic,tags,favicon,saved_at,read_at,progress from articles"
).all();
sq.close();

const isX = (r) => /x\.com|twitter\.com/.test(String(r.url ?? ""));

console.log(`\n准备导入：${rows.length} 篇文章（其中 X 书签 ${rows.filter(isX).length} 篇）\n`);

if (!DRY && !DATABASE_URL) {
  console.log("  没有 DATABASE_URL。接上 Neon 后再跑，或加 --dry 先看看。\n");
  process.exit(1);
}

// ---------- 造数据 ----------
const items = rows.map((r) => {
  const blocks = toBlocks(r.content);
  const data = {
    id: String(r.id),
    title: String(r.title ?? ""),
    author: String(r.author ?? ""),
    source: String(r.site_name ?? ""),
    sourceUrl: String(r.url ?? ""),
    dek: String(r.excerpt ?? "").slice(0, 300),
    words: Number(r.word_count ?? 0),
    origin: isX(r) ? "url" : "url",
    addedAt: Number(r.saved_at ?? 0) * 1000,
  };
  const doc = {
    id: String(r.id),
    title: String(r.title ?? ""),
    author: String(r.author ?? ""),
    sourceUrl: String(r.url ?? ""),
    blocks,
  };
  return { id: String(r.id), data, doc };
});

// ---------- 统计 ----------
const totalBlocks = items.reduce((n, i) => n + i.doc.blocks.length, 0);
const figures = items.reduce((n, i) => n + i.doc.blocks.filter((b) => b.type === "figure").length, 0);
const bytes = items.reduce((n, i) => n + Buffer.byteLength(JSON.stringify(i.data)) + Buffer.byteLength(JSON.stringify(i.doc)), 0);
console.log(`  转换后共 ${totalBlocks} 个段落，其中 ${figures} 个图片/视频`);
console.log(`  jsonb 体积约 ${(bytes / 1024 / 1024).toFixed(2)} MB\n`);

if (DRY) {
  console.log("  第一条的转换结果：\n");
  console.log(JSON.stringify(items[0], null, 2).split("\n").slice(0, 40).map((l) => "  " + l).join("\n"));
  console.log("\n  （--dry 模式，没写任何东西）\n");
  process.exit(0);
}

// ---------- 写入 ----------
const userId = process.env.GLOSS_USER_ID || env("CLERK_USER_ID") || "";
if (!userId) {
  console.log("  不知道写到哪个账号。设一个环境变量：");
  console.log("    GLOSS_USER_ID=user_xxx node scripts/import-x-bookmarks.js");
  console.log("  （user_xxx 从 Clerk 那边能看到）\n");
  process.exit(1);
}

console.log(`  写入账号 ${userId} …\n`);
const BATCH = 50;
let done = 0;
for (let i = 0; i < items.length; i += BATCH) {
  const slice = items.slice(i, i + BATCH);
  await neonQuery(
    DATABASE_URL,
    `insert into articles (user_id, id, article_id, data, doc, deleted, updated_at)
     select $1, r.id, r.id, r.data, r.doc, false, now()
     from jsonb_to_recordset($2::jsonb) as r(id text, data jsonb, doc jsonb)
     on conflict (user_id, id) do update set
       data = excluded.data, doc = excluded.doc, deleted = false, updated_at = now()`,
    [userId, JSON.stringify(slice)]
  );
  done += slice.length;
  process.stdout.write(`\r  ${done} / ${items.length}`);
}
console.log("\n");

// 进度也导入（读到哪儿了）
const prog = rows
  .filter((r) => Number(r.progress ?? 0) > 0)
  .map((r) => ({ id: String(r.id), data: { pct: Number(r.progress), readAt: r.read_at ? Number(r.read_at) * 1000 : null } }));
if (prog.length) {
  for (let i = 0; i < prog.length; i += BATCH) {
    const slice = prog.slice(i, i + BATCH);
    await neonQuery(
      DATABASE_URL,
      `insert into progress (user_id, id, article_id, data, deleted, updated_at)
       select $1, r.id, r.id, r.data, false, now()
       from jsonb_to_recordset($2::jsonb) as r(id text, data jsonb)
       on conflict (user_id, id) do update set data = excluded.data, updated_at = now()`,
      [userId, JSON.stringify(slice)]
    );
  }
  console.log(`  另外导入了 ${prog.length} 条阅读进度`);
}

const check = await neonQuery(DATABASE_URL, "select count(*)::int as n from articles where user_id = $1", [userId]);
console.log(`  库里现在有 ${check[0].n} 篇文章（这个账号）`);
console.log("\n  完事。打开书架应该就能看到你的 X 书签了。\n");
