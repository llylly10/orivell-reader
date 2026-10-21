/**
 * 只读验证：登录功能是否真的可用。
 *
 * 检查登录页/注册页的中英文文案、社交登录按钮、语言切换、切换语言后
 * Clerk 组件是否跟着变。只读，不改任何配置。
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

/** 抓取页面上的所有可读文本片段。 */
const TEXT = () => {
  const out = [];
  document.querySelectorAll("h1,h2,h3,p,span,button,a,label").forEach((e) => {
    const s = (e.textContent || "").trim();
    if (s && s.length < 60 && !out.includes(s)) out.push(s);
  });
  return out;
};

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

  // ---------- 登录页（英文） ----------
  await page.goto(BASE + "/sign-in", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(2500);
  report.en = {
    title: await page.title(),
    hasForm: await page.evaluate(() => !!document.querySelector("input[type=password], input[name=identifier]")),
    socialButtons: await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .map((b) => (b.textContent || "").trim())
        .filter((t) => /Google|GitHub|微信|WeChat/i.test(t))
    ),
    // 社交登录按钮的 aria-label（Clerk 用 aria-label 标注 provider）
    socialLabels: await page.evaluate(() =>
      [...document.querySelectorAll("[aria-label]")]
        .map((e) => e.getAttribute("aria-label"))
        .filter((l) => l && /google|github|google|github/i.test(l))
    ),
    texts: await page.evaluate(TEXT),
    hasWordmark: await page.evaluate(() => document.body.innerText.includes("Gloss")),
  };
  await page.screenshot({ path: path.join(OUT, "signin-en.png"), fullPage: false });

  // ---------- 切到中文 ----------
  report.switched = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "中文");
    if (!btn) return "no-zh-button";
    btn.click();
    return "clicked";
  });
  await wait(2500);
  report.zh = {
    texts: await page.evaluate(TEXT),
    hasForm: await page.evaluate(() => !!document.querySelector("input[type=password], input[name=identifier]")),
    lang: await page.evaluate(() => document.documentElement.lang),
    storedLang: await page.evaluate(() => localStorage.getItem("gloss:lang")),
  };
  await page.screenshot({ path: path.join(OUT, "signin-zh.png"), fullPage: false });

  // ---------- 注册页（中文应保持） ----------
  await page.goto(BASE + "/sign-up", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(2500);
  report.signUp = {
    hasForm: await page.evaluate(() => !!document.querySelector("input, form")),
    texts: await page.evaluate(TEXT),
  };
  await page.screenshot({ path: path.join(OUT, "signup-zh.png"), fullPage: false });

  // ---------- 首页顶栏的登录按钮 ----------
  await page.goto(BASE + "/", { waitUntil: "networkidle2", timeout: 45000 });
  await wait(2500);
  report.home = {
    signInLabel: await page.evaluate(() => {
      const b = [...document.querySelectorAll("button,a")].find((e) => /^(登录|Sign in)$/i.test((e.textContent || "").trim()));
      return b ? b.textContent.trim() : null;
    }),
    avatarPresent: await page.evaluate(() => !!document.querySelector("[data-clerk-user-button], .cl-userButton, img.clerkUserButton")),
  };
  await page.screenshot({ path: path.join(OUT, "home-zh.png"), fullPage: false });

  report.errors = errors;
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
