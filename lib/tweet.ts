/**
 * A pasted X status link becomes the same tweet card the bookmark pipeline
 * shelves, instead of being turned away as "a post, not an article".
 *
 * fxtwitter — the service behind Discord/Telegram embeds — serves the whole
 * post in one JSON, no credentials: author, text with real URLs, media by
 * their direct addresses, counts, and the X Article title when the post is
 * one. The one thing it leaves out is the quoted post; bird fills that in,
 * and the quoted post's media comes back from fxtwitter by its id. Both
 * lookups are best-effort: when either fails the card still builds from
 * whatever arrived, and when everything fails the caller falls through to
 * the page's own og tags.
 */

import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { slugify, type Article, type Block, type Run } from "./article";

const FX = (id: string) => `https://api.fxtwitter.com/status/${id}`;
/** bird ships in the user-level workspace; its credentials live beside the pipeline that bridges the two projects. */
const BIRD = "C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/.bin/bird.cmd";
const TOKEN = "D:/shujia/gloss-library/.x_token";

type FxMedia = { type?: string; url?: string; altText?: string };
type FxTweet = {
  id?: string;
  text?: string;
  /** fxtwitter hands this over either as a string or as the raw entity object { text, facets… }. */
  raw_text?: string | { text?: string } | null;
  created_at?: string;
  likes?: number;
  retweets?: number;
  replies?: number;
  author?: { name?: string; screen_name?: string };
  media?: { all?: FxMedia[] };
  article?: { title?: string };
};

/** The status id of an x.com/twitter.com post URL, or null for anything else. */
export function statusId(url: URL): string | null {
  if (!/^(?:www\.)?(?:x|twitter)\.com$/.test(url.hostname)) return null;
  return /\/status(?:es)?\/(\d+)/.exec(url.pathname)?.[1] ?? null;
}

async function fxTweet(id: string): Promise<FxTweet | null> {
  try {
    const res = await fetch(FX(id), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; gloss-local/1.0; +reader)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return (j?.tweet as FxTweet) ?? null;
  } catch {
    return null;
  }
}

/** The post a pasted post quotes: bird reads it out of the main post's JSON. */
async function birdQuoted(id: string): Promise<{ id: string; text?: string; handle?: string } | null> {
  if (!existsSync(BIRD) || !existsSync(TOKEN)) return null;
  let auth = "";
  let ct0 = "";
  for (const line of readFileSync(TOKEN, "utf8").split("\n")) {
    const [k, v] = line.split("=", 2).map((s) => s?.trim());
    if (k === "AUTH_TOKEN") auth = v ?? "";
    if (k === "CT0") ct0 = v ?? "";
  }
  if (!auth || !ct0) return null;
  return new Promise((resolve) => {
    execFile(
      BIRD,
      ["read", `https://x.com/i/status/${id}`, "--json"],
      { timeout: 20_000, shell: true, windowsHide: true, env: { ...process.env, AUTH_TOKEN: auth, CT0: ct0 } },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const j = JSON.parse(stdout);
          const q = (j.tweet ?? j).quotedTweet;
          if (!q?.id) return resolve(null);
          resolve({ id: String(q.id), text: (q.text ?? "").trim(), handle: q.author?.username ?? "" });
        } catch {
          resolve(null);
        }
      },
    );
  });
}

function mediaBlocks(m: FxMedia, nextId: () => string): Block[] {
  if (m.type === "photo" && m.url) {
    return [{ id: nextId(), type: "figure", runs: m.altText ? [{ text: m.altText }] : [], src: m.url, alt: m.altText ?? "" }];
  }
  if ((m.type === "video" || m.type === "gif") && m.url) {
    return [{ id: nextId(), type: "figure", runs: [], src: m.url, alt: "" }];
  }
  return [];
}

/** A status link's tweet card, or null when the lookup came up empty. */
export async function tweetCard(url: URL): Promise<Article | null> {
  const id = statusId(url);
  if (!id) return null;
  const [t, quoted] = await Promise.all([fxTweet(id), birdQuoted(id)]);
  if (!t) return null;

  // The quoted post's own media: fxtwitter serves it for any post, by id.
  let qmedia: FxMedia[] = [];
  if (quoted) {
    const qt = await fxTweet(quoted.id);
    qmedia = qt?.media?.all ?? [];
  }

  const handle = t.author?.screen_name ?? "";
  const name = t.author?.name ?? "";
  const raw = t.raw_text;
  const text = (typeof raw === "string" ? raw : typeof raw === "object" && raw?.text ? String(raw.text) : t.text ?? "").trim();

  const blocks: Block[] = [];
  const nextId = () => `b${blocks.length + 1}`;
  blocks.push({ id: nextId(), type: "p", runs: [{ text: `@${handle}`, strong: true }, { text: name ? ` · ${name}` : "" }] } as Block);
  for (const para of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    blocks.push({ id: nextId(), type: "p", runs: [{ text: para.replace(/\n+/g, " ") }] });
  }
  if (t.article?.title?.trim()) {
    blocks.push({ id: nextId(), type: "p", runs: [{ text: `📄 ${t.article.title.trim()}`, strong: true }] });
  }
  if (quoted) {
    const qruns: Run[] = [{ text: "引用 " }, { text: `@${quoted.handle || "x"}`, href: `https://x.com/i/status/${quoted.id}` }];
    if (quoted.text) qruns.push({ text: " " + quoted.text.replace(/\n+/g, " ") });
    const qblock: Block = { id: nextId(), type: "quote", runs: qruns };
    const link = qruns.find((r) => r.href);
    if (link?.href) qblock.quoteUrl = link.href;
    blocks.push(qblock);
    for (const m of qmedia) blocks.push(...mediaBlocks(m, nextId));
  }
  for (const m of t.media?.all ?? []) blocks.push(...mediaBlocks(m, nextId));
  const stats = [
    t.likes ? `♥ ${t.likes}` : "",
    t.retweets ? `🔁 ${t.retweets}` : "",
    t.replies ? `💬 ${t.replies}` : "",
  ].filter(Boolean);
  if (stats.length) blocks.push({ id: nextId(), type: "p", runs: [{ text: stats.join("  ") }] });
  if (t.created_at) blocks.push({ id: nextId(), type: "p", runs: [{ text: t.created_at }] });

  const title = text.split("\n")[0].trim().replace(/https?:\/\/\S+/g, "").trim().slice(0, 70) || `X 上的 ${name || handle || "post"}`;
  const dek = text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 280);
  return {
    id: `${slugify(title) || "post"}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    author: `@${handle}` + (name ? ` ${name}` : ""),
    source: "X",
    sourceUrl: url.toString(),
    dek: dek || undefined,
    blocks,
    origin: "url",
    addedAt: Date.now(),
  };
}
