/**
 * Show where the language control actually is: the full settings panel from
 * the library hero, and the compact one in the top bar. Screenshots both.
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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1.5 });

  await page.goto(BASE + "/library", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.setItem("gloss:lang", "zh"));
  await page.goto(BASE + "/library", { waitUntil: "networkidle0", timeout: 90000 });
  await wait(3500);

  // The full panel: the hero's Aa (not compact), so it has the three tabs.
  const openedFull = await page.evaluate(() => {
    const aa = [...document.querySelectorAll("button")].find((b) => {
      const s = b.querySelector("span");
      return s && s.innerText.trim() === "Aa" && b.closest(".lib-hero, .lib-tools, [class*=hero]");
    });
    (aa || [...document.querySelectorAll("button")].find((b) => b.querySelector("span")?.innerText.trim() === "Aa"))?.click();
    return !!aa;
  });
  await wait(1400);
  const fullPanel = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".pop, [role=dialog]")];
    const lang = rows.map((r) => r.innerText).find((x) => /English/.test(x) && /中文/.test(x));
    return { found: !!lang, tabs: [...document.querySelectorAll("[role=radio]")].slice(0, 3).map((e) => e.innerText.trim()) };
  });
  console.log("完整设置面板:", JSON.stringify(fullPanel), "hero入口:", openedFull);
  await page.screenshot({ path: path.join(OUT, "lang-panel-full.png") });

  await page.keyboard.press("Escape");
  await wait(900);

  // The compact panel: the Aa in the top bar.
  await page.evaluate(() => {
    const bars = [...document.querySelectorAll(".lib-top button, header button")];
    const aa = bars.find((b) => b.innerText.trim() === "Aa");
    aa?.click();
  });
  await wait(1400);
  const compactPanel = await page.evaluate(() => {
    const panels = [...document.querySelectorAll(".pop, [role=dialog]")].filter((p) => /English/.test(p.innerText));
    const p = panels[panels.length - 1];
    return {
      found: !!p,
      langRowText: p?.innerText.split("\n").filter((x) => /English|中文|语言/.test(x)).slice(0, 6) ?? [],
      buttons: [...(p?.querySelectorAll("button") ?? [])].map((b) => b.innerText.trim()).filter(Boolean).slice(-6),
    };
  });
  console.log("顶栏紧凑面板:", JSON.stringify(compactPanel, null, 2));
  await page.screenshot({ path: path.join(OUT, "lang-panel-compact.png") });

  await browser.close();
})();