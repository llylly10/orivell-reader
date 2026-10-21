/**
 * 只读验证：真的登录一次，看登录后的一切是否正常。
 *
 * 机制（与 Clerk 官方 @clerk/testing 一致）：
 *  1. 用 Backend API 建一个测试用户（+clerk_test 邮箱）
 *  2. 给它签一个 sign-in token（ticket）
 *  3. 拦截所有 Clerk Frontend API 请求，附加 __clerk_testing_token，
 *     并把响应里的 captcha_bypass 置为 true，绕过 Turnstile 机器人检测
 *  4. 在页面里用 Clerk 客户端的 signIn(ticket) 建立会话
 *
 * 会在 Clerk 实例里留下一个测试用户（可随时删除）。
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");
const https = require("https");

const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const FAPI = "https://discrete-pug-2216.clerk.accounts.dev";
const OUT = path.join(__dirname, "..", "verify-shots");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SECRET = fs
  .readFileSync(path.join(__dirname, "..", ".env.local"), "utf8")
  .split("\n")
  .find((l) => l.startsWith("CLERK_SECRET_KEY="))
  .split("=")[1]
  .trim();

/** 调 Clerk Backend API。 */
function bapi(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        host: "api.clerk.com",
        path: p,
        method,
        headers: {
          Authorization: `Bearer ${SECRET}`,
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(b));
          } catch {
            resolve({ raw: b.slice(0, 300), status: res.statusCode });
          }
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = {};

  // 1. 测试用户
  const email = `gloss+clerk_test_${Date.now()}@example.com`;
  const created = await bapi("POST", "/v1/users", {
    email_address: [email],
    password: "GlossTest123456!",
    first_name: "Gloss",
    last_name: "Test",
    skip_password_checks: true,
    skip_optional_checks: true,
  });
  report.user = { email, id: created?.id, error: created?.errors?.[0]?.message };
  if (!created?.id) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  // 2. sign-in token
  const sit = await bapi("POST", "/v1/sign_in_tokens", { user_id: created.id, expires_in_seconds: 300 });
  report.signInToken = { ok: !!sit?.token, error: sit?.errors?.[0]?.message };
  if (!sit?.token) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  // 3. testing token（绕过机器人检测）
  const tt = await bapi("POST", "/v1/testing_tokens", { user_id: "" });
  const testingToken = tt?.token;

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 200)));

  // 拦截 FAPI 请求：附加 testing token。
  // 只改 URL、让浏览器自己发 —— 这样 CORS、Cookie、Origin 全部照旧，
  // 转發會讓 Clerk 以為是另一個瀏覽器。
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

  // 4. 打开首页并用 ticket 建立会话
  await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForFunction(() => window.Clerk && window.Clerk.loaded, { timeout: 30000 }).catch(() => {});
  await wait(2000);

  report.signInResult = await page.evaluate(async (ticket) => {
    try {
      const r = await window.Clerk.client.signIn.create({ strategy: "ticket", ticket });
      if (r.status === "complete") {
        await window.Clerk.setActive({ session: r.createdSessionId });
        return { status: r.status, ok: true };
      }
      return { status: r.status, ok: false };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 300) };
    }
  }, sit.token);

  await wait(3000);
  await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
  await wait(4000);

  report.home = {
    signInButtonGone: await page.evaluate(() => {
      const b = [...document.querySelectorAll("button,a")].find((e) => /^(登录|Sign in)$/i.test((e.textContent || "").trim()));
      return !b;
    }),
    avatarPresent: await page.evaluate(() => {
      const el = document.querySelector(".cl-userButton, [class*=cl-userButton], [data-testid='user-avatar']");
      return !!el;
    }),
    clerkUser: await page.evaluate(() => {
      const u = window.Clerk?.user;
      return u ? { id: u.id, email: u.primaryEmailAddress?.emailAddress } : null;
    }),
  };
  await page.screenshot({ path: path.join(OUT, "signed-in-home.png") });

  // 5. 用户菜单
  // Clerk 的 UserButton 渲染在 shadow DOM 里，页面选择器穿不透，
  // 所以直接问 Clerk 自己：这个用户有没有可用���账号页。
  report.userMenu = await page.evaluate(async () => {
    const u = window.Clerk?.user;
    if (!u) return { opened: false, why: "no clerk user" };
    const el =
      document.querySelector("button.cl-userButton, .cl-userButtonRoot, [data-testid='user-avatar']") ||
      document.querySelector("[class*='userButton']");
    if (el) el.click();
    await new Promise((r) => setTimeout(r, 2000));
    // 菜单本体在 shadow root 里，从宿主元素里翻
    const host = document.querySelector("[class*='userButtonPopover'], .cl-userButtonPopover, [data-floating-ui-portal]");
    let texts = [];
    if (host) {
      const root = host.shadowRoot || host;
      texts = [...root.querySelectorAll("button,a")].map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 12);
    }
    return {
      clicked: !!el,
      foundHost: !!host,
      user: { id: u.id, email: u.primaryEmailAddress?.emailAddress },
      profileUrl: window.Clerk.userProfileUrl?.(),
      texts,
    };
  });
  await page.screenshot({ path: path.join(OUT, "signed-in-usermenu.png") });

  // 6. 服务端认不认
  report.server = await page.evaluate(async () => {
    const r = await fetch("/api/agent-tokens");
    return { status: r.status, body: (await r.text()).slice(0, 200) };
  });

  // 7. 退出登录，回到未登录状态
  report.signOut = await page.evaluate(async () => {
    try {
      await window.Clerk.signOut();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 200) };
    }
  });
  await wait(2500);
  report.afterSignOut = {
    signInButtonBack: await page.evaluate(() => {
      const b = [...document.querySelectorAll("button,a")].find((e) => /^(登录|Sign in)$/i.test((e.textContent || "").trim()));
      return !!b;
    }),
    clerkUser: await page.evaluate(() => (window.Clerk?.user ? window.Clerk.user.id : null)),
  };
  await page.screenshot({ path: path.join(OUT, "signed-out-home.png") });

  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
