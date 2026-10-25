"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { AlignJustify, AlignLeft, Focus, Headphones, Languages, Map as MapIcon, Minus, Paintbrush, Pilcrow, Plus, RotateCcw } from "lucide-react";
import { MODELS, type ModelKey } from "@/lib/models";
import { applySettings, DEFAULT_SETTINGS, FACES, MARKERS, PENS, resolveTheme, THEMES, type Settings } from "@/lib/settings";
import { useStore } from "@/lib/store";
import { Popover, barBtn } from "./Popover";
import { setLibraryPrefs, useLibraryPrefs } from "@/lib/library-prefs";
import { LANGS, type Lang } from "@/lib/i18n";
import { useLang, useT } from "@/lib/lang-context";

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid rounded-[10px] bg-sunk p-[3px]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-[8px] text-[12.5px] font-medium transition-colors ${value === o.key ? "bg-pill text-ink shadow-[0_1px_2px_rgb(0_0_0/0.1)]" : "text-ink-3 hover:text-ink"}`}
        >
          {/* Optically centred: the pill's shadow weighs its bottom edge, so the label sits a pixel lower. */}
          <span className="inline-flex translate-y-px items-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
      <span className="text-[12.5px] text-ink-3">{label}</span>
      {children}
    </div>
  );
}

function Chip({ on, onChange, label, icon }: { on: boolean; onChange: (v: boolean) => void; label: string; icon: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`flex h-9 items-center justify-center gap-1.5 rounded-[10px] border text-[12.5px] font-medium transition-colors ${
        on ? "border-transparent bg-rubric-wash text-rubric-text" : "border-rule text-ink-3 hover:border-rule-strong hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/** A tiny page in each theme: its paper, its ink, and the pen's underline. */
function Swatch({ theme, on }: { theme: (typeof THEMES)[number]; on: boolean }) {
  const pen = (dark: boolean) => (dark ? "var(--pen-d)" : "var(--pen-l)");
  const face = "font-serif text-[15px] leading-none [font-variation-settings:'opsz'_36]";
  return (
    <span
      className={`relative flex h-[38px] w-full overflow-hidden rounded-[10px] shadow-[inset_0_0_0_1px_rgb(128_128_128/0.28)] outline-offset-2 transition-[outline-color] ${
        on ? "outline-2 outline-[var(--ink)] [outline-style:solid]" : "outline-2 outline-transparent [outline-style:solid] group-hover:outline-[var(--rule-strong)]"
      }`}
    >
      {theme.key === "auto" ? (
        <>
          <span className="flex flex-1 items-center justify-end" style={{ background: "#f6f3ec", color: "#1d1b18" }}>
            <span className={`${face} relative`}>
              A<span className="absolute -bottom-[5px] left-0 right-0 h-[2px] rounded-full" style={{ background: pen(false) }} />
            </span>
          </span>
          <span className="flex flex-1 items-center justify-start" style={{ background: "#151412", color: "#e9e3d6" }}>
            <span className={`${face} relative`}>
              a<span className="absolute -bottom-[5px] left-0 right-0 h-[2px] rounded-full" style={{ background: pen(true) }} />
            </span>
          </span>
        </>
      ) : (
        <span className="flex flex-1 items-center justify-center" style={{ background: theme.bg, color: theme.fg }}>
          <span className={`${face} relative`}>
            Aa
            <span className="absolute -bottom-[5px] left-0 right-0 h-[2px] rounded-full" style={{ background: pen(theme.dark) }} />
          </span>
        </span>
      )}
    </span>
  );
}

/** The library's one setting: a painted cover for every text. Off by default, since each one is an image model call. */
function PaintedCovers() {
  const { paintedCovers } = useLibraryPrefs();
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-3 border-t border-rule pt-3.5">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
          <Paintbrush size={13} /> {t("lib.paintedCovers")}
        </p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{t("lib.paintedCoversHint")}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={paintedCovers}
        aria-label={t("lib.paintedCovers")}
        onClick={() => setLibraryPrefs({ paintedCovers: !paintedCovers })}
        className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${paintedCovers ? "bg-[var(--rubric)]" : "bg-rule-strong"}`}
      >
        <span className={`absolute left-[3px] top-[3px] size-4 rounded-full bg-raised shadow transition-transform duration-200 ${paintedCovers ? "translate-x-4" : ""}`} />
      </button>
    </div>
  );
}

/** The language the whole interface is written in. First on the list: it changes every other label. */
function LanguageRow() {
  const { lang, setLang, t } = useLang();
  return (
    <div className="flex items-center justify-between gap-3 border-t border-rule pt-3.5">
      <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
        <Languages size={13} />
        <span>{t("settings.language")}</span>
      </div>
      <div role="radiogroup" aria-label={t("settings.language")} className="grid shrink-0 grid-cols-2 gap-[3px] rounded-[10px] bg-sunk p-[3px]">
        {LANGS.map((l) => (
          <button
            key={l.key}
            type="button"
            role="radio"
            aria-checked={lang === l.key}
            onClick={() => setLang(l.key as Lang)}
            className={`inline-flex h-7 items-center justify-center rounded-[8px] px-2.5 text-[12.5px] font-medium transition-colors ${
              lang === l.key ? "bg-pill text-ink shadow-[0_1px_2px_rgb(0_0_0/0.1)]" : "text-ink-3 hover:text-ink"
            }`}
          >
            {l.native}
          </button>
        ))}
      </div>
    </div>
  );
}

let swap: { finished: Promise<void> } | null = null;

/**
 * Type, colour and answers in one small panel. Every change applies to the
 * page underneath immediately, so the page itself is the preview.
 */
/** X 书签一键同步：拉取 → 入本地书库 → 推到书架，进度轮询显示。 */
function XSync() {
  const t = useT();
  const [st, setSt] = useState<{ running?: boolean; step?: string; lines?: string[]; done?: boolean; error?: string | null; never?: boolean } | null>(null);

  const refresh = () => {
    fetch("/api/x-sync")
      .then((r) => r.json())
      .then(setSt)
      .catch(() => {});
  };
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 3000);
    return () => clearInterval(iv);
  }, []);

  const running = Boolean(st?.running);
  const stepLabel = st?.step === "fetch" ? t("xs.stepFetch") : st?.step === "sqlite" ? t("xs.stepSqlite") : st?.step === "neon" ? t("xs.stepNeon") : "";
  const start = () => {
    fetch("/api/x-sync", { method: "POST" })
      .then(refresh)
      .catch(() => {});
  };

  return (
    <div className="rounded-[10px] border border-rule p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink">X 书签同步</span>
        <button type="button" onClick={start} disabled={running} className="rounded-full border border-rule px-3 py-1 text-[12px] text-ink transition-colors hover:border-ink-3 hover:bg-[var(--bg-raised)] disabled:opacity-40">
          {running ? t("xs.syncing") : t("xs.sync")}
        </button>
      </div>
      {st?.never && <p className="mt-1.5 text-[11px] text-ink-3">{t("xs.never")}</p>}
      {st?.error && <p className="mt-1.5 text-[12px] leading-snug text-[#c0392b]">{st.error}</p>}
      {running && <p className="mt-1.5 text-[12px] text-ink-2">{stepLabel}…</p>}
      {st?.done && <p className="mt-1.5 text-[12px] text-[#3ba776]">✓ {t("xs.done")}</p>}
      {st?.lines?.length ? (
        <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded-[8px] bg-[var(--bg-raised)] p-2 text-[11px] leading-snug text-ink-3">{st.lines.join("\n")}</pre>
      ) : null}
    </div>
  );
}

const CN_PLATFORMS: [string, string][] = [
  ["xhs", "小红书"],
  ["wb", "微博"],
  ["dy", "抖音"],
  ["tieba", "贴吧"],
  ["bili", "B站"],
  ["ks", "快手"],
  ["zh", "知乎"],
];

const CN_COLORS = ["#ff2442", "#e6162d", "#161823", "#3388ff", "#fb7299", "#ff4906", "#0084ff"];

/** 国内平台登录态：扫码二维码内嵌在这里（sidecar 截图流），也可改为弹出浏览器窗口。 */
function CnAccounts() {
  const t = useT();
  const [states, setStates] = useState<Record<string, boolean> | null>(null);
  const [sidecar, setSidecar] = useState(true);
  const [busy, setBusy] = useState<{ kind: string; until: number } | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  const [qr, setQr] = useState<{ platform: string; img: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => {
    fetch("/api/cn-status")
      .then((r) => r.json())
      .then((j) => {
        setStates(j.loginState ?? null);
        setSidecar(Boolean(j.sidecar));
        setBusy(j.busy ? { kind: j.busyKind ?? "", until: Date.now() + (j.busyRemaining ?? 0) * 1000 } : null);
      })
      .catch(() => setSidecar(false));
  };
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 4000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!qr) return;
    const iv = setInterval(() => {
      fetch(`/api/cn-qr?platform=${qr.platform}`)
        .then((r) => r.json())
        .then((j) => {
          if (j.done) {
            setQr(null);
            refresh();
          } else if (j.running === false) {
            // 会话已结束（超时/异常）且没登录成功：如实告知，停止轮询
            setErr(j.error ?? t("cn.sessionEnded"));
            setQr(null);
            clearInterval(iv);
          } else if (j.img) {
            setQr((q) => (q && q.platform === qr.platform ? { ...q, img: j.img as string } : q));
          }
        })
        .catch(() => {});
    }, 1200);
    return () => clearInterval(iv);
  }, [qr?.platform]);

  const startQr = async (p: string, window = false) => {
    setErr(null);
    try {
      const r = await fetch("/api/cn-qr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform: p, headless: !window }) });
      const j = await r.json();
      if (j.ok) setQr({ platform: p, img: null });
      else setErr(j.error?.includes("正在进行") ? t("cn.busy") : j.error ?? t("cn.failed"));
    } catch {
      setErr(t("cn.failed"));
    }
  };
  const startPopup = (p: string) => startQr(p, true);
  const stopQr = async (p: string) => {
    await fetch(`/api/cn-qr?platform=${p}`, { method: "DELETE" }).catch(() => {});
    setQr(null);
  };

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-snug text-ink-3">{t("cn.blurb")}</p>
      {!sidecar && <p className="rounded-[8px] bg-[var(--bg-raised)] px-2.5 py-1.5 text-[12px] text-ink-3">{t("cn.sidecarDown")}</p>}
      {busy && (
        <p className="rounded-[8px] bg-[var(--bg-raised)] px-2.5 py-1.5 text-[12px] text-ink-2">
          {t("cn.busyNow", {
            kind: t(busy.kind === "login" ? "cn.kindLogin" : busy.kind === "qr" ? "cn.kindQr" : "cn.kindCrawl"),
            n: String(Math.max(0, Math.ceil((busy.until - nowTick) / 1000))),
          })}
        </p>
      )}
      {qr && (
        <div className="overflow-hidden rounded-[12px] border border-rule bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-rule px-3 py-2">
            <span className="text-[12px] font-medium text-ink">
              {CN_PLATFORMS.find(([k]) => k === qr.platform)?.[1]} · {t("cn.waiting")}
            </span>
            <button type="button" onClick={() => stopQr(qr.platform)} className="text-[13px] leading-none text-ink-3 transition-colors hover:text-ink" aria-label={t("cn.cancel")}>
              ✕
            </button>
          </div>
          <div className="relative grid min-h-[210px] place-items-center bg-white">
            {qr.img ? (
              <img src={`data:image/jpeg;base64,${qr.img}`} alt="" className="w-full" />
            ) : (
              <span className="size-5 animate-spin rounded-full border-2 border-rule border-t-ink-3" />
            )}
          </div>
          <p className="px-3 py-2 text-[11px] leading-snug text-ink-3">{t("cn.qrTip")}</p>
        </div>
      )}
      <div className="space-y-0.5">
        {CN_PLATFORMS.map(([key, name], i) => {
          const on = states?.[key] === true;
          return (
            <div key={key} className="flex items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 transition-colors hover:bg-[var(--bg-raised)]">
              <span className="grid size-7 shrink-0 place-items-center rounded-[8px] text-[12px] font-semibold text-white" style={{ background: CN_COLORS[i] }}>
                {name[0]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] leading-tight text-ink">{name}</span>
                <span className={`text-[11px] leading-tight ${on ? "text-[#3ba776]" : "text-ink-4"}`}>{on ? `✓ ${t("cn.loggedIn")}` : t("cn.notLoggedIn")}</span>
              </span>
              {!on ? (
                <span className={`flex shrink-0 items-center gap-1.5 ${busy ? "pointer-events-none opacity-40" : ""}`}>
                  <button type="button" disabled={!!busy} onClick={() => startQr(key)} className="rounded-full border border-rule px-3 py-1 text-[12px] text-ink transition-colors hover:border-ink-3 hover:bg-[var(--bg-raised)]">
                    {t("cn.login")}
                  </button>
                  <button type="button" disabled={!!busy} onClick={() => startPopup(key)} data-tip={t("cn.popupLogin")} className="rounded-full px-1.5 py-1 text-[12px] text-ink-3 transition-colors hover:text-ink">
                    {t("cn.popupLogin")}
                  </button>
                </span>
              ) : (
                <span className="rounded-full bg-[#3ba776]/15 px-2.5 py-1 text-[11px] font-medium text-[#3ba776]">✓ {t("cn.loggedIn")}</span>
              )}
            </div>
          );
        })}
      </div>
      {err && <p className="text-[12px] leading-snug text-[#c0392b]">{err}</p>}
    </div>
  );
}

/** 扫描版 PDF 识别：引擎切换（云端视觉模型 / 本地 Indra OCR）。 */
function VisionOcr() {
  const t = useT();
  const [engine, setEngineState] = useState<"cloud" | "local">("cloud");
  const [model, setModel] = useState("");

  useEffect(() => {
    import("@/lib/ask").then(({ readVisionEngine, readVisionModel }) => {
      setEngineState(readVisionEngine());
      setModel(readVisionModel());
    });
  }, []);

  const setEngine = (e: "cloud" | "local") => {
    setEngineState(e);
    import("@/lib/ask").then(({ saveVisionEngine }) => saveVisionEngine(e));
  };
  const setModelName = (v: string) => {
    setModel(v);
    import("@/lib/ask").then(({ saveVisionModel }) => saveVisionModel(v));
  };

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-snug text-ink-3">{t("vision.blurb")}</p>
      <Row label={t("vision.engine")}>
        <Seg
          label={t("vision.engine")}
          value={engine}
          onChange={setEngine}
          options={[
            { key: "cloud", label: t("vision.cloud") },
            { key: "local", label: t("vision.local") },
          ]}
        />
      </Row>
      {engine === "cloud" && (
        <div>
          <p className="mt-1 text-[11.5px] text-ink-3">{t("vision.modelLabel")}</p>
          <input
            type="text"
            value={model}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="qwen-vl-ocr"
            autoComplete="off"
            spellCheck={false}
            aria-label={t("vision.modelLabel")}
            className="mt-1.5 h-9 w-full rounded-lg border border-rule bg-bg px-3 text-[13px] text-ink outline-none focus-visible:outline-none placeholder:text-ink-4 focus:border-rule-strong"
          />
          <p className="mt-2 text-[11px] leading-snug text-ink-4">{t("vision.cloudHint")}</p>
        </div>
      )}
      {engine === "local" && <p className="text-[11px] leading-snug text-ink-4">{t("vision.localHint")}</p>}
    </div>
  );
}

/** 重复项审查：列出候选组（含模糊变体），LLM 判定辅助，人工决定保留哪篇。 */
function Duplicates() {
  const t = useT();
  const [groups, setGroups] = useState<{ kind: string; items: { id: string; title: string; url: string; opening: string; addedAt: number }[] }[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [judging, setJudging] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<number, { verdict: string; reason: string }>>({});
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const scan = () => {
    setScanning(true);
    setErr(null);
    setVerdicts({});
    fetch("/api/duplicates")
      .then((r) => r.json())
      .then((j) => {
        setGroups(j.groups ?? []);
        const init: Record<string, string> = {};
        for (const g of j.groups ?? []) if (g.items?.length) init[g.items[0].id] = g.items[0].id;
        setKeep(init);
      })
      .catch(() => setErr(t("dup.failed")))
      .finally(() => setScanning(false));
  };

  /** LLM 判定：逐组问「同内容 / 同题变体 / 无关」，浏览器三件套出模型 */
  const judge = async () => {
    if (!groups?.length || judging) return;
    setJudging(true);
    setErr(null);
    try {
      const { readAiBase, readApiKey, readModelName } = await import("@/lib/ask");
      const r = await fetch("/api/duplicates/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groups: groups.map((g) => ({ kind: g.kind, items: g.items.map((i) => ({ id: i.id, title: i.title, opening: i.opening })) })),
          baseUrl: readAiBase() || undefined,
          apiKey: readApiKey() || undefined,
          modelName: readModelName() || undefined,
        }),
      });
      const j = await r.json();
      if (!j.ok) {
        setErr(j.error ?? t("dup.judgeFailed"));
        return;
      }
      const v: Record<number, { verdict: string; reason: string }> = {};
      (j.verdicts ?? []).forEach((x: { verdict: string; reason: string }, i: number) => (v[i] = x));
      setVerdicts(v);
    } catch {
      setErr(t("dup.judgeFailed"));
    } finally {
      setJudging(false);
    }
  };

  const merge = async (g: { items: { id: string }[] }) => {
    const keeper = keep[g.items[0].id] ?? g.items[0].id;
    const drop = g.items.map((i) => i.id).filter((id) => id !== keeper);
    setErr(null);
    try {
      const r = await fetch("/api/duplicates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keep: keeper, drop }) });
      const j = await r.json();
      if (!j.ok) setErr(j.error ?? t("dup.failed"));
      else setGroups((gs) => (gs ?? []).filter((x) => x !== g));
    } catch {
      setErr(t("dup.failed"));
    }
  };

  const verdictStyle = (v: string) =>
    v === "duplicate"
      ? "bg-[#c0392b]/10 text-[#c0392b]"
      : v === "variant"
        ? "bg-[#b07d2b]/10 text-[#b07d2b]"
        : v === "unrelated"
          ? "bg-[#3ba776]/10 text-[#3ba776]"
          : "bg-sunk text-ink-3";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-ink">{t("dup.title")}</span>
        <span className="flex items-center gap-1.5">
          {groups?.length ? (
            <button type="button" onClick={judge} disabled={judging} className="rounded-full border border-rule px-3 py-1 text-[12px] text-ink transition-colors hover:border-ink-3 hover:bg-[var(--bg-raised)] disabled:opacity-40">
              {judging ? t("dup.judging") : t("dup.judge")}
            </button>
          ) : null}
          <button type="button" onClick={scan} disabled={scanning} className="rounded-full border border-rule px-3 py-1 text-[12px] text-ink transition-colors hover:border-ink-3 hover:bg-[var(--bg-raised)] disabled:opacity-40">
            {scanning ? t("common.loading") : t("dup.scan")}
          </button>
        </span>
      </div>
      {err && <p className="text-[12px] text-[#c0392b]">{err}</p>}
      {groups && !groups.length && <p className="text-[12px] text-ink-3">{t("dup.none")}</p>}
      {groups?.map((g, gi) => (
        <div key={gi} className="space-y-1.5 rounded-[10px] border border-rule p-2.5">
          <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
            {t(g.kind === "url" ? "dup.kindUrl" : g.kind === "text" ? "dup.kindText" : g.kind === "fuzzy" ? "dup.kindFuzzy" : g.kind === "media" ? "dup.kindMedia" : "dup.kindTitle")}
            {verdicts[gi] && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-medium ${verdictStyle(verdicts[gi].verdict)}`}>
                {t(verdicts[gi].verdict === "duplicate" ? "dup.vDup" : verdicts[gi].verdict === "variant" ? "dup.vVar" : verdicts[gi].verdict === "unrelated" ? "dup.vUn" : "dup.vUnknown")}
              </span>
            )}
          </p>
          {verdicts[gi]?.reason && <p className="text-[11.5px] leading-snug text-ink-2">{verdicts[gi].reason}</p>}
          {g.items.map((it) => (
            <label key={it.id} className="flex items-start gap-2 text-[12px] leading-snug text-ink-2">
              <input type="radio" name={`dup-${gi}`} checked={(keep[g.items[0].id] ?? g.items[0].id) === it.id} onChange={() => setKeep((k) => ({ ...k, [g.items[0].id]: it.id }))} className="mt-1 accent-[var(--rubric)]" />
              <span className="min-w-0">
                <span className="block truncate">{it.title || it.url}</span>
                <span className="block truncate text-[11px] text-ink-4">{it.url}</span>
              </span>
            </label>
          ))}
          <button type="button" onClick={() => merge(g)} className="rounded-full border border-rule px-3 py-1 text-[12px] text-ink transition-colors hover:border-ink-3 hover:bg-[var(--bg-raised)]">
            {t("dup.merge")}
          </button>
        </div>
      ))}
    </div>
  );
}

export function SettingsMenu({ compact = false }: { compact?: boolean }) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const focusMode = useStore((s) => s.focusMode);
  const setUI = useStore((s) => s.setUI);
  const t = useT();
  const [tab, setTab] = useState<"look" | "text" | "answers" | "cn">("look");

  const set = (patch: Partial<Settings>) => {
    setSettings(patch);
    applySettings({ ...useStore.getState().settings });
  };
  const size = (v: number) => set({ size: Math.max(15, Math.min(28, v)) });
  const dark = resolveTheme(settings.theme) === "night" || resolveTheme(settings.theme) === "ink";

  // A new theme is poured in as a circle that grows out of the swatch you picked.
  const pickTheme = (key: Settings["theme"], e: MouseEvent<HTMLButtonElement>) => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void>; skipTransition: () => void } };
    const quiet = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || quiet || resolveTheme(key) === resolveTheme(settings.theme)) return set({ theme: key });
    // In percentages of the viewport, so the circle lands on the swatch at any zoom or pixel ratio.
    const r = e.currentTarget.getBoundingClientRect();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = r.left + r.width / 2;
    const y = r.top + 19;
    const at = `${((x / w) * 100).toFixed(2)}% ${((y / h) * 100).toFixed(2)}%`;
    const end = ((Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) / (Math.hypot(w, h) / Math.SQRT2)) * 100).toFixed(2);
    const root = document.documentElement;
    root.classList.add("theme-swap");
    // A new pick while one is pouring skips the old one; only the newest clears the flag.
    const vt = doc.startViewTransition(() => flushSync(() => set({ theme: key })));
    swap = vt;
    // While it pours, the browser sends every click to the root element instead of what is
    // under the pointer, so a quick second pick would be lost. Catch those clicks, end this
    // pour at once, and hand the click to the element underneath: a new pick pours in fresh.
    const passThrough = (ev: globalThis.MouseEvent) => {
      if (ev.target !== root) return;
      ev.stopPropagation();
      vt.skipTransition();
      const { clientX: x, clientY: y } = ev;
      vt.finished.finally(() => (document.elementFromPoint(x, y) as HTMLElement | null)?.click());
    };
    document.addEventListener("click", passThrough, true);
    vt.ready
      .then(() =>
        root.animate(
          { clipPath: [`circle(0% at ${at})`, `circle(${end}% at ${at})`] },
          { duration: 620, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" }
        )
      )
      .catch(() => {});
    vt.finished.finally(() => {
      document.removeEventListener("click", passThrough, true);
      if (swap === vt) {
        swap = null;
        root.classList.remove("theme-swap");
      }
    });
  };

  return (
    <Popover label={t("topbar.appearance")} tip={t("topbar.appearanceTip")} width={compact ? 316 : 348} triggerClass={barBtn} trigger={<span className="block translate-y-[0.5px] font-serif text-[18px] leading-none">Aa</span>}>
      {() => (
        <div>
          <div className="mb-4">
            <Seg
              label={t("settings.section")}
              value={tab}
              onChange={setTab}
              options={[
                { key: "look", label: t("settings.look") },
                { key: "text", label: t("settings.text") },
                { key: "answers", label: t("settings.answers") },
                { key: "cn", label: t("settings.platforms") },
              ]}
            />
          </div>

          {tab === "look" && (
            <div className="space-y-3.5">
              <div>
                <p className="mb-2.5 text-[12.5px] text-ink-3">{t("settings.theme")}</p>
                <div className="grid grid-cols-6 gap-2">
                  {THEMES.map((th) => (
                    <button
                      key={th.key}
                      type="button"
                      onClick={(e) => pickTheme(th.key, e)}
                      aria-pressed={settings.theme === th.key}
                      data-tip={th.key === "auto" ? t("settings.themeAutoTip") : undefined}
                      className="group flex flex-col items-center gap-1.5 rounded-[12px] focus-visible:outline-offset-4"
                    >
                      <Swatch theme={th} on={settings.theme === th.key} />
                      <span className={`text-[11px] leading-none transition-colors ${settings.theme === th.key ? "font-medium text-ink" : "text-ink-3 group-hover:text-ink-2"}`}>
                        {t(`theme.${th.key}`)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <Row label={t("settings.pen")}>
                <div className="flex items-center gap-2">
                  {PENS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => set({ pen: p.key })}
                      aria-pressed={settings.pen === p.key}
                      aria-label={t("settings.penTip", { name: t(`pen.${p.key}`) })}
                      data-tip={t(`pen.${p.key}`)}
                      className={`grid size-7 place-items-center rounded-full transition-[box-shadow,transform] active:scale-90 ${settings.pen === p.key ? "shadow-[0_0_0_2px_var(--bg-raised),0_0_0_3.5px_var(--ink-3)]" : ""}`}
                    >
                      <span className="size-5 rounded-full" style={{ background: dark ? p.dark : p.light }} />
                    </button>
                  ))}
                  <span className="ml-1 text-[12px] text-ink-3">{t(`pen.${PENS.find((p) => p.key === settings.pen)?.key}`)}</span>
                </div>
              </Row>

              {!compact && (
                <>
                  <Row label={t("settings.marker")}>
                    <div className="flex items-center gap-2">
                      {MARKERS.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          onClick={() => set({ marker: m.key })}
                          aria-pressed={settings.marker === m.key}
                          aria-label={t("settings.markerTip", { name: t(`marker.${m.key}`) })}
                          data-tip={t(`marker.${m.key}`)}
                          className={`grid size-7 place-items-center rounded-full transition-[box-shadow,transform] active:scale-90 ${settings.marker === m.key ? "shadow-[0_0_0_2px_var(--bg-raised),0_0_0_3.5px_var(--ink-3)]" : ""}`}
                        >
                          <span className="h-3 w-5 -rotate-12 rounded-[3px] opacity-80" style={{ background: m.color }} />
                        </button>
                      ))}
                      <span className="ml-1 text-[12px] text-ink-3">{t(`marker.${MARKERS.find((m) => m.key === settings.marker)?.key}`)}</span>
                    </div>
                  </Row>
                  <div className="grid grid-cols-2 gap-1.5 border-t border-rule pt-3.5">
                    <Chip label={t("settings.numbers")} icon={<Pilcrow size={14} />} on={settings.numbers} onChange={(v) => set({ numbers: v })} />
                    <Chip label={t("settings.map")} icon={<MapIcon size={14} />} on={settings.rail} onChange={(v) => set({ rail: v })} />
                    <Chip label={t("settings.focus")} icon={<Focus size={14} />} on={focusMode} onChange={(v) => setUI({ focusMode: v })} />
                    <Chip label={t("settings.listen")} icon={<Headphones size={14} />} on={settings.listen} onChange={(v) => set({ listen: v })} />
                  </div>
                </>
              )}
              <PaintedCovers />
              <LanguageRow />
            </div>
          )}

          {tab === "text" && (
            <div className="space-y-3.5">
              <div>
                <p className="mb-2.5 text-[12.5px] text-ink-3">{t("settings.typeface")}</p>
                <div className="grid grid-cols-4 gap-2">
                  {FACES.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => set({ face: f.key })}
                      aria-pressed={settings.face === f.key}
                      className={`group flex h-[62px] flex-col items-center justify-center gap-1 rounded-[12px] border transition-[border-color,background-color,transform] active:scale-[0.97] ${
                        settings.face === f.key ? "border-ink bg-bg" : "border-rule hover:border-rule-strong"
                      }`}
                    >
                      <span className="text-[22px] leading-none text-ink" style={{ fontFamily: f.css }}>
                        Ag
                      </span>
                      <span className={`text-[11px] leading-none ${settings.face === f.key ? "font-medium text-ink" : "text-ink-3"}`}>{t(`face.${f.key}`)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <Row label={t("settings.size")}>
                <div className="flex items-center gap-1.5">
                  <button type="button" aria-label={t("settings.smaller")} data-tip={t("settings.smallerTip")} onClick={() => size(settings.size - 1)} className="grid size-7 place-items-center rounded-lg text-ink-2 transition-transform hover:bg-sunk active:scale-90">
                    <Minus size={14} />
                  </button>
                  <input
                    type="range"
                    min={15}
                    max={28}
                    value={settings.size}
                    onChange={(e) => size(Number(e.target.value))}
                    aria-label={t("settings.sizeAria")}
                    className="h-1 min-w-0 flex-1 accent-[var(--rubric)]"
                  />
                  <button type="button" aria-label={t("settings.larger")} data-tip={t("settings.largerTip")} onClick={() => size(settings.size + 1)} className="grid size-7 place-items-center rounded-lg text-ink-2 transition-transform hover:bg-sunk active:scale-90">
                    <Plus size={14} />
                  </button>
                  <span className="w-6 text-right text-[12px] tabular-nums text-ink-3">{settings.size}</span>
                </div>
              </Row>
              <Row label={t("settings.spacing")}>
                <Seg
                  label={t("settings.lineSpacing")}
                  value={settings.leading}
                  onChange={(v) => set({ leading: v })}
                  options={[
                    { key: "tight", label: t("opt.snug") },
                    { key: "normal", label: t("opt.even") },
                    { key: "loose", label: t("opt.airy") },
                  ]}
                />
              </Row>
              <Row label={t("settings.width")}>
                <Seg
                  label={t("settings.columnWidth")}
                  value={settings.width}
                  onChange={(v) => set({ width: v })}
                  options={[
                    { key: "narrow", label: t("opt.narrow") },
                    { key: "normal", label: t("opt.even") },
                    { key: "wide", label: t("opt.wide") },
                  ]}
                />
              </Row>
              <Row label={t("settings.align")}>
                <Seg
                  label={t("settings.textAlign")}
                  value={settings.align}
                  onChange={(v) => set({ align: v })}
                  options={[
                    { key: "left", label: <><AlignLeft size={13} /> {t("opt.left")}</> },
                    { key: "justify", label: <><AlignJustify size={13} /> {t("opt.justified")}</> },
                  ]}
                />
              </Row>
              <Row label={t("settings.paragraphs")}>
                <Seg
                  label={t("settings.paragraphStyle")}
                  value={settings.paras}
                  onChange={(v) => set({ paras: v })}
                  options={[
                    { key: "spaced", label: t("opt.spaced") },
                    { key: "indented", label: t("opt.indented") },
                  ]}
                />
              </Row>
              {(["face", "size", "leading", "width", "align", "paras"] as const).some((k) => settings[k] !== DEFAULT_SETTINGS[k]) && (
                <button
                  type="button"
                  onClick={() =>
                    set({
                      face: DEFAULT_SETTINGS.face,
                      size: DEFAULT_SETTINGS.size,
                      leading: DEFAULT_SETTINGS.leading,
                      width: DEFAULT_SETTINGS.width,
                      align: DEFAULT_SETTINGS.align,
                      paras: DEFAULT_SETTINGS.paras,
                    })
                  }
                  className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-3 transition-colors hover:text-ink"
                >
                  <RotateCcw size={12} /> {t("settings.resetText")}
                </button>
              )}
            </div>
          )}

          {tab === "answers" && (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-[12.5px] text-ink-3">{t("settings.answerLength")}</p>
                <Seg
                  label={t("settings.answerLength")}
                  value={settings.length}
                  onChange={(v) => set({ length: v })}
                  options={[
                    { key: "short", label: t("opt.short") },
                    { key: "normal", label: t("opt.balanced") },
                    { key: "long", label: t("opt.detailed") },
                  ]}
                />
                <p className="mt-2 text-[12px] leading-snug text-ink-4">
                  {t(settings.length === "short" ? "length.shortBlurb" : settings.length === "long" ? "length.longBlurb" : "length.normalBlurb")}
                </p>
              </div>
            </div>
          )}
          {tab === "cn" && (
            <div className="space-y-4">
              <XSync />
              <CnAccounts />
              <VisionOcr />
              <Duplicates />
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}
