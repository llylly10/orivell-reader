"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { computeLayout, drawGraph, hitTest, type GraphEdge, type SimNode } from "@/components/graph/graph-engine";
import { readAiBase, readApiKey, readModelName } from "@/lib/ask";
import { useT } from "@/lib/lang-context";

type GraphData = {
  ok?: boolean;
  nodes: { id: string; k: "a" | "au" | "e"; t: string; s?: string; n?: number }[];
  edges: GraphEdge[];
  progress: { extracted: number; total: number };
};

const PLATFORM_COLORS: Record<string, string> = {
  xhs: "#ff2442",
  wb: "#e6162d",
  dy: "#161823",
  tieba: "#3388ff",
  bili: "#fb7299",
  ks: "#ff4906",
  zh: "#0084ff",
  x: "#4a463f",
};

const SHOW_DEFAULT = { quote: true, author: true, entity: true };

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
  const [extracting, setExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const load = useCallback(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then((j: GraphData) => setData(j.ok ? j : { ok: false, nodes: [], edges: [], progress: { extracted: 0, total: 0 } }))
      .catch(() => setData({ ok: false, nodes: [], edges: [], progress: { extracted: 0, total: 0 } }));
  }, []);

  useEffect(load, [load, sig]);

  // 布局：数据就绪后跑一轮力导向（带进度），收敛后静止
  useEffect(() => {
    if (!data?.ok || !data.nodes.length) return;
    setProgress(0);
    const id = requestAnimationFrame(() => {
      const simNodes: SimNode[] = data.nodes.map((n) => ({ ...n, x: 0, y: 0, vx: 0, vy: 0, deg: 0 }));
      const { adj, byId } = computeLayout(simNodes, data.edges, 220, (p) => setProgress(p));
      setLayout({ nodes: simNodes, byId, edges: data.edges, adj });
      setView({ scale: 0.42, ox: (wrapRef.current?.clientWidth ?? 1200) / 2 - (2400 * 0.42) / 2, oy: (wrapRef.current?.clientHeight ?? 800) / 2 - (1600 * 0.42) / 2 });
    });
    return () => cancelAnimationFrame(id);
  }, [data]);

  // 绘制
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !layout) return;
    canvas.width = wrap.clientWidth * devicePixelRatio;
    canvas.height = wrap.clientHeight * devicePixelRatio;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    drawGraph(ctx, layout.nodes, layout.byId, layout.edges, layout.adj, {
      width: wrap.clientWidth,
      height: wrap.clientHeight,
      scale: view.scale,
      ox: view.ox,
      oy: view.oy,
      hovered,
      selected,
      colors: PLATFORM_COLORS,
      show,
    });
  }, [layout, view, hovered, selected, show]);

  const toWorld = (cx: number, cy: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return { x: 0, y: 0 };
    const rect = wrap.getBoundingClientRect();
    return { x: (cx - rect.left - view.ox) / view.scale, y: (cy - rect.top - view.oy) / view.scale };
  };

  const onMove = (e: React.MouseEvent) => {
    if (!layout) return;
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      setView((v) => ({ ...v, ox: dragRef.current!.ox + dx, oy: dragRef.current!.oy + dy }));
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    setHovered(hitTest(layout.nodes, p.x, p.y, view.scale));
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
    setSelected(hitTest(layout.nodes, p.x, p.y, view.scale));
  };

  // 实体抽取：一批 20 篇，用浏览器里的三件套调读者自己的 AI 服务
  const extractBatch = async () => {
    if (!data?.ok || extracting) return;
    setExtracting(true);
    setExtractMsg(null);
    try {
      const doneSet = await fetch("/api/graph/entities").then((r) => r.json());
      void doneSet;
      // 服务端每次取「尚未抽取」的下 20 篇——循环直到 done >= total
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
      setSig((s) => s + 1); // 重新拉图谱，实体节点上场
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
    const a = layout.nodes.filter((n) => n.k === "a").length;
    const au = layout.nodes.filter((n) => n.k === "au").length;
    const e = layout.nodes.filter((n) => n.k === "e").length;
    return { a, au, e };
  }, [layout]);

  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${on ? "border-ink-3 bg-sunk text-ink" : "border-rule text-ink-3 hover:text-ink"}`}>
      {label}
    </button>
  );

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="flex items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-serif text-[17px] text-ink">Gloss</span>
          <span className="text-[13px] text-ink-3">{t("graph.title")}</span>
        </div>
        <Link href="/" className="flex items-center gap-1.5 rounded-full border border-rule px-3 py-1 text-[12.5px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink">
          <ArrowLeft size={13} /> {t("graph.back")}
        </Link>
      </header>
      <div className="mx-5 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
        {chip(show.quote, t("graph.quote"), () => setShow((s) => ({ ...s, quote: !s.quote })))}
        {chip(show.author, t("graph.author"), () => setShow((s) => ({ ...s, author: !s.author })))}
        {chip(show.entity, t("graph.entity"), () => setShow((s) => ({ ...s, entity: !s.entity })))}
        <span className="mx-1 h-4 w-px bg-rule" aria-hidden />
        <button
          type="button"
          onClick={extractBatch}
          disabled={extracting || !data?.ok}
          className="flex items-center gap-1.5 rounded-full border border-rule px-3 py-1 text-[12px] text-ink transition-colors hover:border-ink-3 hover:bg-[var(--bg-raised)] disabled:opacity-40"
        >
          <Sparkles size={12} /> {extracting ? t("graph.extracting") : t("graph.extract")}
        </button>
        {extractMsg && <span className="text-[12px] text-ink-3">{extractMsg}</span>}
        {data?.ok && counts && (
          <span className="ml-auto text-[12px] tabular-nums text-ink-3">
            {t("graph.counts", { a: String(counts.a), au: String(counts.au), e: String(counts.e) })}
          </span>
        )}
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1 cursor-grab active:cursor-grabbing" onMouseMove={onMove} onMouseDown={onDown} onMouseUp={onUp} onMouseLeave={onUp} onClick={onClick} onWheel={onWheel}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {progress > 0 && progress < 1 && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-rule bg-bg-raised px-4 py-3 text-[13px] text-ink-2 shadow-sm">
            {t("graph.layout")} {Math.round(progress * 100)}%
          </div>
        )}
        {signIn && (
          <div className="absolute inset-0 grid place-items-center">
            <p className="rounded-[12px] border border-rule bg-bg-raised px-5 py-4 text-[13.5px] text-ink-2">{t("graph.signIn")}</p>
          </div>
        )}
        {empty && !signIn && (
          <div className="absolute inset-0 grid place-items-center">
            <p className="rounded-[12px] border border-rule bg-bg-raised px-5 py-4 text-[13.5px] text-ink-2">{t("graph.empty")}</p>
          </div>
        )}
        {selected && (
          <aside className="absolute bottom-4 right-4 w-72 rounded-[12px] border border-rule bg-bg-raised p-3.5 shadow-sm">
            <p className="text-[13.5px] font-medium leading-snug text-ink">{selected.t || selected.id}</p>
            <p className="mt-1 text-[11.5px] text-ink-3">
              {selected.k === "au" ? t("graph.kindAuthor") : selected.k === "e" ? t("graph.kindEntity") : selected.s || "X"}
              {selected.k === "e" && selected.n ? ` · ×${selected.n}` : ""}
            </p>
            {selected.k === "a" && (
              <Link href={`/read/${encodeURIComponent(selected.id)}`} className="mt-2.5 block rounded-lg bg-ink px-3 py-1.5 text-center text-[12.5px] font-medium text-bg">
                {t("graph.open")}
              </Link>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
