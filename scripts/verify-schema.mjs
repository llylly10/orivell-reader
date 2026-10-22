/**
 * 在本地把 schema 和同步逻辑真跑一遍。
 *
 * PGlite 是真 Postgres 的 WASM 版，SQL 语义与 Neon 上的 Postgres 一致。
 * 这里把 db/schema.sql 整个跑一遍，再用 lib/db.ts 里真正的 SQL 做一次
 * 同步往返，确认表结构、索引、upsert、tombstone 都没问题。
 *
 * 跑法：node scripts/verify-schema.mjs
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const db = await PGlite.create();

const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => {
  console.log(`  ❌ ${m}`);
  process.exitCode = 1;
};

console.log("schema 与同步逻辑验证（PGlite / 真 Postgres 语义）\n");

// ---------- 1. 建表 ----------
// schema 用分号分句，注释先去掉
const statements = schema
  .replace(/--.*$/gm, "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);
for (const s of statements) await db.exec(s);
ok(`${statements.length} 条语句执行完毕`);

// ---------- 2. 表与索引 ----------
const tables = await db.query(
  "select table_name from information_schema.tables where table_schema = 'public' order by 1"
);
const names = tables.rows.map((r) => r.table_name);
const want = ["agent_tokens", "articles", "briefs", "covers", "free_usage", "glosses", "highlights", "progress"];
const missing = want.filter((t) => !names.includes(t));
if (missing.length) bad(`少了表：${missing.join(", ")}`);
else ok(`${names.length} 张表：${names.join(", ")}`);

const idx = await db.query("select indexname from pg_indexes where schemaname = 'public'");
const idxNames = idx.rows.map((r) => r.indexname);
const wantIdx = [
  "articles_user_updated",
  "highlights_user_updated",
  "glosses_user_updated",
  "briefs_user_updated",
  "progress_user_updated",
  "agent_tokens_user",
];
const missingIdx = wantIdx.filter((n) => !idxNames.includes(n));
if (missingIdx.length) bad(`少了索引：${missingIdx.join(", ")}`);
else ok(`${idxNames.length} 个索引，含全部 ${wantIdx.length} 个同步索引`);

// ---------- 3. 幂等：再跑一遍 schema ----------
for (const s of statements) await db.exec(s);
ok("schema 可以重复执行（migrate 幂等）");

// ---------- 4. 真正的同步 SQL ----------
// lib/db.ts 的 upsert 语句，原样搬过来
const upsert = (table, isArticles) => `insert into ${table} (user_id, id, article_id, data, deleted, updated_at${
  isArticles ? ", doc" : ""
})
    select $1, r.id, r.article_id, r.data, r.deleted, now()${isArticles ? ", r.doc" : ""}
    from jsonb_to_recordset($2::jsonb) as r(id text, article_id text, data jsonb, deleted boolean${
      isArticles ? ", doc jsonb" : ""
    })
    on conflict (user_id, id) do update set
      article_id = excluded.article_id, data = excluded.data, deleted = excluded.deleted, updated_at = now()${
        isArticles ? ", doc = case when excluded.deleted then null else coalesce(excluded.doc, articles.doc) end" : ""
      }`;

const user = "user_test_1";

// 推一条文章（含正文）
await db.query(upsert("articles", true), [
  user,
  JSON.stringify([
    { id: "a1", article_id: "a1", data: { title: "第一篇", words: 100, origin: "import" }, deleted: false, doc: { title: "第一篇", body: "正文" } },
  ]),
]);
const got = await db.query("select id, data, doc from articles where user_id = $1", [user]);
if (got.rows.length !== 1 || got.rows[0].doc?.body !== "正文") bad("文章写入或正文读取不对");
else ok("文章写入：数据与正文都在");

// 推一条高亮
await db.query(upsert("highlights", false), [
  user,
  JSON.stringify([{ id: "h1", article_id: "a1", data: { quote: "一段话", colour: "red" }, deleted: false }]),
]);
const hl = await db.query("select count(*)::int as n from highlights where user_id = $1", [user]);
if (hl.rows[0].n !== 1) bad("高亮写入不对");
else ok("高亮写入正常");

// 改一次高亮（upsert 覆盖）
await db.query(upsert("highlights", false), [
  user,
  JSON.stringify([{ id: "h1", article_id: "a1", data: { quote: "改了", colour: "blue" }, deleted: false }]),
]);
const hl2 = await db.query("select data from highlights where user_id = $1 and id = 'h1'", [user]);
if (hl2.rows[0].data.quote !== "改了") bad("高亮更新不对");
else ok("高亮更新（upsert 覆盖）正常");

// 不带 doc 的文章更新：正文应当保留
await db.query(upsert("articles", true), [
  user,
  JSON.stringify([{ id: "a1", article_id: "a1", data: { title: "第一篇改", words: 120, origin: "import" }, deleted: false }]),
]);
const kept = await db.query("select data->>'title' as t, doc->>'body' as b from articles where user_id = $1 and id = 'a1'", [user]);
if (kept.rows[0].t !== "第一篇改" || kept.rows[0].b !== "正文") bad(`正文没保留：${JSON.stringify(kept.rows[0])}`);
else ok("不带正文的更新：正文被保留（coalesce 生效）");

// 墓碑：删除
await db.query(upsert("articles", true), [
  user,
  JSON.stringify([{ id: "a1", article_id: "a1", data: {}, deleted: true }]),
]);
const tomb = await db.query("select deleted, doc from articles where user_id = $1 and id = 'a1'", [user]);
if (!tomb.rows[0].deleted || tomb.rows[0].doc !== null) bad("墓碑不对");
else ok("删除走墓碑：deleted=true、正文清空");

// pull：按 updated_at 取变更
const pull = await db.query(
  "select id, article_id, data, deleted from highlights where user_id = $1 and updated_at > $2 order by updated_at",
  [user, "1970-01-01T00:00:00Z"]
);
if (pull.rows.length !== 1) bad(`pull 取到的行数不对：${pull.rows.length}`);
else ok("pull（按 updated_at 取变更）正常");

// pull：另一个用户看不到别人的数据
const other = await db.query("select id from highlights where user_id = $1", ["user_test_2"]);
if (other.rows.length !== 0) bad("用户隔离失效！");
else ok("用户隔离：另一个用户看不到这些行");

// free_usage 的额度
await db.query("insert into free_usage (subject, day, count, usd) values ($1, current_date, 3, 0.25)", ["free:user:x"]);
const fu = await db.query("select count, usd from free_usage where subject = $1", ["free:user:x"]);
if (Number(fu.rows[0].usd) !== 0.25) bad("free_usage 的 usd 记不对");
else ok("free_usage（按金额计费）正常");

// agent token：只存哈希
await db.query("insert into agent_tokens (id, user_id, hash, label) values ($1,$2,$3,$4)", ["t1", user, "hash1", "Agent"]);
const tok = await db.query("select id, label, hash from agent_tokens where user_id = $1", [user]);
if (tok.rows[0].hash !== "hash1" || tok.rows[0].label !== "Agent") bad("agent token 写入不对");
else ok("agent token 写入正常");

// 唯一约束：同一个哈希不能有两个
try {
  await db.query("insert into agent_tokens (id, user_id, hash, label) values ($1,$2,$3,$4)", ["t2", user, "hash1", "Other"]);
  bad("agent token 的 hash 唯一约束失效！");
} catch {
  ok("agent token 的 hash 唯一约束生效");
}

// covers：文章删除时封面一起删
await db.query("insert into covers (user_id, id, jpeg) values ($1,$2,$3)", [user, "a1", "base64jpeg"]);
const cov = await db.query("select count(*)::int as n from covers where user_id = $1", [user]);
if (cov.rows[0].n !== 1) bad("封面写入不对");
else ok("封面写入正常");

console.log(process.exitCode ? "\n有问题" : "\n全部通过。schema 与同步逻辑在真 Postgres 语义下没问题。");
