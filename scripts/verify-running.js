/**
 * 只读验证：dev server 起来了吗，页面在浏览器里真实渲染成什么样。
 * 不改任何代码，只截图 + 读文案 + 收控制台错误。写图到 verify-shots/。
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe";
const BASE = "http://127.0.0.1:3200";
const OUT = path.join(__dirname, "..", "verify-shots");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });

  const report = {};
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 160));
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e).slice(0, 160)));

  // 首页
  const resp = await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 45000 });
  report.homeStatus = resp.status();
  report.homeTitle = await page.title();
  await wait(2500);
  report.homeSpines = await page.evaluate(() => document.querySelectorAll("[class*=spine], .spine").length);
  report.homeSignIn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button,a")].find((e) => /sign in|登录/i.test(e.textContent || ""));
    return b ? b.textContent.trim().slice(0, 30) : null;
  });
  await page.screenshot({ path: path.join(OUT, "home.png"), fullPage: false });

  // 切中文：先看语言是否记忆在 localStorage
  report.lang = await page.evaluate(() => localStorage.getItem("gloss:lang"));

  // 书架页
  await page.goto(BASE + "/library", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(2000);
  report.libraryStatus = await page.evaluate(() => document.querySelector("h1,h2")?.textContent?.trim().slice(0, 60) || "(无标题)");
  report.librarySpines = await page.evaluate(() => document.querySelectorAll("[class*=spine], .spine").length);
  await page.screenshot({ path: path.join(OUT, "library.png"), fullPage: false });

  // 登录页
  await page.goto(BASE + "/sign-in", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(1500);
  report.signInHasForm = await page.evaluate(() => !!document.querySelector("input[type=password], input[name=identifier], form"));
  await page.screenshot({ path: path.join(OUT, "signin.png"), fullPage: false });

  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});