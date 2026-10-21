/**
 * Check the development panel: that Next.js's own badge is gone, that ours
 * opens, and that its labels follow the interface language.
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
const HAS_CJK = /[\u4e00-\u9fff]/;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));

  await page.goto(BASE + "/library", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("gloss:lang", "en"));
  // The first compile after a cold start is slow, so wait for the app rather
// than for the network to go quiet: Clerk keeps a websocket open.
  await page.goto(BASE + "/library", { waitUntil: "networkidle0", timeout: 240000 });
  await wait(3500);

  // Next's badge must be off, and our collapsed button must be there.
  const badges = await page.evaluate(() => ({
    nextjsPortal: !!document.querySelector("nextjs-portal"),
    ourBadge: !!document.querySelector(".dp-badge"),
    dpPanel: !!document.querySelector(".dp"),
  }));
  console.log("徽标状态:", JSON.stringify(badges));

  // Open it.
  await page.click(".dp-badge");
  await wait(900);
  const enPanel = await page.evaluate(() => ({
    title: document.querySelector(".dp-title")?.innerText,
    labels: [...document.querySelectorAll(".dp-label")].map((e) => e.innerText.trim()),
    values: [...document.querySelectorAll(".dp-value")].map((e) => e.innerText.trim()),
  }));
  console.log("\n=== 面板（English） ===");
  console.log(JSON.stringify(enPanel, null, 2));
  console.log("含中文:", HAS_CJK.test(JSON.stringify(enPanel)));
  await page.screenshot({ path: path.join(OUT, "dev-panel-en.png") });

  // Switch the language from inside the panel.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll(".dp-btn")].find((x) => /English|中文/.test(x.innerText));
    b?.click();
  });
  await wait(1600);
  const zhPanel = await page.evaluate(() => ({
    title: document.querySelector(".dp-title")?.innerText,
    labels: [...document.querySelectorAll(".dp-label")].map((e) => e.innerText.trim()),
    values: [...document.querySelectorAll(".dp-value")].map((e) => e.innerText.trim()),
    htmlLang: document.documentElement.lang,
  }));
  console.log("\n=== 面板内切换后（中文） ===");
  console.log(JSON.stringify(zhPanel, null, 2));
  console.log("含中文:", HAS_CJK.test(JSON.stringify(zhPanel)));
  await page.screenshot({ path: path.join(OUT, "dev-panel-zh.png") });

  // And the rest of the page followed along.
  const pageTitle = await page.evaluate(() => document.querySelector(".lib-title")?.innerText);
  console.log("\n书架标题:", pageTitle);

  console.log(`\n错误 (${errors.length})`);
  errors.slice(0, 5).forEach((e) => console.log(" -", e));

  console.log("\n=== 结论 ===");
  console.log(`官方徽标已隐藏: ${!badges.nextjsPortal}`);
  console.log(`自建徽标存在: ${badges.ourBadge}`);
  console.log(`面板跟随语言切换: ${!HAS_CJK.test(JSON.stringify(enPanel)) && HAS_CJK.test(JSON.stringify(zhPanel))}`);

  await browser.close();
})();