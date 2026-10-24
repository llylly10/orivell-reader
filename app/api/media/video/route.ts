export const runtime = "nodejs";

/**
 * X's video CDN 403s any browser request whose Referer is not x.com, and a
 * media element cannot opt out of the referrer the way an <img> can. The
 * server fetches the file itself — with an x.com Referer, as the site's own
 * player would — and streams it back same-origin, Range header included so
 * the player can seek. Only X's video host is allowed: this is not an open
 * proxy.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("u") ?? "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return Response.json({ error: "Bad url." }, { status: 400 });
  }
  if (target.protocol !== "https:" || target.hostname !== "video.twimg.com") {
    return Response.json({ error: "Only video.twimg.com is proxied." }, { status: 400 });
  }

  const range = req.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: {
        "User-Agent": UA,
        Referer: "https://x.com/",
        Accept: "*/*",
        ...(range ? { Range: range } : {}),
      },
    });
  } catch {
    return Response.json({ error: "Could not reach the video CDN." }, { status: 502 });
  }
  if (!upstream.ok) {
    return Response.json({ error: `Upstream said ${upstream.status}.` }, { status: 502 });
  }

  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  // A twimg url is one immutable file; the browser can keep it for the session.
  headers.set("cache-control", "private, max-age=86400");
  return new Response(upstream.body, { status: upstream.status, headers });
}
