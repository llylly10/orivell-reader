/**
 * Reproduce the Clerk JS load failure in a real browser and report exactly
 * which network requests fail, so the cause is not a guess.
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
  await page.setViewport({ width: 1440, height: 950 });

  const failedRequests = [];
  const clerkRequests = [];
  const consoleErrors = [];

  page.on("requestfailed", (r) => {
    failedRequests.push({ url: r.url().slice(0, 130), err: r.failure()?.errorText });
  });
  page.on("response", (r) => {
    if (/clerk/i.test(r.url())) {
      clerkRequests.push({ status: r.status(), url: r.url().slice(0, 130) });
    }
  });
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 260));
  });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message.slice(0, 260)));

  await page.goto(BASE + "/library", { waitUntil: "networkidle0", timeout: 90000 });
  await wait(6000);

  console.log("=== Clerk 相关请求 ===");
  clerkRequests.forEach((r) => console.log(` ${r.status}  ${r.url}`));
  console.log("=== 失败请求 ===");
  if (!failedRequests.length) console.log(" (无)");
  failedRequests.forEach((r) => console.log(` ${r.err}  ${r.url}`));
  console.log("=== 控制台错误 ===");
  if (!consoleErrors.length) console.log(" (无)");
  consoleErrors.slice(0, 10).forEach((e) => console.log("-", e));

  // Does the page actually render despite the Clerk error?
  const state = await page.evaluate(() => ({
    title: document.title,
    spines: document.querySelectorAll(".spine").length,
    nextErrorOverlay: !!document.querySelector("nextjs-portal"),
    bodyText: (document.body.innerText || "").slice(0, 200).replace(/\s+/g, " "),
  }));
  console.log("=== 页面状态 ===");
  console.log(JSON.stringify(state, null, 2));

  await page.screenshot({ path: path.join(OUT, "clerk-error-repro.png") });
  console.log("screenshot -> upstream-shots/clerk-error-repro.png");

  await browser.close();
})();