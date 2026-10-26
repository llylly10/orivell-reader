/// <reference lib="webworker" />
/**
 * 图谱布局 Worker：力导向计算在后台线程跑，主线程全程可交互。
 * mode "topic" = 主题聚簇布局（星系图）；"plain" = 普通力导向。
 * 结果与主线程同步计算完全一致——只是不在前厅算。
 */
import { computeLayout, computeTopicLayout } from "./graph-engine";

type InNode = { id: string; k: "a" | "au" | "e"; t: string; s?: string; n?: number };

self.onmessage = (e: MessageEvent) => {
  const { mode, nodes, edges, tick } = e.data as {
    mode?: "plain" | "topic";
    nodes: InNode[];
    edges: { s: string; t: string; k: "quote" | "author" | "entity" }[];
    tick: number;
  };
  const sim = nodes.map((n) => ({ ...n, x: 0, y: 0, vx: 0, vy: 0, deg: 0 }));
  let last = 0;
  const onProgress = (p: number) => {
    const now = Date.now();
    if (now - last > 150) {
      last = now;
      (self as unknown as Worker).postMessage({ type: "progress", p });
    }
  };
  const run = mode === "topic" ? computeTopicLayout(sim, edges, tick, onProgress) : computeLayout(sim, edges, tick, onProgress);
  void run.adj;
  const positions = sim.map((n) => [n.id, Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10, n.deg]);
  (self as unknown as Worker).postMessage({ type: "done", positions });
};
