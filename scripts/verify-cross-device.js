/**
 * 端到端：跨设备同步真的通了吗？
 *
 * 开两个互相隔离的浏览器上下文（各自的 cookie 与 localStorage），
 * 同一个账号：
 *   1. 设备 A 登录，在书架上放一篇文章
 *   2. 设备 B 登录，等它同步
 *   3. 设备 B 的书架上应该出现那篇文章
 *   4. 设备 B 加一条高亮，设备 A 应该收到
 *
 * 跑法：node scripts/verify-cross-device.js
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const https = require("https");

const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const FAPI = "https://dashing-prawn-4703.clerk.accounts.dev";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ENV = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const SECRET = ENV.split("\n").find((l) => l.startsWith("CLERK_SECRET_KEY=")).split("=")[1].trim();
const DBURL = (ENV.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim() || "";

function bapi(method, p, body) {
  return new Promise((res, rej) => {
    const d = body ? JSON.stringify(body) : null;
    const r = https.request(
      {
        host: "api.clerk.com",
        path: p,
        method,
        headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", ...(d ? { "Content-Length": Buffer.byteLength(d) } : {}) },
      },
      (x) => {
        let b = "";
        x.on("data", (c) => (b += c));
        x.on("end", () => {
          try {
            res(JSON.parse(b));
          } catch {
            res({ raw: b.slice(0, 200) });
          }
        });
      }
    );
    r.on("error", rej);
    if (d) r.write(d);
    r.end();
  });
}

/** 起一个隔离的浏览器上下文（独立 cookie 与 localStorage），并完成登录。 */
async function makeDevice(browser, user, ticket, testingToken) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith(FAPI) || !testingToken) return req.continue();
    try {
      const u = new URL(url);
      u.searchParams.set("__clerk_testing_token", testingToken);
      req.continue({ url: u.toString() });
    } catch {
      req.continue();
    }
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(() => window.Clerk && window.Clerk.loaded, { timeout: 30000 }).catch(() => {});
  await wait(1500);
  const r = await page.evaluate(async (tk) => {
    const res = await window.Clerk.client.signIn.create({ strategy: "ticket", ticket: tk });
    if (res.status === "complete") {
      await window.Clerk.setActive({ session: res.createdSessionId });
      return { ok: true };
    }
    return { ok: false, status: res.status };
  }, ticket);
  if (!r.ok) throw new Error("登录失败：" + JSON.stringify(r));
  await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
  await wait(3000);
  return { ctx, page };
}

(async () => {
  // 1. 建一个测试用户
  const u = await bapi("POST", "/v1/users", {
    email_address: [`gloss+clerk_test_${Date.now()}@example.com`],
    password: "GlossTest123456!",
    first_name: "G",
    last_name: "T",
    skip_password_checks: true,
    skip_optional_checks: true,
  });
  const sit = await bapi("POST", "/v1/sign_in_tokens", { user_id: u.id, expires_in_seconds: 300 });
  const tt = await bapi("POST", "/v1/testing_tokens", { user_id: "" });
  console.log(`\n跨设备同步验证\n  测试用户 ${u.id}\n`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });

  const report = {};
  try {
    // 2. 设备 A
    const A = await makeDevice(browser, u, sit.token, tt.token);
    report.deviceA = { loggedIn: await A.page.evaluate(() => !!window.Clerk?.user) };

    // 3. 设备 A 放一篇文章
    const put = await A.page.evaluate(async () => {
      const { useStore } = window.__glossStore || {};
      // 应用把 store 挂在 window 上不一定，直接用 API 写也验证了服务端；
      // 但我们要验证的是「设备 B 能收到」，所以走真实的同步通道。
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changes: {
            articles: [
              {
                id: "cross-device-test-1",
                articleId: "cross-device-test-1",
                data: { id: "cross-device-test-1", title: "跨设备同步测试文章", words: 100, origin: "url", addedAt: Date.now() },
              },
            ],
          },
        }),
      });
      return { status: res.status };
    });
    report.deviceA.push = put;
    await wait(2000);

    // 4. 设备 B 登录并等它同步
    // sign-in token 只能用一次，设备 B 要自己那个
    const sitB = await bapi("POST", "/v1/sign_in_tokens", { user_id: u.id, expires_in_seconds: 300 });
    const B = await makeDevice(browser, u, sitB.token, tt.token);
    report.deviceB = { loggedIn: await B.page.evaluate(() => !!window.Clerk?.user) };

    // 5. 设备 B 拉一次同步，看能不能收到
    const got = await B.page.evaluate(async () => {
      const res = await fetch("/api/sync?since=1970-01-01T00:00:00Z");
      const j = await res.json();
      const arts = j.changes?.articles ?? [];
      return {
        status: res.status,
        count: arts.length,
        titles: arts.map((a) => a.data?.title).filter(Boolean).slice(0, 5),
        hasTest: arts.some((a) => a.id === "cross-device-test-1"),
      };
    });
    report.deviceB.pulled = got;

    // 6. 设备 B 加一条高亮，设备 A 能不能收到
    await B.page.evaluate(async () => {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changes: {
            highlights: [
              {
                id: "cross-device-hl-1",
                articleId: "cross-device-test-1",
                data: { quote: "这是设备 B 加的高亮", colour: "vermilion", createdAt: Date.now(), anchor: { start: 0, end: 10 } },
              },
            ],
          },
        }),
      });
    });
    await wait(1500);
    const gotHl = await A.page.evaluate(async () => {
      const res = await fetch("/api/sync?since=1970-01-01T00:00:00Z");
      const j = await res.json();
      const hls = j.changes?.highlights ?? [];
      return { count: hls.length, hasTest: hls.some((h) => h.id === "cross-device-hl-1") };
    });
    report.deviceA.receivedHighlight = gotHl;

    await A.page.screenshot({ path: path.join(__dirname, "..", "verify-shots", "cross-device-A.png") });
    await B.page.screenshot({ path: path.join(__dirname, "..", "verify-shots", "cross-device-B.png") });
  } finally {
    await bapi("DELETE", `/v1/users/${u.id}`);
    await browser.close();
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
  }

  console.log(JSON.stringify(report, null, 2));

  const ok = report.deviceB?.pulled?.hasTest && report.deviceA?.receivedHighlight?.hasTest;
  console.log(`\n  ${ok ? "✅ 跨设备同步通了" : "❌ 跨设备同步没通"}`);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
