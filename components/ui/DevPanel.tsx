"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronUp, Gauge, Languages, Route as RouteIcon, X } from "lucide-react";
import { useLang, useT } from "@/lib/lang-context";
import { useStore } from "@/lib/store";

/**
 * A development panel, in the reader's language.
 *
 * This replaces Next.js's own indicator (`devIndicators: false` in
 * next.config.ts turns that off). The framework's badge is a prebuilt bundle
 * in node_modules: it renders in a shadow root, its strings are hardcoded
 * English, and reinstalling dependencies would wipe any edit to it. This one
 * is ours, so it reads the same language dictionary as the rest of the app.
 *
 * It shows only in development. The word for that is the environment check
 * below rather than a prop, so nothing has to remember to pass it.
 */

/** How fast the page came up, measured once per navigation. */
type Perf = { ms: number; at: string };

function usePerf() {
  const [perf, setPerf] = useState<Perf | null>(null);
  useEffect(() => {
    // After paint, so the number is the reader's wait and not ours.
    let raf = requestAnimationFrame(() =>
      setTimeout(() => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        if (!nav) return;
        const ms = Math.round(performance.now());
        const at = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        setPerf({ ms, at });
      }, 120)
    );
    return () => cancelAnimationFrame(raf);
  });
  return perf;
}

/** Whether the route is being rendered per request or ahead of time. */
function useRenderMode() {
  const pathname = usePathname();
  const [mode, setMode] = useState<"dynamic" | "static" | null>(null);
  useEffect(() => {
    // Next leaves a comment on the server-rendered body when a route opted out
    // of prerendering. It is the only signal available from the client.
    const html = document.documentElement;
    setMode(html.dataset.nextDynamic === "true" ? "dynamic" : "static");
  }, [pathname]);
  return mode;
}

export function DevPanel() {
  const t = useT();
  const { lang, setLang } = useLang();
  const pathname = usePathname();
  const perf = usePerf();
  const mode = useRenderMode();

  const library = useStore((s) => s.library);
  const progress = useStore((s) => s.progress);
  const marks = useStore((s) => s.highlights);

  // Reading progress and highlights live beside the library, keyed by id, not
  // on the item itself: a text can be shelved before it is ever opened.
  const reading = library.filter((x) => {
    const p = progress[x.id]?.pct ?? 0;
    return p > 0 && p < 1;
  }).length;
  const highlights = Object.values(marks).reduce((n, list) => n + (list?.length ?? 0), 0);

  const [open, setOpen] = useState(false);

  // Alt+D toggles it, so it stays reachable without moving the mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (process.env.NODE_ENV === "production") return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-tip={t("dev.open")}
        data-tip-kbd="⌥D"
        aria-label={t("dev.open")}
        className="dp-badge"
      >
        <Gauge size={15} />
      </button>
    );
  }

  return (
    <div className="dp" role="complementary" aria-label={t("dev.title")}>
      <header className="dp-head">
        <span className="dp-title">{t("dev.title")}</span>
        <span className="dp-actions">
          <button type="button" onClick={() => setLang(lang === "zh" ? "en" : "zh")} data-tip={t("dev.switchLang")} aria-label={t("dev.switchLang")} className="dp-btn">
            <Languages size={13} />
            <span className="dp-btn-text">{lang === "zh" ? "中文" : "English"}</span>
          </button>
          <button type="button" onClick={() => setOpen(false)} aria-label={t("dev.hide")} data-tip={t("dev.hide")} data-tip-kbd="⌥D" className="dp-btn is-icon">
            <X size={13} />
          </button>
        </span>
      </header>

      <dl className="dp-rows">
        <Row label={t("dev.route")} icon={<RouteIcon size={12} />}>
          <code className="dp-code">{pathname ?? "/"}</code>
        </Row>
        <Row label={t("dev.render")}>
          <span className={`dp-tag${mode === "dynamic" ? " is-dynamic" : ""}`}>{mode === "dynamic" ? t("dev.dynamic") : t("dev.static")}</span>
        </Row>
        <Row label={t("dev.bundler")}>
          <span className="dp-tag">Turbopack</span>
        </Row>
        <Row label={t("dev.renderedAt")}>
          <span className="dp-num tabular-nums">{perf ? `${perf.at}` : "—"}</span>
        </Row>
        <Row label={t("dev.library")}>
          <span className="dp-num tabular-nums">
            {t("dev.books", { n: library.length })}
            {reading > 0 && ` · ${t("dev.reading", { n: reading })}`}
            {highlights > 0 && ` · ${t("dev.highlights", { n: highlights })}`}
          </span>
        </Row>
      </dl>

      <footer className="dp-foot">
        <button type="button" onClick={() => setOpen(false)} className="dp-foot-btn">
          <ChevronUp size={12} /> {t("dev.collapse")}
        </button>
      </footer>
    </div>
  );
}

function Row({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <dt className="dp-label">
        {icon}
        {label}
      </dt>
      <dd className="dp-value">{children}</dd>
    </>
  );
}