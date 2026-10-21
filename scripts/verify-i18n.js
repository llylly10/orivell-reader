/**
 * Switch the interface language and check that it really changes: set zh in
 * localStorage, reload, and read the visible strings. Then the same for en.
 * Also opens the settings panel to confirm the language control is there.
 */
const puppeteer = require("puppeteer-core");
const path = require("path");
const fs = require("fs");

const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe";
const BASE = "http://localhost:3100";
const OUT = path.join(__dirname, "..", "upstream-shots");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Any CJK character, so "did it actually switch" needs no dictionary. */
const HAS_CJK = /[\u4e00-\u9fff]/;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1.5 });

  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Clerk/i.test(m.text())) errors.push(m.text().slice(0, 200));
  });

  async function readPage(label) {
    await page.goto(BASE + "/library", { waitUntil: "networkidle0", timeout: 90000 });
    await wait(3500);
    const info = await page.evaluate(() => {
      const txt = (sel) => document.querySelector(sel)?.innerText?.trim() ?? null;
      return {
        lang: document.documentElement.lang,
        h1: txt(".lib-title"),
        stats: txt(".lib-stats"),
        hero: txt(".starter-title"),
        heroBody: txt(".starter-body"),
        hint: txt(".lib-hint"),
        shelfChips: [...document.querySelectorAll(".lib-chip")].slice(0, 5).map((e) => e.innerText.replace(/\s+/g, " ").trim()),
        sorts: [...document.querySelectorAll(".lib-sort button")].map((e) => e.innerText.trim()),
      };
    });
    const hasCjk = HAS_CJK.test(JSON.stringify(info));
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(info, null, 2));
    console.log(`  中文内容: ${hasCjk ? "有" : "无"}`);
    return { info, hasCjk };
  }

  // 1. Chinese
  await page.goto(BASE + "/library", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("gloss:lang", "zh"));
  const zh = await readPage("中文 (zh)");
  await page.screenshot({ path: path.join(OUT, "zh-library.png"), fullPage: false });

  // 2. Open a book to check the 3D open-book card in Chinese.
  const spine = await page.$(".spine");
  if (spine) {
    await spine.click();
    await wait(2000);
    const book = await page.evaluate(() => ({
      read: document.querySelector(".ob-read")?.innerText?.trim() ?? null,
      putBack: document.querySelectorAll(".ob-link")[document.querySelectorAll(".ob-link").length - 1]?.innerText?.trim() ?? null,
      bookplate: document.querySelector(".ex-head")?.innerText?.trim() ?? null,
      plateNo: document.querySelector(".ex-meta")?.innerText?.trim() ?? null,
      progress: document.querySelector(".ob-progress span:last-child")?.innerText?.trim() ?? null,
      tools: [...document.querySelectorAll(".ob-icon")].map((e) => e.getAttribute("aria-label")),
      topicChip: document.querySelector(".ob-chip span")?.innerText?.trim() ?? null,
    }));
    console.log("\n=== 打开的书（中文） ===");
    console.log(JSON.stringify(book, null, 2));
    await page.screenshot({ path: path.join(OUT, "zh-book-open.png") });
    await page.keyboard.press("Escape");
    await wait(1200);
  }

  // 3. Settings panel: the language control, in Chinese.
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const aa = btns.find((b) => b.innerText.trim() === "Aa");
    aa?.click();
  });
  await wait(1200);
  const panel = await page.evaluate(() => {
    const pop = document.querySelector("[role=dialog]") || document.querySelector(".pop");
    return {
      tabs: [...document.querySelectorAll("[role=radio]")].slice(0, 4).map((e) => e.innerText.trim()),
      labels: [...(pop?.querySelectorAll("p,span") ?? [])].map((e) => e.innerText.trim()).filter(Boolean).slice(0, 14),
      hasChinese: null,
    };
  });
  panel.hasChinese = HAS_CJK.test(JSON.stringify(panel));
  console.log("\n=== 设置面板（中文） ===");
  console.log(JSON.stringify(panel, null, 2));
  await page.screenshot({ path: path.join(OUT, "zh-settings.png") });

  // 4. Switch back to English from inside the panel, to prove the control works.
  const switched = await page.evaluate(() => {
    const zhBtn = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "中文");
    if (!zhBtn) return false;
    zhBtn.click();
    return true;
  });
  await wait(900);
  const enBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /English|英文/.test(x.innerText.trim()));
    if (!b) return false;
    b.click();
    return true;
  });
  await wait(1500);
  console.log(`\n语言按钮: 中文=${switched} 英文=${enBtn}`);

  const en = await readPage("English (en, switched in-app)");
  await page.screenshot({ path: path.join(OUT, "en-library.png") });

  // 5. The landing page in both languages.
  await page.goto(BASE + "/", { waitUntil: "networkidle0" });
  await wait(2500);
  await page.screenshot({ path: path.join(OUT, "en-home.png") });
  await page.evaluate(() => localStorage.setItem("gloss:lang", "zh"));
  await page.reload({ waitUntil: "networkidle0" });
  await wait(2500);
  await page.screenshot({ path: path.join(OUT, "zh-home.png") });
  const home = await page.evaluate(() => (document.body.innerText || "").slice(0, 260).replace(/\s+/g, " "));
  console.log("\n=== 首页（中文） ===");
  console.log(home);

  console.log(`\n=== 错误 (${errors.length}) ===`);
  errors.slice(0, 8).forEach((e) => console.log(" -", e));

  console.log("\n=== 结论 ===");
  console.log(`zh 有中文: ${zh.hasCjk} / en 有中文: ${en.hasCjk}`);
  console.log(zh.hasCjk && !en.hasCjk ? "切换有效" : "⚠️ 切换可能没生效");

  await browser.close();
})();