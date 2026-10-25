/**
 * Chinese platforms the plain fetcher can't reach (login walls, signed APIs).
 * A MediaCrawler sidecar (D:\shujia\MediaCrawler\sidecar.py) does the actual
 * crawling with a saved login state; gloss calls it over loopback HTTP and
 * shapes the same card-style blocks from what comes back. When the sidecar is
 * down or a platform has no login state, this returns null and the regular
 * fetch path takes over.
 */

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { slugify, type Article, type Block } from "./article";

const SIDECAR = process.env.GLOSS_CNSPIDER_URL || "http://127.0.0.1:8899";
const SIDECAR_PY = "D:/shujia/MediaCrawler/.venv/Scripts/python.exe";
const SIDECAR_PY_FILE = "D:/shujia/MediaCrawler/sidecar.py";
const SIDECAR_DIR = "D:/shujia/MediaCrawler";

let sidecarSpawned = false;

/** Sidecar 随项目启动：没在跑就拉起一个（幂等），最多等 4 秒。拉不起来返回 false，
    调用方走普通抓取路径。拉起的进程与 gloss 服务同生共死之外的存留也无妨——
    它空闲时零开销，下次启动靠端口探测复用。 */
async function ensureSidecar(): Promise<boolean> {
  try {
    const r = await fetch(`${SIDECAR}/status`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) return true;
  } catch {}
  if (sidecarSpawned || !existsSync(SIDECAR_PY) || !existsSync(SIDECAR_PY_FILE)) return false;
  sidecarSpawned = true;
  spawn(SIDECAR_PY, [SIDECAR_PY_FILE], { cwd: SIDECAR_DIR, detached: true, windowsHide: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`${SIDECAR}/status`, { signal: AbortSignal.timeout(1200) });
      if (r.ok) return true;
    } catch {}
  }
  return false;
}

const CN_PLATFORMS = /xiaohongshu\.com|xhslink\.com|douyin\.com|weibo\.com|m\.weibo\.cn|tieba\.baidu\.com|bilibili\.com|kuaishou\.com|zhihu\.com/;

type SidecarArticle = {
  platform?: string;
  id?: string;
  title?: string;
  text?: string;
  author?: string;
  media?: { type?: string; url?: string }[];
  sourceUrl?: string;
};

type SidecarResult = { ok?: boolean; needsLogin?: boolean; platform?: string; error?: string; article?: SidecarArticle };

/** A card from the sidecar, or null when this URL isn't a CN platform / the sidecar couldn't help. */
export async function cnCard(url: URL): Promise<Article | null> {
  if (!CN_PLATFORMS.test(url.hostname)) return null;
  if (!(await ensureSidecar())) return null;
  let sidecar: SidecarResult | null = null;
  try {
    const res = await fetch(`${SIDECAR}/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.toString() }),
      signal: AbortSignal.timeout(320_000),
    });
    sidecar = (await res.json()) as SidecarResult;
  } catch {
    return null;
  }
  const a = sidecar?.article;
  if (!sidecar?.ok || !a) return null;

  const text = (a.text || "").trim();
  const blocks: Block[] = [];
  const nextId = () => `b${blocks.length + 1}`;
  if (a.author) blocks.push({ id: nextId(), type: "p", runs: [{ text: a.author, strong: true }] });
  if (a.title && a.title !== text.slice(0, a.title.length)) {
    blocks.push({ id: nextId(), type: "p", runs: [{ text: a.title, strong: true }] });
  }
  for (const para of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    blocks.push({ id: nextId(), type: "p", runs: [{ text: para.replace(/\n+/g, " ") }] });
  }
  // B站视频：官方 iframe 播放器内联播放（player.bilibili.com 本就是给外站嵌入用的，
  // 无防盗链），兜底是点链接回 B站看。
  if (a.platform === "bili") {
    const bv = /\/video\/(BV[0-9A-Za-z]+)/.exec(url.pathname)?.[1];
    if (bv) {
      blocks.push({ id: nextId(), type: "figure", runs: [], src: `https://player.bilibili.com/player.html?bvid=${bv}&autoplay=0&high_quality=1` });
    }
    blocks.push({ id: nextId(), type: "p", runs: [{ text: "▶ 在 B站观看：", strong: true }, { text: url.toString(), href: url.toString() }] });
  }
  for (const m of a.media ?? []) {
    if (!m.url) continue;
    if (m.type === "video") {
      if (a.platform === "bili") continue; // 已用官方播放器内联
      // 其余国内 CDN 的视频有各自的防盗链，不内联播放，给一个点出去的入口
      blocks.push({ id: nextId(), type: "p", runs: [{ text: "▶ 视频：", strong: true }, { text: "点开观看", href: m.url }] });
    } else {
      blocks.push({ id: nextId(), type: "figure", runs: [], src: m.url, alt: "" });
    }
  }
  if (!text && !(a.media ?? []).length) {
    blocks.push({ id: nextId(), type: "p", runs: [{ text: "这条内容没有可提取的正文，点开原链接查看。", href: url.toString() }] });
  }

  const title = (a.title || text.slice(0, 40) || `${a.platform} 内容`).trim();
  return {
    id: `${slugify(title) || a.platform || "post"}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    author: a.author || undefined,
    source: a.platform || undefined,
    sourceUrl: url.toString(),
    dek: text ? text.replace(/\s+/g, " ").slice(0, 280) : undefined,
    blocks,
    origin: "url",
    addedAt: Date.now(),
  };
}
