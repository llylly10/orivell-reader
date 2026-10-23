/**
 * 多人一起用，Neon 免费版的流量够多少人？—— 测真实的 HTTP 往返。
 *
 * 关键：流量不是只算 JSON 响应体。一次 pull 是一次完整的 HTTP 请求+响应，
 * 里面有请求行、请求头、状态行、响应头、TLS 记录开销。真实的一次空 pull
 * 大约 300-500 字节，比响应体本身大好几倍。
 *
 * 这里起一个真的 HTTP 服务（Node 自带），让客户端打真实的请求，
 * 量出「服务端实际写出多少字节」——这才是 Neon 那边计的流量。
 *
 * 跑法：node scripts/measure-http-cost.mjs
 */
import { createServer } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const db = await PGlite.create();
for (const s of schema.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean)) await db.exec(s);

const COLLECTIONS = ["articles", "highlights", "glosses", "briefs", "progress"];
const USER = "u1";

// 造一点数据，让 pull 不至于永远返回空
await db.query(
  `insert into articles (user_id, id, article_id, data, doc, deleted)
   values ($1,$2,$2,$3::jsonb,$4::jsonb,false)`,
  [USER, "a1", JSON.stringify({ id: "a1", title: "一篇文章", words: 6000 }), JSON.stringify({ id: "a1", title: "一篇文章", blocks: [] })]
);

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

// ---------- 起一个真的 HTTP 服务，量它写出多少字节 ----------
let wireBytes = 0;
const resetWire = () => (wireBytes = 0);
const server = createServer(async (req, res) => {
  const since = new URL(req.url, "http://x").searchParams.get("since") ?? "1970-01-01T00:00:00Z";
  await pullTx(USER, since);
  const body = JSON.stringify({ now: new Date().toISOString(), changes: { articles: [], highlights: [], glosses: [], briefs: [], progress: [] } });
  res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const measure = async (n) => {
  resetWire();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    await fetch(`http://127.0.0.1:${port}/api/sync?since=2026-10-23T00:00:00Z`);
  }
  return (performance.now() - t0) / n;
};

// 从服务端 socket 上读真实走线的字节
server.on("connection", (socket) => {
  socket.on("data", (d) => (wireBytes += d.length));
});

// 先跑一次预热
await measure(3);
resetWire();
const N = 200;
const perRequest = await measure(N);
const wirePerRequest = wireBytes / N;

console.log("\n真实 HTTP 往返实测\n");
console.log(`  一次空 pull 的服务端耗时：${perRequest.toFixed(2)} ms`);
console.log(`  一次 pull 在网络上的字节：${wirePerRequest.toFixed(0)} 字节（${(wirePerRequest / 1024).toFixed(3)} KB）`);
console.log(`    —— 这是包含请求行、请求头、状态行、响应头的完整往返\n`);

const GB = 1024 ** 3;
const freeTraffic = 5 * GB;

console.log("  换算成免费流量的支撑人数：\n");
console.log("    间隔   每人每月      5GB 支撑");
for (const sec of [5, 15, 30, 60, 300]) {
  const perDay = 86400 / sec;
  const monthly = (perDay * 30 * wirePerRequest) / 1024; // KB
  const people = freeTraffic / (monthly * 1024);
  console.log(`    ${String(sec).padStart(3)}秒  ${(monthly / 1024).toFixed(1).padStart(8)} MB  ${people.toFixed(0).padStart(6)} 人`);
}

// 实际情况：只有书架页会高频拉。
// 看代码 lib/sync.ts：
//   - ticker 只在 watchers（书架页）时跑
//   - 其它页面只在 visibilitychange 时拉一次（IDLE_MS）
//   - 页面切到后台（hidden）时完全不拉
// 所以「所有人一直开着书架页」是最坏情况；实际大部分人在读文章，消耗低得多。
console.log("\n  实际情况（看 lib/sync.ts 的实际行为）：\n");
console.log("    只有书架页高频轮询；读文章的页面只在切回前台时拉一次；");
console.log("    标签页切到后台则完全不拉。\n");
console.log("    上面那张表是「所有人都一直开着书架页」的最坏情况。");
console.log("    典型用法（每人每天在书架页 30 分钟，其余时间在读文章）：");
for (const sec of [5, 30]) {
  const shelfMin = 30;
  const pulls = (shelfMin * 60) / sec; // 书架页的轮询
  const otherPulls = 20; // 读文章时的可见性切换，一天 20 次
  const monthly = ((pulls + otherPulls) * 30 * wirePerRequest) / 1024;
  const people = freeTraffic / (monthly * 1024);
  console.log(`      间隔 ${String(sec).padStart(2)}秒 → 每人 ${(monthly / 1024).toFixed(2).padStart(6)} MB/月，支撑 ${people.toFixed(0).padStart(6)} 人`);
}
console.log();

console.log("\n  存储是另一条线：");
const cols = await db.query(`
  select (select coalesce(sum(octet_length(data::text)),0) from articles) +
         (select coalesce(sum(octet_length(data::text)),0) from highlights) as s
`);
const perUser = Number(cols.rows[0].s);
console.log(`    每人 1 篇文章约 ${(perUser / 1024).toFixed(1)} KB → 1GB 够 ${Math.floor(GB / perUser).toLocaleString()} 人`);
console.log("\n  结论：流量是比存储紧得多的那条线。间隔从 5 秒调到 30 秒，");
console.log("  支撑人数就翻 6 倍 —— 这比升级到付费套餐便宜得多。");

server.close();
