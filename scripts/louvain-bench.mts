/** Louvain 社群划分基准：真实边集上跑一遍，确认规模与耗时。 */
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);
const UID = "user_3L5fuAOEc9L4CDjPa8EQc83Yh49";
const arts = await sql`select article_id as id, data->>'author' as au from articles where user_id = ${UID} and deleted = false`;
const ids = new Set<string>(arts.map((r) => String(r.id)));
const edges: [string, string][] = [];
const seen = new Set<string>();
for (const r of arts) {
  const au = String(r.au ?? "").trim();
  if (au) { ids.add("au:" + au); edges.push([String(r.id), "au:" + au]); }
}
const quotes = await sql`
  select a.article_id as src, t.article_id as dst
  from articles a
  cross join lateral jsonb_array_elements(a.doc->'blocks') b
  join articles t on t.user_id = a.user_id and t.deleted = false and t.data->>'sourceUrl' = b->>'quoteUrl'
  where a.user_id = ${UID} and a.deleted = false`;
for (const r of quotes) {
  const k = r.src + "->" + r.dst;
  if (!seen.has(k)) { seen.add(k); edges.push([String(r.src), String(r.dst)]); }
}
const g = new Graph({ multi: false, type: "undirected" });
for (const n of ids) if (!g.hasNode(n)) g.addNode(n);
let skipped = 0;
for (const [s, t] of edges) { if (g.hasNode(s) && g.hasNode(t) && !g.hasEdge(s, t)) g.addEdge(s, t); else skipped++; }
const t0 = Date.now();
louvain.assign(g);
const communities = new Map<number, number>();
g.forEachNode((_, a) => { const c = Number(a.community) || 0; communities.set(c, (communities.get(c) ?? 0) + 1); });
console.log(`Louvain: ${g.order} 节点 / ${g.size} 边（跳过 ${skipped}）→ ${communities.size} 个社群，耗时 ${Date.now() - t0}ms`);
const top = [...communities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
console.log("最大社群:", top.map(([c, n]) => `#${c}×${n}`).join(" | "));
