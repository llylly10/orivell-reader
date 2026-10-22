/**
 * 算一算 Neon 免费版能撑多久。
 *
 * 用真实的数据结构造数据，量出每篇文章（正文 + 书架条目 + 高亮 + 批注）占多少字节，
 * 再按 1 GB 的免费额度算能放多少。计算题，实测出来的数才算数。
 *
 * 跑法：node scripts/measure-storage.mjs
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const db = await PGlite.create();
for (const s of schema.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean)) await db.exec(s);

const user = "u1";

// 一篇真实规模的文章：约 6000 字正文 + 书架条目
const WORDS = 6000;
const blocks = [];
let remaining = WORDS;
while (remaining > 0) {
  const n = Math.min(remaining, 120);
  blocks.push({ type: "p", text: Array.from({ length: n }, () => "字").join("") });
  remaining -= n;
}
const doc = {
  id: "a1",
  title: "一篇有六千字的文章",
  author: "某人",
  published: "2026-10-22",
  dek: "摘要摘要摘要",
  source: "example.com",
  sourceUrl: "https://example.com/article",
  blocks,
  origin: "url",
  addedAt: 1760000000000,
};
const shelfEntry = {
  id: "a1",
  title: doc.title,
  author: doc.author,
  published: doc.published,
  dek: doc.dek,
  source: doc.source,
  sourceUrl: doc.sourceUrl,
  words: WORDS,
  origin: "url",
  addedAt: doc.addedAt,
};

// 高亮：每篇 5 条
const highlights = Array.from({ length: 5 }, (_, i) => ({
  id: `h${i}`,
  article_id: "a1",
  data: { quote: "被划出来的一段话，几十个字", colour: "vermilion", createdAt: 1760000000000, anchor: { start: i * 10, end: i * 10 + 20 } },
  deleted: false,
}));

// 批注：每篇 3 条，含问答
const glosses = Array.from({ length: 3 }, (_, i) => ({
  id: `g${i}`,
  article_id: "a1",
  data: {
    action: "ask",
    question: "这段在说什么？",
    turns: [{ role: "assistant", content: "一段回答，大概几百个字。".repeat(30), streaming: false }],
    createdAt: 1760000000000,
  },
  deleted: false,
}));

const before = await db.query("select pg_database_size('articles') as s");
await db.query(
  `insert into articles (user_id, id, article_id, data, doc, deleted) values ($1,$2,$2,$3::jsonb,$4::jsonb,false)`,
  [user, "a1", JSON.stringify(shelfEntry), JSON.stringify(doc)]
);
await db.query(
  `insert into highlights (user_id, id, article_id, data, deleted)
   select $1, r.id, r.article_id, r.data, r.deleted from jsonb_to_recordset($2::jsonb)
   as r(id text, article_id text, data jsonb, deleted boolean)`,
  [user, JSON.stringify(highlights)]
);
await db.query(
  `insert into glosses (user_id, id, article_id, data, deleted)
   select $1, r.id, r.article_id, r.data, r.deleted from jsonb_to_recordset($2::jsonb)
   as r(id text, article_id text, data jsonb, deleted boolean)`,
  [user, JSON.stringify(glosses)]
);

const after = await db.query("select pg_database_size('articles') as s");
const used = Number(after.rows[0].s) - Number(before.rows[0].s);

const kb = (n) => (n / 1024).toFixed(1);
console.log("\n实测：一篇文章在数据库里占多少\n");
console.log(`  正文 ${WORDS} 字 + 书架条目 + 5 条高亮 + 3 条批注`);
console.log(`  占用：${kb(used)} KB\n`);

// 换算
const GB = 1024 ** 3;
const free = GB; // 1 GB
const perArticle = used;
const capacity = Math.floor(free / perArticle);

console.log("Neon 免费版 1 GB 存储能放：\n");
console.log(`  约 ${capacity.toLocaleString()} 篇文章（按每篇 ${kb(perArticle)} KB 算）\n`);

// 加上索引与元数据的余量（实测 pg_database_size 已含索引）
console.log("  （上面这个数已经含索引与行开销，是实测值不是估算）\n");

// 算存储能撑多久：每天读 3 篇、每篇存 1 份
console.log("换算成时间：\n");
for (const perDay of [1, 3, 10]) {
  const days = Math.floor(capacity / (perDay * 365 / 365));
  const years = (capacity / perDay / 365).toFixed(1);
  console.log(`  每天存 ${String(perDay).padStart(2)} 篇 → 够放 ${years} 年`);
}
console.log("\n  实际用不到：1 GB 满了之前，Clerk 免费版（50,000 月活）大概先用完。");
