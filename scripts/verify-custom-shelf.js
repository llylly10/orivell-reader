/**
 * Open the new custom-shelf UI and read what it says, in both languages.
 *
 * The point is the parts upstream added in PR #16: the create form, the
 * rename and delete controls, and the saved-link card. These were added
 * after the translation pass, so they are where English tends to survive.
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
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));

  async function setLang(lang) {
    await page.goto(BASE + "/library", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.evaluate((l) => localStorage.setItem("gloss:lang", l), lang);
    await page.goto(BASE + "/library", { waitUntil: "networkidle0", timeout: 180000 });
    await wait(4000);
  }

  for (const lang of ["zh", "en"]) {
    await setLang(lang);

    // The create form: click the "+ New shelf" chip in the filter row.
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll(".lib-chip")].find((e) => /新建书架|New shelf/.test(e.innerText));
      chip?.click();
    });
    await wait(1200);

    const form = await page.evaluate(() => {
      const f = document.querySelector(".shelf-new-form");
      if (!f) return null;
      return {
        placeholder: f.querySelector("input")?.getAttribute("placeholder"),
        ariaLabel: f.querySelector("input")?.getAttribute("aria-label"),
        buttons: [...f.querySelectorAll("button")].map((b) => b.innerText.trim()),
      };
    });
    console.log(`\n=== 新建书架表单 (${lang}) ===`);
    console.log(JSON.stringify(form, null, 2));
    if (lang === "zh") await page.screenshot({ path: path.join(OUT, "zh-new-shelf-form.png") });

    // Close the form, then open a book to check the in-book shelf controls.
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll(".shelf-new-form button")].find(
        (b) => /取消|Cancel/.test(b.innerText)
      );
      btn?.click();
    });
    await wait(800);

    const spine = await page.$(".spine");
    if (spine) {
      await spine.click();
      await wait(2200);
      const book = await page.evaluate(() => {
        const sel = document.querySelector(".ob-chip select");
        return {
          chipTip: document.querySelector(".ob-chip")?.getAttribute("data-tip"),
          chipText: document.querySelector(".ob-chip span")?.innerText?.trim(),
          selectAria: sel?.getAttribute("aria-label"),
          options: sel ? [...sel.options].map((o) => o.text.trim()) : [],
        };
      });
      console.log(`\n=== 书内书架控件 (${lang}) ===`);
      console.log(JSON.stringify(book, null, 2));
      if (lang === "zh") await page.screenshot({ path: path.join(OUT, "zh-book-shelf-select.png") });
      await page.keyboard.press("Escape");
      await wait(1200);
    }
  }

  console.log(`\n错误 (${errors.length})`);
  errors.slice(0, 5).forEach((e) => console.log(" -", e));
  await browser.close();
})();