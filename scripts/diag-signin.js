/**
 * 只读：登录页为什么空白。等更久、看清Clerk 请求成败、不改任何代码。
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe";
const BASE = "http://127.0.0.1:3100";
const OUT = path.join(__dirname, "..", "verify-shots");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const clerkReqs = [];
  page.on("response", (r) => {
    const u = r.url();
    if (/clerk/i.test(u)) clerkReqs.push({ status: r.status(), url: u.slice(0, 110) });
  });
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (/clerk/i.test(u)) clerkReqs.push({ failed: r.failure()?.errorText, url: u.slice(0, 110) });
  });

  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errs.push("PAGEERROR: " + String(e).slice(0, 200)));

  await page.goto(BASE + "/sign-in", { waitUntil: "domcontentloaded", timeout: 45000 });

  // 等足 20 秒，看是慢还是彻底不出
  await wait(20000);

  const dom = await page.evaluate(() => {
    const root = document.body;
    const iframes = [...document.querySelectorAll("iframe")].map((f) => (f.src || "(no src)").slice(0, 80));
    return {
      bodyText: (root.innerText || "").trim().slice(0, 200),
      hasPasswordInput: !!document.querySelector("input[type=password]"),
      hasAnyInput: !!document.querySelector("input"),
      iframes,
      htmlLength: root.innerHTML.length,
    };
  });

  console.log(JSON.stringify({
    dom,
    clerkRequests: clerkReqs,
    consoleErrors: [...new Set(errs)].slice(0, 6),
  }, null, 2));

  await page.screenshot({ path: path.join(OUT, "signin-after-wait.png") });
  await browser.close();
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });