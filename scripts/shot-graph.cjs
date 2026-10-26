/** 图谱页截图：桌面宽度，供设计评审。 */
const puppeteer = require("puppeteer-core");
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe",
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("http://127.0.0.1:3100/graph", { waitUntil: "networkidle2", timeout: 90000 });
  await new Promise((r) => setTimeout(r, 6000));
  await page.screenshot({ path: "D:/shujia/gloss-upstream/.taste-skill/graph-before.png" });
  console.log("截图完成 → .taste-skill/graph-before.png");
  await browser.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
