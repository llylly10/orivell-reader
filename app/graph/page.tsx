"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Focus, RotateCcw, Sparkles, X } from "lucide-react";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { buildAdjacency, computeLayout, drawGraph, hitTest, type GraphEdge, type SimNode } from "@/components/graph/graph-engine";
import { readAiBase, readApiKey, readModelName } from "@/lib/ask";
import { TOPICS } from "@/lib/library";
import { useT } from "@/lib/lang-context";

type GraphData = {
  ok?: boolean;
  nodes: { id: string; k: "a" | "au" | "e"; t: string; s?: string; n?: number }[];
  edges: GraphEdge[];
  progress: { extracted: number; total: number };
};

/** 文章节点着色 = 书架书脊的同一套主题油墨色（取每主题的第一色）。 */
const TOPIC_COLORS: Record<string, string> = Object.fromEntries(TOPICS.map((t) => [t.key, t.shades[0]]));
const TOPIC_NAMES: Record<string, string> = Object.fromEntries(TOPICS.map((t) => [t.key, t.name]));

const SHOW_DEFAULT = { quote: true, author: true, entity: true };
const LAYOUT_KEY = "gloss:graph-layout";

function nodesFingerprint(ids: string[]): string {
  let h = 5381;
  for (const id of [...ids].sort()) h = ((h * 33) ^ id.length) ^ id.charCodeAt(0);
  return String(h);
}

export default function GraphPage() {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [sig, setSig] = useState(0);
  const [progress, setProgress] = useState(0);
  const [layout, setLayout] = useState<{ nodes: SimNode[]; byId: Map<string, SimNode>; edges: GraphEdge[]; adj: Map<string, { other: SimNode; k: GraphEdge["k"] }[]> } | null>(null);
  const [view, setView] = useState({ scale: 0.5, ox: 0, oy: 0 });
  const [hovered, setHovered] = useState<SimNode | null>(null);
  const [selected, setSelected] = useState<SimNode | null>(null);
  const [show, setShow] = useState(SHOW_DEFAULT);
  const [kinds, setKinds] = useState({ a: true, au: true, e: true });
  const [minDeg, setMinDeg] = useState(0);
  const [query, setQuery] = useState("");
  const [egoId, setEgoId] = useState<string | null>(null);
  const [communityMode, setCommunityMode] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const fitView = useCallback((nodes: SimNode[]) => {
    const wrap = wrapRef.current;
    if (!nodes.length || !wrap) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.max(200, maxX - minX + 160);
    const h = Math.max(200, maxY - minY + 160);
    const scale = Math.min(2, Math.min(wrap.clientWidth / w, wrap.clientHeight / h));
    setView({ scale, ox: wrap.clientWidth / 2 - ((minX + maxX) / 2) * scale, oy: wrap.clientHeight / 2 - ((minY + maxY) / 2) * scale });
  }, []);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const load = useCallback(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then((j: GraphData) => setData(j.ok ? j : { ok: false, nodes: [], edges: [], progress: { extracted: 0, total: 0 } }))
      .catch(() => setData({ ok: false, nodes: [], edges: [], progress: { extracted: 0, total: 0 } }));
  }, []);

  useEffect(load, [load, sig]);

  useEffect(() => {
    if (!data?.ok || !data.nodes.length) return;
    const simNodes: SimNode[] = data.nodes.map((n) => ({ ...n, x: 0, y: 0, vx: 0, vy: 0, deg: 0 }));
    const fp = nodesFingerprint(data.nodes.map((n) => n.id));
    let saved: Record<string, [number, number]> | null = null;
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (raw) {
        const j = JSON.parse(raw) as { fp: string; pos: Record<string, [number, number]> };
        if (j.fp === fp) saved = j.pos;
      }
    } catch {}
    const settle = () => {
      const adj = buildAdjacency(simNodes, data.edges);
      setLayout({ nodes: simNodes, byId: new Map(simNodes.map((n) => [n.id, n])), edges: data.edges, adj });
      fitView(simNodes);
      setProgress(1);
      try {
        const pos: Record<string, [number, number]> = {};
        for (const n of simNodes) pos[n.id] = [Math.round(n.x), Math.round(n.y)];
        localStorage.setItem(LAYOUT_KEY, JSON.stringify({ fp, pos }));
      } catch {}
    };

    if (saved) {
      for (const n of simNodes) {
        const p = saved[n.id];
        if (p) {
          n.x = p[0];
          n.y = p[1];
        }
      }
      settle();
      return;
    }

    setProgress(0);
    // 布局在 Worker 后台线程算——主线程全程可交互；算完一次性回传坐标。
    // Worker 起不来就回退主线程同步计算，视觉结果相同。
    let cancelled = false;
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("../../components/graph/layout.worker.ts", import.meta.url));
      worker.onmessage = (e: MessageEvent) => {
        if (cancelled) return;
        const m = e.data as { type: string; p?: number; positions?: [string, number, number, number][] };
        if (m.type === "progress") setProgress(m.p ?? 0);
        else if (m.type === "done") {
          for (const [id, x, y, deg] of m.positions ?? []) {
            const n = simNodes.find((s) => s.id === id);
            if (n) {
              n.x = x;
              n.y = y;
              n.deg = deg;
            }
          }
          settle();
          worker?.terminate();
        }
      };
      worker.onerror = () => {
        worker?.terminate();
        if (!cancelled) {
          computeLayout(simNodes, data.edges, 220);
          settle();
        }
      };
      worker.postMessage({ nodes: data.nodes, edges: data.edges, tick: 220 });
    } catch {
      computeLayout(simNodes, data.edges, 220);
      settle();
    }
    return () => {
      cancelled = true;
      worker?.terminate();
    };
  }, [data]);

  const community = useMemo(() => {
    if (!layout || !communityMode) return undefined;
    const g = new Graph({ multi: false, type: "undirected" });
    for (const n of layout.nodes) g.addNode(n.id);
    for (const e of layout.edges) {
      if (!show[e.k]) continue;
      if (g.hasNode(e.s) && g.hasNode(e.t) && !g.hasEdge(e.s, e.t)) g.addEdge(e.s, e.t);
    }
    try {
      louvain.assign(g, { resolution: 1 });
      const m = new Map<string, number>();
      g.forEachNode((nid, attrs) => m.set(nid, Number(attrs.community) || 0));
      return m;
    } catch {
      return undefined;
    }
  }, [layout, communityMode, show]);

  const visible = useMemo(() => {
    if (!layout) return { nodes: [] as SimNode[], edges: [] as GraphEdge[] };
    const egoSet = egoId && layout.adj.has(egoId) ? new Set([egoId, ...layout.adj.get(egoId)!.map((x) => x.other.id)]) : null;
    const q = query.trim().toLowerCase();
    let nodes = layout.nodes.filter((n) => kinds[n.k] && n.deg >= minDeg && (!egoSet || egoSet.has(n.id)));
    if (q) nodes = nodes.filter((n) => n.t.toLowerCase().includes(q));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = layout.edges.filter((e) => show[e.k] && nodeIds.has(e.s) && nodeIds.has(e.t));
    return { nodes, edges };
  }, [layout, kinds, minDeg, egoId, query, show]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !layout) return;
    canvas.width = wrap.clientWidth * devicePixelRatio;
    canvas.height = wrap.clientHeight * devicePixelRatio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    drawGraph(ctx, visible.nodes, layout.byId, visible.edges, layout.adj, {
      width: wrap.clientWidth,
      height: wrap.clientHeight,
      scale: view.scale,
      ox: view.ox,
      oy: view.oy,
      hovered,
      selected,
      colors: TOPIC_COLORS,
      show,
      community,
      ground: "#fcfaf6",
    });
  }, [layout, visible, view, hovered, selected, show, community]);

  const toWorld = (cx: number, cy: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return { x: 0, y: 0 };
    const rect = wrap.getBoundingClientRect();
    return { x: (cx - rect.left - view.ox) / view.scale, y: (cy - rect.top - view.oy) / view.scale };
  };

  const onMove = (e: React.MouseEvent) => {
    if (!layout) return;
    const drag = dragRef.current;
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      setView((v) => ({ ...v, ox: drag.ox + dx, oy: drag.oy + dy }));
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    setHovered(hitTest(visible.nodes, p.x, p.y, view.scale));
  };
  const onDown = (e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy };
  };
  const onUp = () => {
    dragRef.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView((v) => {
      const scale = Math.max(0.12, Math.min(4, v.scale * factor));
      const k = scale / v.scale;
      return { scale, ox: mx - (mx - v.ox) * k, oy: my - (my - v.oy) * k };
    });
  };
  const onClick = (e: React.MouseEvent) => {
    if (!layout || dragRef.current) return;
    const p = toWorld(e.clientX, e.clientY);
    setSelected(hitTest(visible.nodes, p.x, p.y, view.scale));
  };

  const extractBatch = async () => {
    if (!data?.ok || extracting) return;
    setExtracting(true);
    setExtractMsg(null);
    try {
      for (let i = 0; i < 200; i++) {
        const r = await fetch("/api/graph/entities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseUrl: readAiBase() || undefined, apiKey: readApiKey() || undefined, modelName: readModelName() || undefined }),
          signal: AbortSignal.timeout(120_000),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) {
          setExtractMsg(j.error ?? t("graph.extractFailed"));
          return;
        }
        setExtractMsg(t("graph.extractProgress", { done: String(j.done), total: String(j.total) }));
        if (j.done >= j.total) break;
      }
      setExtractMsg(t("graph.extractDone"));
      try {
        localStorage.removeItem(LAYOUT_KEY);
      } catch {}
      setSig((s) => s + 1);
    } catch {
      setExtractMsg(t("graph.extractFailed"));
    } finally {
      setExtracting(false);
    }
  };

  const signIn = data?.ok === false;
  const empty = data?.ok && !data.nodes.length;
  const counts = useMemo(() => {
    if (!layout) return null;
    return {
      a: layout.nodes.filter((n) => n.k === "a").length,
      au: layout.nodes.filter((n) => n.k === "au").length,
      e: layout.nodes.filter((n) => n.k === "e").length,
    };
  }, [layout]);

  // 图例：主题计数（前 8 + 其余合并），来自当前图的文章节点
  const topicLegend = useMemo(() => {
    if (!layout) return [];
    const m = new Map<string, number>();
    for (const n of layout.nodes) if (n.k === "a") m.set(n.s ?? "unsorted", (m.get(n.s ?? "unsorted") ?? 0) + 1);
    const arr = [...m.entries()].sort((x, y) => y[1] - x[1]);
    if (arr.length <= 8) return arr;
    const head = arr.slice(0, 7);
    const rest = arr.slice(7).reduce((s, [, n]) => s + n, 0);
    head.push(["__rest", rest]);
    return head;
  }, [layout]);

  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${on ? "border-ink-3 bg-sunk text-ink" : "border-rule text-ink-3 hover:text-ink"}`}>
      {label}
    </button>
  );

  const legendDot = (color: string, filled = true) => (
    <span className="inline-block size-2.5 shrink-0 rounded-full" style={filled ? { background: color } : { border: `1.5px solid ${color}` }} aria-hidden />
  );

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="flex items-center justify-between gap-3 px-5 pb-2.5 pt-3.5">
        <div className="flex items-baseline gap-3">
          <span className="font-serif text-[17px] text-ink">Gloss</span>
          <h1 className="text-[13px] text-ink-3">{t("graph.title")}</h1>
        </div>
        <Link href="/" className="flex items-center gap-1.5 rounded-full border border-rule px-3 py-1 text-[12.5px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink">
          <ArrowLeft size={13} /> {t("graph.back")}
        </Link>
      </header>

      <div className="mx-5 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-rule pt-2.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("graph.searchPlaceholder")}
          aria-label={t("graph.searchPlaceholder")}
          className="h-8 w-40 rounded-full border border-rule bg-bg-raised px-3 text-[12.5px] text-ink outline-none placeholder:text-ink-4 focus:border-rule-strong"
        />
        <span className="mx-1 h-4 w-px bg-rule" aria-hidden />
        {chip(show.quote, t("graph.quote"), () => setShow((s) => ({ ...s, quote: !s.quote })))}
        {chip(show.author, t("graph.author"), () => setShow((s) => ({ ...s, author: !s.author })))}
        {chip(show.entity, t("graph.entity"), () => setShow((s) => ({ ...s, entity: !s.entity })))}
        <span className="mx-1 h-4 w-px bg-rule" aria-hidden />
        {chip(communityMode, t("graph.community"), () => setCommunityMode((v) => !v))}
        <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
          {t("graph.minDegree")}
          <input type="range" min={0} max={8} value={minDeg} onChange={(e) => setMinDeg(Number(e.target.value))} className="h-1 w-16 accent-[var(--rubric)]" aria-label={t("graph.minDegree")} />
          <span className="w-3 tabular-nums">{minDeg}</span>
        </label>
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={extractBatch}
            disabled={extracting || !data?.ok}
            className="flex items-center gap-1.5 rounded-full border border-rule px-3 py-1 text-[12px] text-ink transition-colors hover:border-ink-3 hover:bg-[var(--bg-raised)] disabled:opacity-40"
          >
            <Sparkles size={12} /> {extracting ? t("graph.extracting") : t("graph.extract")}
          </button>
          {data?.ok && counts && (
            <span className="text-[12px] tabular-nums text-ink-3">
              {t("graph.counts", { a: String(counts.a), au: String(counts.au), e: String(counts.e) })}
            </span>
          )}
        </span>
      </div>

      <div className="mx-5 mb-3 mt-2.5 flex min-h-0 flex-1 gap-3">
        <div ref={wrapRef} className="relative min-h-0 flex-1 cursor-grab overflow-hidden rounded-[14px] bg-bg-raised active:cursor-grabbing" onMouseMove={onMove} onMouseDown={onDown} onMouseUp={onUp} onMouseLeave={onUp} onClick={onClick} onWheel={onWheel}>
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          {progress > 0 && progress < 1 && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-rule bg-bg px-4 py-3 text-[13px] text-ink-2">
              {t("graph.layout")} {Math.round(progress * 100)}%
            </div>
          )}
          {signIn && (
            <div className="absolute inset-0 grid place-items-center">
              <p className="rounded-[12px] border border-rule bg-bg px-5 py-4 text-[13.5px] text-ink-2">{t("graph.signIn")}</p>
            </div>
          )}
          {empty && !signIn && (
            <div className="absolute inset-0 grid place-items-center">
              <p className="rounded-[12px] border border-rule bg-bg px-5 py-4 text-[13.5px] text-ink-2">{t("graph.empty")}</p>
            </div>
          )}
          {selected && (
            <aside className="absolute bottom-4 right-4 w-72 rounded-[12px] border border-rule bg-bg p-3.5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13.5px] font-medium leading-snug text-ink">{selected.t || selected.id}</p>
                <button type="button" onClick={() => setSelected(null)} aria-label={t("common.close")} className="text-ink-3 hover:text-ink">
                  <X size={14} />
                </button>
              </div>
              <p className="mt-1 text-[11.5px] text-ink-3">
                {selected.k === "au" ? t("graph.kindAuthor") : selected.k === "e" ? t("graph.kindEntity") : TOPIC_NAMES[selected.s ?? ""] || "X"}
                {selected.k === "e" && selected.n ? ` · ×${selected.n}` : ""} · {selected.deg} {t("graph.links")}
              </p>
              <div className="mt-2.5 flex gap-1.5">
                {selected.k === "a" && (
                  <Link href={`/read/${encodeURIComponent(selected.id)}`} className="flex-1 rounded-lg bg-ink px-3 py-1.5 text-center text-[12.5px] font-medium text-bg">
                    {t("graph.open")}
                  </Link>
                )}
                {egoId !== selected.id && (
                  <button type="button" onClick={() => setEgoId(selected.id)} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-rule px-3 py-1.5 text-[12.5px] text-ink-2 transition-colors hover:border-ink-3">
                    <Focus size={12} /> {t("graph.ego")}
                  </button>
                )}
              </div>
            </aside>
          )}
        </div>

        <aside className="hidden w-56 shrink-0 flex-col gap-4 overflow-y-auto rounded-[14px] bg-bg-raised p-4 lg:flex">
          <div>
            <p className="mb-2 text-[11.5px] font-medium text-ink-2">{t("graph.legendNodes")}</p>
            <ul className="space-y-1.5 text-[12px] text-ink-2">
              <li className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  {legendDot(TOPIC_COLORS.ai ?? "#5b4a9e")} {t("graph.legendArticles")}
                </span>
                <span className="tabular-nums text-ink-3">{counts?.a ?? 0}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  {legendDot("#5a5347")} {t("graph.kindAuthor")}
                </span>
                <span className="tabular-nums text-ink-3">{counts?.au ?? 0}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="flex items-center gap-2">{legendDot("#8a8474", false)} {t("graph.kindEntity")}</span>
                <span className="tabular-nums text-ink-3">{counts?.e ?? 0}</span>
              </li>
            </ul>
          </div>
          <div>
            <p className="mb-2 text-[11.5px] font-medium text-ink-2">{t("graph.legendTopics")}</p>
            <ul className="space-y-1 text-[12px] text-ink-2">
              {topicLegend.map(([k, n]) => (
                <li key={k} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 truncate">
                    {legendDot(k === "__rest" ? "#b5b0a5" : TOPIC_COLORS[k] ?? "#7b776f")}
                    <span className="truncate">{k === "__rest" ? t("graph.legendRest") : TOPIC_NAMES[k] ?? k}</span>
                  </span>
                  <span className="tabular-nums text-ink-3">{n}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-[11.5px] font-medium text-ink-2">{t("graph.legendEdges")}</p>
            <ul className="space-y-1 text-[12px] text-ink-2">
              <li>
                <button type="button" onClick={() => setShow((s) => ({ ...s, quote: !s.quote }))} className={`flex w-full items-center justify-between rounded-md px-1 py-0.5 transition-colors hover:bg-sunk ${show.quote ? "" : "opacity-40"}`}>
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-0 w-4 border-t-2 border-[#b3543e]" aria-hidden /> {t("graph.quote")}
                  </span>
                </button>
              </li>
              <li>
                <button type="button" onClick={() => setShow((s) => ({ ...s, author: !s.author }))} className={`flex w-full items-center justify-between rounded-md px-1 py-0.5 transition-colors hover:bg-sunk ${show.author ? "" : "opacity-40"}`}>
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-0 w-4 border-t-2 border-[#8a8474]" aria-hidden /> {t("graph.author")}
                  </span>
                </button>
              </li>
              <li>
                <button type="button" onClick={() => setShow((s) => ({ ...s, entity: !s.entity }))} className={`flex w-full items-center justify-between rounded-md px-1 py-0.5 transition-colors hover:bg-sunk ${show.entity ? "" : "opacity-40"}`}>
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-0 w-4 border-t-2 border-[#6b7f5e]" aria-hidden /> {t("graph.entity")}
                  </span>
                </button>
              </li>
            </ul>
          </div>
          {egoId && (
            <button type="button" onClick={() => setEgoId(null)} className="flex items-center justify-center gap-1 rounded-lg border border-rule px-3 py-1.5 text-[12px] text-ink-2 transition-colors hover:border-ink-3">
              <RotateCcw size={11} /> {t("graph.resetEgo")}
            </button>
          )}
          {extractMsg && <p className="text-[11px] leading-snug text-ink-3">{extractMsg}</p>}
        </aside>
      </div>
    </div>
  );
}
