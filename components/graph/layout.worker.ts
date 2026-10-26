/// <reference lib="webworker" />
/**
 * 图谱布局 Worker：力导向计算在后台线程跑，主线程全程可交互。
 * 收到 { nodes, edges, tick }，边算边报进度，算完回传全部坐标。
 * 结果与主线程同步计算完全一致——只是不在前厅算。
 */
import { computeLayout } from "./graph-engine";

type InNode = { id: string; k: "a" | "au" | "e"; t: string; s?: string; n?: number };

self.onmessage = (e: MessageEvent) => {
  const { nodes, edges, tick } = e.data as { nodes: InNode[]; edges: { s: string; t: string; k: "quote" | "author" | "entity" }[]; tick: number };
  const sim = nodes.map((n) => ({ ...n, x: 0, y: 0, vx: 0, vy: 0, deg: 0 }));
  let last = 0;
  const { adj } = computeLayout(sim, edges, tick, (p) => {
    const now = Date.now();
    if (now - last > 150) {
      last = now;
      (self as unknown as Worker).postMessage({ type: "progress", p });
    }
  });
  // 度数在 buildAdjacency 里累计过，回传给主线程复用
  const positions = sim.map((n) => [n.id, Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10, n.deg]);
  void adj;
  (self as unknown as Worker).postMessage({ type: "done", positions });
};
