"use client";

/**
 * 关系图谱画布：自定义力导向布局（网格化斥力 + 边弹簧 + 向心），布局收敛后
 * 静止成图；滚轮缩放、拖拽平移、节点悬停高亮、点击选中。颜色只放在数据上：
 * 节点按来源平台着色，边按类型区分，无装饰。
 */

export type GraphNode = { id: string; k: "a" | "au" | "e"; t: string; s?: string; n?: number };
export type GraphEdge = { s: string; t: string; k: "quote" | "author" | "entity" };

export type SimNode = {
  id: string;
  k: "a" | "au" | "e";
  t: string;
  s?: string;
  /** 实体节点：出现的文章数 */
  n?: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  deg: number;
};

export type PlatformColors = Record<string, string>;

const EDGE_STYLE: Record<GraphEdge["k"], { color: string; alpha: number }> = {
  quote: { color: "#b3543e", alpha: 0.55 },
  entity: { color: "#6b7f5e", alpha: 0.4 },
  author: { color: "#8a8474", alpha: 0.14 },
};

/** 网格化斥力：只和邻近格里的节点算斥力，2180 节点也能实时收敛 */
function repulsionTick(nodes: SimNode[], cell: number, strength: number) {
  const grid = new Map<string, number[]>();
  nodes.forEach((n, i) => {
    const k = `${Math.round(n.x / cell)}:${Math.round(n.y / cell)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const cx = Math.round(a.x / cell);
    const cy = Math.round(a.y / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const bucket = grid.get(`${gx}:${gy}`);
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > cell * cell * 9 || d2 === 0) continue;
          const f = strength / d2;
          const d = Math.sqrt(d2) || 1;
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }
    }
  }
}

/** 一次性布局：收敛后返回静止坐标（交互只做平移缩放和命中测试） */
export function computeLayout(nodes: SimNode[], edges: GraphEdge[], tick = 220, onProgress?: (p: number) => void) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const W = 2400;
  const H = 1600;
  // 初始：按节点类型分环摆好（各环内均匀取角），避免全从原点爆开
  const totals: Record<string, number> = { a: 0, au: 0, e: 0 };
  for (const n of nodes) totals[n.k]++;
  const ringOf: Record<string, number> = { a: 0, au: 1, e: 2 };
  const radiusOf: Record<string, number> = { a: 620, au: 380, e: 500 };
  const seen: Record<string, number> = { a: 0, au: 0, e: 0 };
  for (const n of nodes) {
    const angle = (seen[n.k] / Math.max(1, totals[n.k])) * Math.PI * 2 + ringOf[n.k] * 2.1;
    seen[n.k]++;
    const r = radiusOf[n.k];
    n.x = W / 2 + Math.cos(angle) * r + (Math.random() - 0.5) * 60;
    n.y = H / 2 + Math.sin(angle) * r + (Math.random() - 0.5) * 60;
  }
  const adj = new Map<string, { other: SimNode; k: GraphEdge["k"] }[]>();
  for (const e of edges) {
    const a = byId.get(e.s);
    const b = byId.get(e.t);
    if (!a || !b || a === b) continue;
    (adj.get(a.id) ?? adj.set(a.id, []).get(a.id)!).push({ other: b, k: e.k });
    (adj.get(b.id) ?? adj.set(b.id, []).get(b.id)!).push({ other: a, k: e.k });
    a.deg++;
    b.deg++;
  }
  for (let i = 0; i < tick; i++) {
    const cool = 1 - i / tick;
    repulsionTick(nodes, 90, 2600 * cool);
    for (const e of edges) {
      const a = byId.get(e.s);
      const b = byId.get(e.t);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - 90) / d) * 0.016 * (e.k === "author" ? 0.5 : 1);
      a.vx += dx * f;
      a.vy += dy * f;
      b.vx -= dx * f;
      b.vy -= dy * f;
    }
    for (const n of nodes) {
      n.vx += (W / 2 - n.x) * 0.0016;
      n.vy += (H / 2 - n.y) * 0.0016;
      n.vx *= 0.86;
      n.vy *= 0.86;
      n.x += Math.max(-24, Math.min(24, n.vx));
      n.y += Math.max(-24, Math.min(24, n.vy));
    }
    if (i % 20 === 0) onProgress?.(i / tick);
  }
  onProgress?.(1);
  return { adj, byId };
}

export const COMMUNITY_PALETTE = ["#7d9a6f", "#b3543e", "#5f7d9a", "#a9843f", "#8a6f9e", "#4f9a92", "#c07a3f", "#6f8a4f", "#9a5f7d", "#5a7050"];

export function drawGraph(
  ctx: CanvasRenderingContext2D,
  nodes: SimNode[],
  byId: Map<string, SimNode>,
  edges: GraphEdge[],
  adj: Map<string, { other: SimNode; k: GraphEdge["k"] }[]>,
  opts: {
    width: number;
    height: number;
    scale: number;
    ox: number;
    oy: number;
    hovered: SimNode | null;
    selected: SimNode | null;
    /** 文章节点：主题首色（与书架书脊同源）；作者/实体另有固定色 */
    colors: PlatformColors;
    show: { quote: boolean; author: boolean; entity: boolean };
    /** 社群模式：给节点按社区上色（Louvain 划分），覆盖主题色 */
    community?: Map<string, number>;
    /** 画布底色（标签底衬用它） */
    ground?: string;
  },
) {
  const { width, height, scale, ox, oy, ground = "#fcfaf6" } = opts;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);

  const visible = (k: GraphEdge["k"]) => opts.show[k];
  // 边：选中/悬停的邻边全画且加深，其余按类型淡画
  const focus = opts.hovered ?? opts.selected;
  const focusAdj = focus ? new Set((adj.get(focus.id) ?? []).map((x) => x.other.id)) : null;
  ctx.lineWidth = 1 / scale;
  for (const e of edges) {
    if (!visible(e.k)) continue;
    const a = byId.get(e.s);
    const b = byId.get(e.t);
    if (!a || !b) continue;
    const isFocus = focusAdj && (a.id === focus?.id || b.id === focus?.id);
    const style = EDGE_STYLE[e.k];
    ctx.globalAlpha = isFocus ? Math.min(1, style.alpha * 3) : focusAdj ? style.alpha * 0.5 : style.alpha;
    ctx.strokeStyle = style.color;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 节点：文章圆点用书架主题色，作者方点，实体空心圆；半径随度数
  for (const n of nodes) {
    const isFocus = !focusAdj || focusAdj.has(n.id) || n === focus;
    const r = n.k === "au" ? 5 : n.k === "e" ? 4 + Math.min(6, Math.sqrt(n.n ?? 1) * 1.6) : 2.6 + Math.min(4, n.deg * 0.5);
    ctx.globalAlpha = isFocus ? 1 : 0.28;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    if (n.k === "e") {
      ctx.strokeStyle = opts.community ? COMMUNITY_PALETTE[(opts.community.get(n.id) ?? 0) % COMMUNITY_PALETTE.length] : "#8a8474";
      ctx.lineWidth = 1.4;
      ctx.stroke();
    } else if (n.k === "au") {
      ctx.fillStyle = opts.community ? COMMUNITY_PALETTE[(opts.community.get(n.id) ?? 0) % COMMUNITY_PALETTE.length] : "#5a5347";
      ctx.fill();
    } else {
      ctx.fillStyle = opts.community
        ? COMMUNITY_PALETTE[(opts.community.get(n.id) ?? 0) % COMMUNITY_PALETTE.length]
        : opts.colors[n.s ?? "unsorted"] ?? "#7b776f";
      ctx.fill();
    }
    if (n === opts.hovered || n === opts.selected) {
      ctx.strokeStyle = "#1d1b18";
      ctx.lineWidth = 1.6 / scale;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // 标签：悬停/选中节点，和度数最高的枢纽
  ctx.textAlign = "center";
  for (const n of nodes) {
    const show = n === opts.hovered || n === opts.selected || (n.k !== "a" && n.deg >= 6) || (n.k === "a" && n.deg >= 9);
    if (!show) continue;
    const label = n.t.slice(0, 26);
    ctx.font = `${n.k === "a" ? 11 : 12.5}px sans-serif`;
    const w = ctx.measureText(label).width;
    ctx.fillStyle = ground;
    ctx.fillRect(n.x - w / 2 - 4, n.y - (n.k === "a" ? 16 : 22), w + 8, 15);
    ctx.fillStyle = "#1d1b18";
    ctx.fillText(label, n.x, n.y - (n.k === "a" ? 5 : -4));
  }
  ctx.restore();
}

export function hitTest(nodes: SimNode[], mx: number, my: number, scale: number): SimNode | null {
  let best: SimNode | null = null;
  let bestD = 14 / scale;
  for (const n of nodes) {
    const d = Math.hypot(n.x - mx, n.y - my);
    if (d < Math.max(bestD, 8)) {
      best = n;
      bestD = d;
    }
  }
  return best;
}
