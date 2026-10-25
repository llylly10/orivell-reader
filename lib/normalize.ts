import { createHash } from "node:crypto";

/** 已知的追踪参数——canonical 化时剥掉 */
const TRACKING_PARAMS = /^(utm_|fbclid|gclid|ref_src|ref_url|si_|spm$|share_|from$)/i;

/**
 * URL 规范化阶梯：同一个小写主机、去锚点、去追踪参数、去尾斜杠、去移动端前缀。
 * 同一篇文章从不同入口保存，规范化后应得到同一个键。
 */
export function canonicalUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  u.hash = "";
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase().replace(/^(?:www\.|m\.|mobile\.)/, "");
  const keep: [string, string][] = [];
  u.searchParams.forEach((v, k) => {
    if (!TRACKING_PARAMS.test(k)) keep.push([k, v]);
  });
  u.search = keep.length ? `?${new URLSearchParams(keep).toString()}` : "";
  let s = u.toString();
  if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
  return s;
}

/** 文本规范化：小写、去链接、去空白与标点差异——病毒式逐字复制应得到同一个键 */
export function normalizeForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\s\p{P}\p{S}]+/gu, " ")
    .trim();
}

/** 规范化文本的 sha256——重复检测的分组键 */
export function textHash(text: string): string {
  return createHash("sha256").update(normalizeForHash(text)).digest("hex");
}
