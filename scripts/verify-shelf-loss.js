/**
 * 墓碑只来自「写盘亲眼见证的删除」——这条不变式的端到端验证。
 *
 * 背景（真实事故）：账户里的东西被同步删了。根因是两把 key 落盘时刻不同——
 * 基线（gloss:sync:*）pull 一结束就写，书架（gloss:v1）防抖 400ms 才写。
 * 窗口里刷新一次，基线记下了 id、书架却没有，下次 push 判定「用户删了」，
 * 把账户里的东西推成墓碑。
 *
 * 修好之后，墓碑的来源不再是「基线里有、本地没有」这个推断，而是写盘亲眼
 * 见证的删除：写盘前后书架差出来的行，记在书架 payload 自己的 removals 里，
 * 跟书架同一次落盘。基线里的残留 id 一个都不推。
 *
 * 这个脚本把四条各跑一遍（每条一篇不同的文章，互不干扰）：
 *   1. 见证过的删除，照旧推成墓碑   —— 删除同步没被改坏
 *   2. 删除的证据在书架里，刷新不丢   —— 推墓前刷新，证据还在
 *   3. 账户有、本机没存过的行不推墓碑  —— 原始事故那条路
 *   4. 账户从别的设备删的，不被推回去  —— 不来回抖
 *
 * 跑法：node scripts/verify-shelf-loss.js
 * 前提：npm run dev 在 3100 跑着；.env.local 里有 Clerk 与数据库配置。
 */
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const https = require("https");
const path = require("path");

const CHROME =
  process.env.CHROME_PATH ||
  "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const BASE = process.env.BASE_URL || "http://127.0.0.1:3100";
const FAPI = "https://dashing-prawn-4703.clerk.accounts.dev";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ENV = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const get = (name) => {
  const m = ENV.match(new RegExp(`^${name}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
};
const SECRET = get("CLERK_SECRET_KEY");
const DBURL = get("DATABASE_URL");

function bapi(method, p, body) {
  return new Promise((resolve, reject) => {
    const d = body ? JSON.stringify(body) : null;
    const r = https.request(
      {
        host: "api.clerk.com",
        path: p,
        method,
        headers: {
          Authorization: `Bearer ${SECRET}`,
          "Content-Type": "application/json",
          ...(d ? { "Content-Length": Buffer.byteLength(d) } : {}),
        },
      },
      (x) => {
        let b = "";
        x.on("data", (c) => (b += c));
        x.on("end", () => {
          try {
            resolve(JSON.parse(b));
          } catch {
            resolve({ raw: b.slice(0, 200) });
          }
        });
      }
    );
    r.on("error", reject);
    if (d) r.write(d);
    r.end();
  });
}

/** 轮询到条件成立，超时抛错（label 用于报错信息）。 */
async function until(fn, { timeout = 30000, interval = 500, label = "" } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`超时（${timeout / 1000}s）：${label || "条件未满足"}`);
    await wait(interval);
  }
}

const RUN = Date.now().toString(36);
const A1 = `loss-${RUN}-1`; // 见证过的删除
const A2 = `loss-${RUN}-2`; // 证据过刷新
const A3 = `loss-${RUN}-3`; // 从来没存过
const A4 = `loss-${RUN}-4`; // 别的设备删的
const A5 = `loss-${RUN}-5`; // 第四条的对照：一次照旧的本地改动

const checks = [];
const check = (name, pass, evidence) => {
  checks.push({ name, pass });
  console.log(`\n  ${pass ? "✅" : "❌"} ${name}`);
  for (const line of evidence) console.log(`     ${line}`);
};

(async () => {
  const u = await bapi("POST", "/v1/users", {
    email_address: [`gloss+clerk_test_${Date.now()}@example.com`],
    password: "GlossTest123456!",
    skip_password_checks: true,
    skip_optional_checks: true,
  });
  const sit = await bapi("POST", "/v1/sign_in_tokens", { user_id: u.id, expires_in_seconds: 300 });
  const tt = await bapi("POST", "/v1/testing_tokens", { user_id: "" });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--no-proxy-server"] });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // 所有推给账户的请求都记下来，最后逐条核对谁被推成了墓碑。
  const posts = [];
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/sync") && req.method() === "POST") posts.push(req.postData() || "");
    if (!url.startsWith(FAPI) || !tt.token) return req.continue();
    try {
      const x = new URL(url);
      x.searchParams.set("__clerk_testing_token", tt.token);
      req.continue({ url: x.toString() });
    } catch {
      req.continue();
    }
  });

  /* ---------- 页面里的小工具 ---------- */

  // 往账户里塞一篇（模拟另一台设备刚保存的）
  const seed = async (id) => {
    await page.evaluate(async (id) => {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: { articles: [{ id, articleId: id, data: { id, title: `测试 ${id}`, words: 10, origin: "url" } }] } }),
      });
    }, id);
  };

  // 账户里这一篇现在的状态（从 1970 拉全量，墓碑也看得见）
  const account = (id) =>
    page.evaluate(async (id) => {
      const r = await fetch("/api/sync?since=1970-01-01T00:00:00Z");
      const j = await r.json();
      return (j.changes?.articles ?? []).filter((a) => a.id === id).map((a) => ({ deleted: !!a.deleted }));
    }, id);

  // 本地书架与删除台账
  const shelf = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("gloss:v1");
      const d = raw ? JSON.parse(raw) : {};
      const k = Object.keys(localStorage).find((x) => x.startsWith("gloss:sync:"));
      const b = k ? JSON.parse(localStorage.getItem(k)) : null;
      return {
        library: (d.library ?? []).map((x) => x.id),
        ledger: (d.removals?.articles ?? []).map((r) => r.id),
        seen: Object.keys(b?.seen?.articles ?? {}).length,
        since: b?.since ?? null,
      };
    });

  // 这些请求里，有没有把哪一篇推成了墓碑
  const pushedTombs = (ids) => {
    const out = [];
    for (const body of posts) {
      let c;
      try {
        c = JSON.parse(body);
      } catch {
        continue;
      }
      for (const rows of Object.values(c.changes ?? {})) {
        for (const r of rows ?? []) if (r && r.deleted && ids.includes(r.id)) out.push(r.id);
      }
    }
    return out;
  };

  // 等一次新的 pull 落地（基线时间戳往前走），证明刷新后同步真的又跑了
  const waitFreshPull = async (prevSince) => {
    await until(async () => (await shelf()).since !== prevSince, { timeout: 30000, label: "刷新后同步重新跑起来（拉到新基线）" });
    return (await shelf()).since;
  };

  // 新到书会弹一张「 arrivals 」卡片，挡在书架上面；点掉它再点书
  const dismissWave = async () => {
    const x = await page.$("button.arr-x");
    if (x) {
      await x.click().catch(() => {});
      await wait(400);
    }
  };

  // 点开一本书，再点垃圾桶 —— 走的是读者真实的删除路径
  const removeViaUI = async (id) => {
    await until(() => page.$(`[data-book="${id}"]`), { timeout: 15000, label: `书架上出现 ${id}` });
    await wait(900); // 等书架的入场动画停下
    await dismissWave();
    await page.click(`[data-book="${id}"]`);
    await page.waitForFunction(() => document.querySelector(".ob-stage button.ob-icon"), { timeout: 10000 });
    return page.evaluate(() => {
      const stage = document.querySelector(".ob-stage");
      const btn = [...stage.querySelectorAll("button.ob-icon")].find((b) => /移除|Remove/.test(b.getAttribute("aria-label") || ""));
      if (!btn) return false;
      btn.click();
      return true;
    });
  };

  // 点开一本书，点亮收藏 —— 一次普通的本地改动（账户该收到它）
  const favoriteViaUI = async (id) => {
    await until(() => page.$(`[data-book="${id}"]`), { timeout: 15000, label: `书架上出现 ${id}` });
    await wait(900);
    await dismissWave();
    await page.click(`[data-book="${id}"]`);
    await page.waitForFunction(() => document.querySelector(".ob-stage button.ob-icon"), { timeout: 10000 });
    return page.evaluate(() => {
      const stage = document.querySelector(".ob-stage");
      const btn = [...stage.querySelectorAll("button.ob-icon")].find((b) => /收藏|Favorit/.test(b.getAttribute("aria-label") || ""));
      if (!btn) return false;
      btn.click();
      return true;
    });
  };

  try {
    /* ---------- 登录 ---------- */
    await page.goto(BASE + "/library", { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(() => window.Clerk && window.Clerk.loaded, { timeout: 30000 }).catch(() => {});
    await wait(1500);
    await page.evaluate(async (tk) => {
      const r = await window.Clerk.client.signIn.create({ strategy: "ticket", ticket: tk });
      if (r.status === "complete") await window.Clerk.setActive({ session: r.createdSessionId });
    }, sit.token);
    await wait(2000);
    // 重新进一次，让应用带着会话起来，同步跑起来
    await page.goto(BASE + "/library", { waitUntil: "networkidle2", timeout: 60000 });
    await until(async () => (await shelf()).since, { timeout: 30000, label: "同步基线出现（同步已启动）" });
    console.log(`已登录，同步已启动（基线 seen ${(await shelf()).seen} 篇）\n`);

    /* ---------- 1. 见证过的删除，照旧推成墓碑 ---------- */
    console.log("━━━ 1. 读者删掉的，照旧推成墓碑 ━━━");
    posts.length = 0;
    await seed(A1);
    await until(async () => (await shelf()).library.includes(A1), { label: `${A1} 被拉下来` });
    console.log(`  书架上有了 ${A1}，现在读者删掉它`);
    if (!(await removeViaUI(A1))) throw new Error("点不到删除按钮");
    await until(async () => (await account(A1))[0]?.deleted === true, { label: "账户记下了这次删除" });
    const s1 = await shelf();
    check("见证过的删除推成了墓碑，账户照旧忘掉它", pushedTombs([A1]).includes(A1) && s1.ledger.length === 0, [
      `推给账户的墓碑：[${pushedTombs([A1]).join(", ") || "无"}]`,
      `账户里 ${A1}：deleted=${(await account(A1))[0]?.deleted}`,
      `推完之后台账剩：${s1.ledger.length} 行`,
    ]);

    /* ---------- 2. 删除的证据在书架里，刷新不丢 ---------- */
    console.log("\n━━━ 2. 推墓之前刷新一次，证据还在 ━━━");
    posts.length = 0;
    await seed(A2);
    await until(async () => (await shelf()).library.includes(A2), { label: `${A2} 被拉下来` });
    // pull 有 30 秒的重叠窗口：刚更新过的行会被重新投递一次。若在这窗口里
    // 刷新，账户那份 A2 会再回到书架上（那是另一回事，见 sync.ts 的注释）。
    // 这里要验的是「刷新不抹掉删除的证据」，所以等窗口过去再删。
    console.log("  等 pull 的 30 秒重叠窗口过去（否则刷新会把账户那份又投递回来）…");
    await wait(40000);
    const beforeReload = (await shelf()).since;
    // 断网：删除照旧落盘，但推不出去 —— 把「刷新发生在推墓之前」做实
    await page.setOfflineMode(true);
    await removeViaUI(A2);
    const witnessed = await until(
      async () => {
        const s = await shelf();
        return s.ledger.includes(A2) ? s : null;
      },
      { timeout: 15000, label: "删除被写盘见证（台账里有了它）" }
    );
    console.log(`  断网中删除，台账已记下：${witnessed.ledger.join(", ")}；这期间推到账户的请求：${posts.length} 次`);
    await page.setOfflineMode(false);
    posts.length = 0;
    await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
    await waitFreshPull(beforeReload);
    await until(async () => (await account(A2))[0]?.deleted === true, { label: "刷新之后，删除还是到了账户" });
    const s2 = await shelf();
    check("刷新没抹掉删除的证据，墓碑照旧送到", pushedTombs([A2]).includes(A2) && s2.ledger.length === 0, [
      `刷新后推给账户的墓碑：[${pushedTombs([A2]).join(", ") || "无"}]`,
      `账户里 ${A2}：deleted=${(await account(A2))[0]?.deleted}`,
      `刷新后的台账：${JSON.stringify(s2.ledger)}`,
    ]);

    /* ---------- 3. 账户有、本机没存过的行，不推墓碑 ---------- */
    console.log("\n━━━ 3. 账户有、本机没存过的行（原始事故） ━━━");
    posts.length = 0;
    await seed(A3);
    await until(async () => (await shelf()).library.includes(A3), { label: `${A3} 被拉下来` });
    const seenBefore = (await shelf()).seen;
    // 从书架文件里直接拿掉它，且不让任何一次写盘看见这件事：
    // 重新加载后，内存里也没有它 —— 这不是读者删的，是这台设备没存住。
    await page.evaluate((id) => {
      const raw = localStorage.getItem("gloss:v1");
      if (!raw) return;
      const d = JSON.parse(raw);
      d.library = (d.library ?? []).filter((x) => x.id !== id);
      localStorage.setItem("gloss:v1", JSON.stringify(d));
    }, A3);
    const beforeReload3 = (await shelf()).since;
    await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
    await waitFreshPull(beforeReload3);
    await wait(9000); // 至少再走完一轮 push
    const s3 = await shelf();
    const a3 = (await account(A3))[0];
    check("没被写盘见证的消失，不当成删除", a3 && a3.deleted === false && !pushedTombs([A3]).includes(A3), [
      `账户里 ${A3}：${JSON.stringify(a3)}`,
      `这轮推给账户的墓碑：[${pushedTombs([A3]).join(", ") || "无"}]（推送共 ${posts.length} 次）`,
      `书架还在不在本机：${s3.library.includes(A3)}（基线仍记着它：seen ${seenBefore} → ${s3.seen}）`,
    ]);

    /* ---------- 4. 账户从别的设备删的，不被推回去 ---------- */
    console.log("\n━━━ 4. 账户从别的设备删的，不推回去 ━━━");
    posts.length = 0;
    await seed(A4);
    await seed(A5);
    await until(async () => (await shelf()).library.includes(A4) && (await shelf()).library.includes(A5), { label: `${A4} ${A5} 都被拉下来` });
    // 另一台设备把 A4 从账户里删了
    await page.evaluate(async (id) => {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: { articles: [{ id, articleId: id, data: {}, deleted: true }] } }),
      });
    }, A4);
    posts.length = 0; // 之后记录的，都是这台设备自己推的
    await until(async () => !(await shelf()).library.includes(A4), { label: "本机书架跟着少了 A4（拉到了那条墓碑）" });
    // 一次照旧的本地改动：让推送确实发生，且能被看见
    await favoriteViaUI(A5);
    await page.click(".ob-backdrop").catch(() => {});
    await until(async () => posts.length > 0, { timeout: 25000, label: "出现一次推送" }).catch(() => {});
    await wait(4000); // 再给一轮同步的时间
    const s4 = await shelf();
    const a4 = (await account(A4))[0];
    const pushedBack = pushedTombs([A4]);
    check("别的设备删的，本机不推回去", a4 && a4.deleted === true && pushedBack.length === 0 && s4.ledger.length === 0, [
      `账户里 ${A4}：deleted=${a4?.deleted}（另一台设备删的）`,
      `本机推回去的墓碑：[${pushedBack.join(", ") || "无"}]（这期间推送共 ${posts.length} 次，内容含 A5 的改动）`,
      `本机台账剩：${s4.ledger.length} 行`,
    ]);
  } finally {
    await browser.close().catch(() => {});
    // 这个测试用户的库里的行一并删掉，不给数据库留残留
    if (DBURL) {
      try {
        const { neon } = require("@neondatabase/serverless");
        const sql = neon(DBURL);
        const cleaned = [];
        for (const t of ["articles", "highlights", "glosses", "briefs", "progress"]) {
          const before = await sql.query(`select count(*)::int as n from ${t} where user_id = $1`, [u.id]);
          await sql.query(`delete from ${t} where user_id = $1`, [u.id]);
          cleaned.push(`${t}:${before[0]?.n ?? 0}`);
        }
        console.log(`\n库内清理（${u.id}）：${cleaned.join(" ")}`);
      } catch (e) {
        console.log(`\n库内清理没做成：${e.message}`);
      }
    }
    await bapi("DELETE", `/v1/users/${u.id}`).catch(() => {});
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${failed.length ? "❌" : "✅"} ${checks.length - failed.length}/${checks.length} 条通过`);
  for (const c of failed) console.log(`  差着：${c.name}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
