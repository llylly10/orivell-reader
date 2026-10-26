/** 图谱布局基准：真实库数据跑一遍力导向，确认规模下收敛与耗时。 */
import { computeTopicLayout } from "../components/graph/graph-engine.ts";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const UID = "user_3L5fuAOEc9L4CDjPa8EQc83Yh49";
const arts = await sql`select article_id as id, data->>'title' as t, data->>'author' as au from articles where user_id = ${UID} and deleted = false`;
const nodes: Parameters<typeof computeLayout>[0] = arts.map((r) => ({ id: String(r.id), k: "a" as const, t: String(r.t ?? ""), s: "X", x: 0, y: 0, vx: 0, vy: 0, deg: 0 }));
const seen = new Set<string>();
for (const r of arts) {
  const au = String(r.au ?? "").trim();
  if (!au || seen.has(au)) continue;
  seen.add(au);
  nodes.push({ id: "au:" + au, k: "au", t: au, x: 0, y: 0, vx: 0, vy: 0, deg: 0 });
}
const quotes = await sql`
  select a.article_id as src, t.article_id as dst
  from articles a
  cross join lateral jsonb_array_elements(a.doc->'blocks') b
  join articles t on t.user_id = a.user_id and t.deleted = false and t.data->>'sourceUrl' = b->>'quoteUrl'
  where a.user_id = ${UID} and a.deleted = false`;
const edges: Parameters<typeof computeLayout>[1] = [];
for (const r of arts) {
  const au = String(r.au ?? "").trim();
  if (au) edges.push({ s: String(r.id), t: "au:" + au, k: "author" as const });
}
const eq = new Set<string>();
for (const r of quotes) {
  const k = `${r.src}->${r.dst}`;
  if (!eq.has(k)) { eq.add(k); edges.push({ s: String(r.src), t: String(r.dst), k: "quote" as const }); }
}
const t0 = Date.now();
const { adj } = computeTopicLayout(nodes, edges, 240);
console.log(`布局收敛: ${nodes.length} 节点 / ${edges.length} 边，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const hubs = nodes.filter((n) => n.k === "au").sort((a, b) => b.deg - a.deg).slice(0, 3).map((n) => `${n.t}(${n.deg})`);
console.log("作者枢纽:", hubs.join(" | "));
const xs = nodes.map((n) => n.x);
console.log("横向展开:", Math.round(Math.max(...xs) - Math.min(...xs)), "px");
