/**
 * 复现「账户里的东西被同步删了」的那个场景，并确认防护挡住了它。
 *
 * 机制（三步凑齐才会出事）：
 *   1. 浏览器 pull 过这些文章 → 同步基线（gloss:sync:*）记下了它们的 id
 *   2. 本地书架（gloss:v1）没了 —— 写不进 localStorage（配额满）、
 *      或者被清掉，但基线还在
 *   3. 下次 pull 因为 since 已经比这些行新，拉不到它们
 *      → 本地仍然是空的 → 同步以为「本地删了」→ 推墓碑 → 账户里的全没了
 *
 * 这里把三步都做出来：有防护时不该推墓碑。
 *
 * 跑法：node scripts/verify-overflow-guard.js
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const https = require("https");
const path = require("path");

const CHROME =
  process.env.CHROME_PATH ||
  "C://Users//Administrator//AppData//Local//ms-playwright//chromium-1243//chrome-win64//chrome.exe";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const FAPI = "https://dashing-prawn-4703.clerk.accounts.dev";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ENV = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const SECRET = ENV.split("\n").find((l) => l.startsWith("CLERK_SECRET_KEY=")).split("=")[1].trim();
const DBURL = (ENV.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim() || "";

function bapi(method, p, body) {
  return new Promise((resolve, reject) => {
    const d = body ? JSON.stringify(body) : null;
    const r = https.request(
      { host: "api.clerk.com", path: p, method, headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", ...(d ? { "Content-Length": Buffer.byteLength(d) } : {}) } },
      (x) => { let b = ""; x.on("data", (c) => (b += c)); x.on("end", () => { try { resolve(JSON.parse(b)); } catch { resolve({ raw: b.slice(0, 200) }); } }); }
    );
    r.on("error", reject);
    if (d) r.write(d);
    r.end();
  });
}

const ID = "guard-test-1";

(async () => {
  const u = await bapi("POST", "/v1/users", {
    email_address: [`gloss+clerk_test_${Date.now()}@example.com`],
    password: "GlossTest123456!",
    skip_password_checks: true,
    skip_optional_checks: true,
  });
  const sit = await bapi("POST", "/v1/sign_in_tokens", { user_id: u.id, expires_in_seconds: 300 });
  const tt = await bapi("POST", "/v1/testing_tokens", { user_id: "" });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--no-proxy-server"] });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // The quota has to survive a reload. A patch installed with page.evaluate
  // dies with the document it was installed in, so the "shelf does not fit"
  // state would quietly disappear exactly when the test reloads — and the
  // test would pass for the wrong reason (or fail for the wrong one).
  // This runs before every document, and reads a flag that does survive.
  await page.evaluateOnNewDocument(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, v) {
      if (key === "gloss:v1" && sessionStorage.getItem("gloss:test:quota-full") === "1") {
        const e = new Error("QuotaExceededError");
        e.name = "QuotaExceededError";
        throw e;
      }
      return real.call(this, key, v);
    };
  });

  const posts = [];
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/sync") && req.method() === "POST") posts.push(req.postData() || "");
    if (!url.startsWith(FAPI) || !tt.token) return req.continue();
    try { const x = new URL(url); x.searchParams.set("__clerk_testing_token", tt.token); req.continue({ url: x.toString() }); } catch { req.continue(); }
  });

  // 登录
  await page.goto(BASE + "/library", { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(() => window.Clerk && window.Clerk.loaded, { timeout: 30000 }).catch(() => {});
  await wait(1500);
  await page.evaluate(async (tk) => {
    const r = await window.Clerk.client.signIn.create({ strategy: "ticket", ticket: tk });
    if (r.status === "complete") await window.Clerk.setActive({ session: r.createdSessionId });
  }, sit.token);
  await wait(2000);

  // 往库里塞一篇
  await page.evaluate(async (id) => {
    await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: { articles: [{ id, articleId: id, data: { id, title: "防护测试", words: 10, origin: "url" } }] } }),
    });
  }, ID);
  await wait(2000);

  // 正常同步一轮：基线记下它，本地也有它
  await page.goto(BASE + "/library", { waitUntil: "networkidle2", timeout: 60000 });
  await wait(6000);
  const base = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("gloss:sync:"));
    const p = k ? JSON.parse(localStorage.getItem(k)) : null;
    return { key: k, since: p?.since, ids: Object.keys(p?.seen?.articles ?? {}).length };
  });
  console.log("\n基线状态:", JSON.stringify(base));

  // 三步凑齐：
  //  1) 基线已有 id（上面）
  //  2) 书架本体写不进 localStorage（配额满）—— 基线小，写得进去
  //  3) since 调成未来 → 下次 pull 拉不到它
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("gloss:sync:"));
    const p = JSON.parse(localStorage.getItem(k));
    p.since = new Date(Date.now() + 3600_000).toISOString(); // 一小时后
    localStorage.setItem(k, JSON.stringify(p));
    // 从现在起，书架本体写不进去（配额满），但基线写得进去。
    // 标志位放在 sessionStorage 里：它跨 reload 存活，而补丁是每个新文档
    // 都重新注入的，两边一配合，reload 之后配额依然是满的。
    sessionStorage.setItem("gloss:test:quota-full", "1");
    localStorage.removeItem("gloss:v1");
  });
  posts.length = 0;

  // 重新加载：pull 拉不到（since 在未来），本地书架写不进去，基线还在
  await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
  await wait(9000);

  // 前提确认：现在书架真的写不进去了
  const quotaHeld = await page.evaluate(() => {
    try {
      localStorage.setItem("gloss:v1", "{}");
      return false;
    } catch {
      return true;
    }
  });
  console.log(`\n前提：书架写不进 localStorage = ${quotaHeld}`);

  const tombstones = posts
    .map((x) => { try { return JSON.parse(x); } catch { return null; } })
    .filter(Boolean)
    .flatMap((c) => Object.values(c.changes ?? {}))
    .flat()
    .filter((r) => r && r.deleted);

  // 库里的那篇还在吗
  const still = await page.evaluate(async () => {
    const r = await fetch("/api/sync?since=1970-01-01T00:00:00Z");
    const j = await r.json();
    return (j.changes?.articles ?? []).filter((a) => a.id === "guard-test-1").map((a) => ({ deleted: a.deleted, title: a.data?.title }));
  });

  console.log("\n三步凑齐后的同步行为\n");
  console.log(`  POST /api/sync 次数：${posts.length}`);
  console.log(`  推的墓碑数：${tombstones.length}`);
  console.log(`  库里那篇的状态：${JSON.stringify(still)}`);

  await browser.close();
  await bapi("DELETE", `/v1/users/${u.id}`);

  // 测试用户库里的行一并删掉，不给数据库留残留
  if (DBURL) {
    try {
      const { neon } = require("@neondatabase/serverless");
      const sql = neon(DBURL);
      for (const t of ["articles", "highlights", "glosses", "briefs", "progress"]) {
        await sql.query(`delete from ${t} where user_id = $1`, [u.id]);
      }
      console.log("  测试行已清理");
    } catch (e) {
      console.log(`  测试行没清成：${e.message}`);
    }
  }

  const ok = quotaHeld && tombstones.length === 0 && still.length === 1 && still[0].deleted === false;
  console.log(`\n  ${ok ? "✅ 没有推删除，账户里的东西保住了" : "❌ 推了删除，账户里的东西没了"}`);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
