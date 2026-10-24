/**
 * 补全推文数据：bird 的导出缺两样东西，这里从公开通道补齐。
 *
 * 1. t.co 短链还原 —— t.co 是 301 跳转，手动跟一跳就拿到真网址，无需凭证。
 *    还原后正文里的链接不再绕 X 的跳转，读者也能看出链接指向哪个站。
 * 2. 引用推文的媒体与长文 —— bird 的导出里 quotedTweet 不带媒体，长文只留
 *    一条 t.co。按 fxtwitter（驱动 Discord/TG 推文嵌入的公共服务，免凭证）
 *    补齐：真媒体引用补图/视频行，长文引用补一行「📄 标题」。
 *
 * 只更新 gloss-library SQLite 里已有的行，跑完后再用 import-x-bookmarks.js
 * 推到 Neon。转换器会把引用里的媒体行变成 figure。
 *
 * 跑法：
 *   node --experimental-sqlite scripts/fill-tweet-data.mjs          # 写入
 *   node --experimental-sqlite scripts/fill-tweet-data.mjs --dry    # 只统计
 */
import { existsSync, readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry");
const LIB = "D:/shujia/gloss-library/data/library.db";
const CONCURRENCY = 5;
const TCO = /https:\/\/t\.co\/\w+/g;
const QUOTE_HEAD = /> 引用 \[@[^[\]]+\]\((https:\/\/x\.com\/i\/status\/\d+)\)/;

if (!existsSync(LIB)) {
  console.log(`\n找不到 ${LIB}`);
  process.exit(1);
}
const { DatabaseSync } = await import("node:sqlite");
const sq = new DatabaseSync(LIB);
const rows = sq.prepare("select id, content from articles").all();
console.log(`\n库内文章 ${rows.length} 篇\n`);

/* ---------- 阶段 1：t.co 还原 ---------- */
const links = new Set();
for (const r of rows) for (const m of r.content.matchAll(TCO)) links.add(m[0]);
console.log(`阶段 1：${links.size} 条唯一 t.co 短链待还原`);

const targets = new Map();
let cursor = 0;
async function resolveTco(url) {
  for (let hop = 0; hop < 2; hop++) {
    let res;
    try {
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    } catch {
      return null;
    }
    const loc = res.headers.get("location");
    if (!loc) return res.ok ? url : null;
    if (/^https:\/\/t\.co\//.test(loc)) { url = loc; continue; }
    return loc;
  }
  return null;
}
const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (cursor < links.size) {
    const url = [...links][cursor++];
    const target = await resolveTco(url);
    if (target && /^https:\/\//.test(target) && !/t\.co\//.test(target)) targets.set(url, target);
  }
});
const t0 = Date.now();
await Promise.all(workers);
console.log(`  还原成功 ${targets.size} / ${links.size}（${Math.round((Date.now() - t0) / 1000)}s）`);

/* ---------- 阶段 2：引用补全（媒体 / 长文标题） ---------- */
const quoteIds = new Map(); // qid -> 引用它的文章行
for (const r of rows) {
  const m = r.content.match(QUOTE_HEAD);
  if (m && !quoteIds.has(m[1])) quoteIds.set(m[1], r.id);
}
console.log(`阶段 2：${quoteIds.size} 条被引用推文待补全\n`);

async function fetchFx(qid) {
  const id = qid.replace(/^.*\/status\//, ""); // map 键是完整 status URL，fxtwitter 只要数字 id
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://api.fxtwitter.com/status/${id}`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) gloss-local/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429 || res.status === 403) {
        await new Promise((r) => setTimeout(r, 2000 + attempt * 4000));
        continue;
      }
      if (!res.ok) return null;
      const j = await res.json();
      return j.tweet ?? null;
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qidList = [...quoteIds.keys()];
const quoteFix = new Map(); // qid -> { media: [md行], article: title }
let qcursor = 0;
const fxWorkers = Array.from({ length: CONCURRENCY }, async () => {
  while (qcursor < qidList.length) {
    const qid = qidList[qcursor++];
    const t = await fetchFx(qid);
    await sleep(300);
    if (!t) continue;
    const media = (t.media?.all ?? [])
      .map((m) => (m.type === "photo" ? `> ![image](${m.url})` : m.type === "video" || m.type === "gif" ? `> ![video](${m.url})` : null))
      .filter(Boolean);
    const title = t.article?.title?.trim();
    if (media.length || title) quoteFix.set(qid, { media, title });
  }
});
await Promise.all(fxWorkers);
console.log(`  补到内容: ${quoteFix.size} 条（其余为普通文字引用或抓取失败）\n`);

/* ---------- 写回 ---------- */
if (DRY) {
  console.log("（--dry 模式，没写任何东西）");
  process.exit(0);
}

const update = sq.prepare("update articles set content = ? where id = ?");
let fixedLinks = 0;
let fixedQuotes = 0;
sq.exec("begin");
try {
  for (const r of rows) {
    let content = r.content.replace(TCO, (u) => targets.get(u) ?? u);
    if (content !== r.content) fixedLinks++;

    const m = content.match(QUOTE_HEAD);
    if (m) {
      const fix = quoteFix.get(m[1]);
      if (fix) {
        const lines = content.split("\n");
        const head = lines.findIndex((l) => QUOTE_HEAD.test(l));
        // 引用段 = 从引用头开始、连续的 > 行；媒体/标题插在引用段末尾
        let end = head + 1;
        while (end < lines.length && (lines[end].startsWith(">") || lines[end].trim() === "")) {
          if (lines[end].trim() === "" && !(lines[end + 1] ?? "").startsWith(">")) break;
          end++;
        }
        const insert = [];
        for (const md of fix.media) if (!content.includes(md.slice(3))) insert.push(md);
        if (fix.title) insert.push(`> **📄 ${fix.title.replace(/[>\n]/g, "").slice(0, 120)}**`);
        if (insert.length) {
          lines.splice(end, 0, ...insert);
          content = lines.join("\n");
          fixedQuotes++;
        }
      }
    }
    update.run(content, r.id);
  }
  sq.exec("commit");
} catch (e) {
  sq.exec("rollback");
  throw e;
}
console.log(`\n写回完成：${fixedLinks} 篇的短链已还原，${fixedQuotes} 篇的引用已补全`);
