/**
 * Chinese platforms the plain fetcher can't reach (login walls, signed APIs).
 * A MediaCrawler sidecar (D:\shujia\MediaCrawler\sidecar.py) does the actual
 * crawling with a saved login state; gloss calls it over loopback HTTP and
 * shapes the same card-style blocks from what comes back. When the sidecar is
 * down or a platform has no login state, this returns null and the regular
 * fetch path takes over.
 */

import { slugify, type Article, type Block } from "./article";

const SIDECAR = process.env.GLOSS_CNSPIDER_URL || "http://127.0.0.1:8899";

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
  for (const m of a.media ?? []) {
    if (!m.url) continue;
    if (m.type === "video") {
      // 国内 CDN 的视频有各自的防盗链，不内联播放，给一个点出去的入口
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
