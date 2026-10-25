/** Links, shared by browser and server. */

/** The same link, written the same way: no fragment, no tracking parameters, no trailing
    slash, lowercase host without its www/m/mobile prefix. The tracking list matches the
    server's canonicalUrl (lib/normalize.ts) so import-time and scan-time agree on identity. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|igsh$|ref$|ref_src$|ref_url$|si_|spm$|share_|from$|s$|t$|mc_)/i.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase().replace(/^(?:www\.|m\.|mobile\.)/, "");
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}
