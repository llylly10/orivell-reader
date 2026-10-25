import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const STATUS = "D:/shujia/gloss-library/data/x-sync-status.json";
const SCRIPT = "scripts/sync-x-bookmarks.mjs";

function readStatus() {
  if (!existsSync(STATUS)) return { running: false, never: true };
  try {
    return JSON.parse(readFileSync(STATUS, "utf8"));
  } catch {
    return { running: false };
  }
}

/** 同步进度（设置页轮询）。 */
export async function GET() {
  return Response.json(readStatus());
}

/** 开跑一次完整同步：bird 拉书签 → 入 SQLite → 推 Neon。分离进程，进度看 GET。 */
export async function POST() {
  const s = readStatus();
  if (s.running && Date.now() - (s.at ?? 0) < 30 * 60_000) {
    return Response.json({ ok: true, already: true });
  }
  spawn(process.execPath, [SCRIPT], {
    cwd: process.cwd(),
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  }).unref();
  return Response.json({ ok: true, started: true });
}
