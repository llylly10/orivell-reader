/**
 * X 书签一键同步：bird 拉全量书签 → import_bookmarks_json 入 gloss-library 的
 * SQLite（按 URL 去重，新内容走完整 build_content 格式）→ import-x-bookmarks
 * 把 SQLite 推到 Neon。进度写 gloss-library/data/x-sync-status.json，
 * 设置页轮询它看进度。
 *
 * 跑法：node scripts/sync-x-bookmarks.mjs（/api/x-sync 会分离拉起，也可手动跑）
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const GL = "D:/shujia/gloss-library";
const GU = "D:/shujia/gloss-upstream";
const PY = "C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe";
const STATUS = `${GL}/data/x-sync-status.json`;
const USER_ID = process.env.GLOSS_USER_ID || "user_3L5fuAOEc9L4CDjPa8EQc83Yh49";

const status = (patch) => {
  let prev = {};
  try {
    prev = JSON.parse(readFileSync(STATUS, "utf8"));
  } catch {}
  writeFileSync(STATUS, JSON.stringify({ ...prev, ...patch, at: Date.now() }, null, 2));
};

// 30 分钟内的旧同步视为仍在进行，拒绝并发
const prev = existsSync(STATUS) ? JSON.parse(readFileSync(STATUS, "utf8")) : {};
if (prev.running && Date.now() - (prev.at ?? 0) < 30 * 60_000) {
  console.log("已有一次同步在进行中（状态文件未清除）。");
  process.exit(0);
}

if (!existsSync(`${GL}/.x_token`)) {
  status({ running: false, error: "缺少 .x_token 凭证——先跑一次 fetch-x.bat 或 save_token.py 生成。", step: "fetch" });
  console.log("缺少 .x_token。");
  process.exit(1);
}

status({ running: true, at: Date.now(), step: "fetch", error: null, lines: [], result: null });

function run(step, cmd, cwd, extraEnv = {}) {
  return new Promise((resolve) => {
    status({ step });
    let tail = [];
    const push = (d) => {
      tail = [...tail, ...d.toString().split("\n")].filter(Boolean).slice(-10);
      status({ lines: tail });
    };
    const p = spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...extraEnv } });
    p.stdout.on("data", push);
    p.stderr.on("data", push);
    p.on("close", (code) => resolve(code ?? -1));
    p.on("error", () => resolve(-1));
  });
}

let code = await run("fetch", [PY, "scripts/fetch_bookmarks.py"], GL);
if (code !== 0) {
  status({ running: false, error: "拉取书签失败——多半是 .x_token 过期，删掉重跑 fetch-x.bat 重新贴凭证。" });
  process.exit(1);
}

code = await run("sqlite", [PY, "scripts/import_bookmarks_json.py", "bookmarks_raw.json"], GL);
if (code !== 0) {
  status({ running: false, error: "写入 gloss-library 失败。" });
  process.exit(1);
}

code = await run("neon", [process.execPath, "--experimental-sqlite", "scripts/import-x-bookmarks.js"], GU, { GLOSS_USER_ID: USER_ID });
if (code !== 0) {
  status({ running: false, error: "推送到 Neon 失败——看上方日志。" });
  process.exit(1);
}

status({ running: false, done: true, finishedAt: Date.now() });
console.log("同步完成。");
