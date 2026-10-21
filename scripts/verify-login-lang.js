/**
 * 只读验证：Clerk 组件的文案是否跟随应用语言切换。
 * 步骤：清 localStorage → 打开登录页（应为英文）→ 点「中文」→ 再看。
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const OUT = path.join(__dirname, "..", "verify-shots");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const HEAD = () => {
  const h = document.querySelector("h1,[class*=headerTitle],[class*=cl-headerTitle]");
  return h ? (h.textContent || "").trim() : "(no header)";
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

  const report = {};

  // 清干净，从英文开始
  await page.goto(BASE + "/sign-in", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + "/sign-in", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(3000);
  report.step1_fresh_en = {
    header: await page.evaluate(HEAD),
    storedLang: await page.evaluate(() => localStorage.getItem("gloss:lang")),
    htmlLang: await page.evaluate(() => document.documentElement.lang),
  };
  await page.screenshot({ path: path.join(OUT, "login-1-fresh-en.png") });

  // 切中文
  report.clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "中文");
    if (!b) return "no-btn";
    b.click();
    return "ok";
  });
  await wait(3000);
  report.step2_after_zh = {
    header: await page.evaluate(HEAD),
    storedLang: await page.evaluate(() => localStorage.getItem("gloss:lang")),
    htmlLang: await page.evaluate(() => document.documentElement.lang),
  };
  await page.screenshot({ path: path.join(OUT, "login-2-after-zh.png") });

  // 刷新，看语言是否记住
  await page.reload({ waitUntil: "networkidle2", timeout: 45000 });
  await wait(3000);
  report.step3_reload = {
    header: await page.evaluate(HEAD),
    storedLang: await page.evaluate(() => localStorage.getItem("gloss:lang")),
    htmlLang: await page.evaluate(() => document.documentElement.lang),
  };
  await page.screenshot({ path: path.join(OUT, "login-3-reload.png") });

  // 切回英文
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "English");
    if (b) b.click();
  });
  await wait(3000);
  report.step4_back_en = {
    header: await page.evaluate(HEAD),
    storedLang: await page.evaluate(() => localStorage.getItem("gloss:lang")),
  };
  await page.screenshot({ path: path.join(OUT, "login-4-back-en.png") });

  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
