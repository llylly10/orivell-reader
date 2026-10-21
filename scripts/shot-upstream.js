/**
 * Screenshot the upstream Gloss library page, then click a spine to catch the
 * book mid-flight and fully open. Writes PNGs into upstream-shots/.
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
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950, deviceScaleFactor: 1.5 });

  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 300)));

  await page.goto(BASE + "/library", { waitUntil: "networkidle0", timeout: 90000 });
  await wait(4000);
  await page.screenshot({ path: path.join(OUT, "01-library-shelf.png") });
  console.log("shot 01: shelf");

  // How many spines / covers are actually on the shelf?
  const counts = await page.evaluate(() => ({
    spines: document.querySelectorAll(".spine").length,
    books: document.querySelectorAll(".lk-book, .shelf-book, [data-book]").length,
    planks: document.querySelectorAll(".shelf-plank, .plank").length,
    titles: [...document.querySelectorAll(".spine-title")].slice(0, 8).map((e) => e.innerText),
    storeBooks: (() => {
      try {
        const raw = localStorage.getItem("gloss.books");
        return raw ? JSON.parse(raw).length : "no localStorage key";
      } catch (e) {
        return "err " + e.message;
      }
    })(),
    lsKeys: Object.keys(localStorage),
  }));
  console.log("counts:", JSON.stringify(counts, null, 2));

  // Click a spine -> catch the flight, then the open book.
  const spine = await page.$(".spine");
  if (spine) {
    await spine.click();
    await wait(420);
    await page.screenshot({ path: path.join(OUT, "02-book-in-flight.png") });
    console.log("shot 02: in flight");
    await wait(1600);
    await page.screenshot({ path: path.join(OUT, "03-book-open.png") });
    console.log("shot 03: open");

    const opened = await page.evaluate(() => {
      const stage = document.querySelector(".ob-stage");
      const book = document.querySelector(".ob-book");
      return {
        stage: !!stage,
        phase: stage?.dataset.phase ?? null,
        bookTransform: book ? getComputedStyle(book).transform.slice(0, 120) : null,
        readBtn: document.querySelector(".ob-read")?.innerText ?? null,
      };
    });
    console.log("opened:", JSON.stringify(opened, null, 2));
  } else {
    console.log("NO .spine found");
  }

  // The landing page too.
  await page.goto(BASE + "/", { waitUntil: "networkidle0", timeout: 60000 });
  await wait(2500);
  await page.screenshot({ path: path.join(OUT, "04-home.png") });
  console.log("shot 04: home");

  console.log("ERRORS(" + errors.length + "):");
  errors.slice(0, 12).forEach((e) => console.log("  -", e));

  await browser.close();
})();