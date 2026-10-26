"use client";

import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { validateKey, readModelName, saveModelName, readAiBase, saveAiBase, readImageModel, saveImageModel, readImageBase, saveImageBase, readImageKey, saveImageKey, readVisionModel, saveVisionModel, readVisionBase, saveVisionBase, readVisionKey, saveVisionKey } from "@/lib/ask";
import { BRAND } from "@/lib/brand";
import { useT } from "@/lib/lang-context";
import { Popover, barBtn } from "./Popover";

const STORAGE_KEY = "together:api-key";

/** Today's free use of the shared key, as the share still unspent (0 to 1). */
type Free = { left: number; signedIn: boolean };

/** Bring your own key. Stored in this browser only. Each model group can carry
    its own URL + key + model name; a group left blank falls back to the main set. */
export function KeyMenu() {
  const t = useT();
  const [key, setKey] = useState("");
  const [house, setHouse] = useState<boolean | null>(null);
  const [free, setFree] = useState<Free | null>(null);

  useEffect(() => {
    try {
      setKey(localStorage.getItem(STORAGE_KEY) ?? "");
    } catch {}
    fetch("/api/key")
      .then((r) => r.json())
      .then((j: { house?: boolean; free?: Free | null }) => {
        setHouse(Boolean(j.house));
        setFree(j.free ?? null);
      })
      .catch(() => setHouse(false));
    // Every answer on the shared key reports what is left.
    const onFree = (e: Event) => setFree((f) => (f ? { ...f, left: (e as CustomEvent<number>).detail } : f));
    window.addEventListener("gloss:free", onFree);
    return () => window.removeEventListener("gloss:free", onFree);
  }, []);

  const spent = house === false || free?.left === 0;
  const status = key ? t("key.title") : spent ? t("topbar.addKey") : free && free.left <= 0.25 ? t("key.lowFree") : null;

  return (
    <Popover
      label={t("key.title")}
      tip={key ? t("key.hint") : t("topbar.addKey")}
      width={330}
      triggerClass={barBtn}
      openOn="gloss:key"
      trigger={
        <>
          {key ? <span aria-hidden className="size-1.5 rounded-full bg-good" /> : <KeyRound size={15} aria-hidden />}
          {status && <span className="hidden sm:inline">{status}</span>}
        </>
      }
    >
      {(close) => <KeyPanel current={key} house={house} free={free} onSave={(v) => setKey(v)} close={close} />}
    </Popover>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] text-ink-3">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="mt-1 h-8 w-full rounded-lg border border-rule bg-bg px-2.5 text-[12.5px] text-ink outline-none focus-visible:outline-none placeholder:text-ink-4 focus:border-rule-strong"
      />
    </label>
  );
}

function KeyPanel({ current, house, free, onSave, close }: { current: string; house: boolean | null; free: Free | null; onSave: (v: string) => void; close: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState(current);
  const [model, setModel] = useState(readModelName());
  const [base, setBase] = useState(readAiBase());
  const [imgBase, setImgBase] = useState(readImageBase());
  const [imgKey, setImgKey] = useState(readImageKey());
  const [imgModel, setImgModel] = useState(readImageModel());
  const [visBase, setVisBase] = useState(readVisionBase());
  const [visKey, setVisKey] = useState(readVisionKey());
  const [visModel, setVisModel] = useState(readVisionModel());
  const [state, setState] = useState<"idle" | "checking" | "bad">("idle");

  const save = async () => {
    const v = draft.trim();
    if (!v) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      onSave("");
      saveModelName(model);
      saveAiBase(base);
      saveImageModel(imgModel);
      saveImageBase(imgBase);
      saveImageKey(imgKey);
      saveVisionModel(visModel);
      saveVisionBase(visBase);
      saveVisionKey(visKey);
      close();
      return;
    }
    setState("checking");
    const ok = await validateKey(v);
    if (!ok) {
      setState("bad");
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {}
    saveModelName(model);
    saveAiBase(base);
    saveImageModel(imgModel);
    saveImageBase(imgBase);
    saveImageKey(imgKey);
    saveVisionModel(visModel);
    saveVisionBase(visBase);
    saveVisionKey(visKey);
    onSave(v);
    close();
  };

  return (
    <div>
      <p className="text-[13.5px] font-medium text-ink">{t("key.title")}</p>
      <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
        {current ? t("key.hint") : house && free ? t("key.signInMore") : t("topbar.addKey")}
      </p>
      {!current && house && free && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between text-[11.5px] text-ink-3">
            <span>{t("key.freeToday")}</span>
            <span className="tabular-nums">{free.left > 0 ? `${Math.max(1, Math.round(free.left * 100))}% left` : "Used up"}</span>
          </div>
          <span className="mt-1.5 block h-[3px] overflow-hidden rounded-full bg-rule" aria-hidden>
            <span className="block h-full rounded-full bg-[var(--rubric)] transition-[width] duration-500" style={{ width: `${Math.round(free.left * 100)}%` }} />
          </span>
        </div>
      )}
      <p className="mt-3 text-[11.5px] font-medium text-ink-2">{t("key.mainGroup")}</p>
      <input
        type="password"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setState("idle");
        }}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder="tgp_v1_..."
        autoComplete="off"
        spellCheck={false}
        aria-label={t("key.title")}
        className="mt-1.5 h-9 w-full rounded-lg border border-rule bg-bg px-3 text-[13px] tracking-wide text-ink outline-none focus-visible:outline-none placeholder:text-ink-4 focus:border-rule-strong"
      />
      <Field label={t("key.modelLabel")} value={model} onChange={setModel} placeholder="qwen-plus / glm-4.7-flash…" />
      <div className="mt-2.5">
        <Field label={t("key.baseLabel")} value={base} onChange={setBase} placeholder="https://dashscope.aliyuncs.com/compatible…" />
      </div>
      {state === "bad" && <p className="mt-2 text-[12.5px] text-rubric-text">Together rejected that key. Check it and try again.</p>}

      <p className="mt-4 text-[11.5px] font-medium text-ink-2">{t("key.coverGroup")}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-4">{t("key.coverGroupHint")}</p>
      <div className="mt-1.5 space-y-2">
        <Field label={t("key.groupModel")} value={imgModel} onChange={setImgModel} placeholder="wanx2.1-t2i-turbo…" />
        <Field label={t("key.groupBase")} value={imgBase} onChange={setImgBase} placeholder={t("key.groupBaseFallback")} />
        <Field label={t("key.groupKey")} value={imgKey} onChange={setImgKey} placeholder={t("key.groupKeyFallback")} type="password" />
      </div>

      <p className="mt-4 text-[11.5px] font-medium text-ink-2">{t("key.visionGroup")}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-4">{t("key.visionGroupHint")}</p>
      <div className="mt-1.5 space-y-2">
        <Field label={t("key.groupModel")} value={visModel} onChange={setVisModel} placeholder="qwen-vl-ocr…" />
        <Field label={t("key.groupBase")} value={visBase} onChange={setVisBase} placeholder={t("key.groupBaseFallback")} />
        <Field label={t("key.groupKey")} value={visKey} onChange={setVisKey} placeholder={t("key.groupKeyFallback")} type="password" />
      </div>

      <p className="mt-3 text-[11px] leading-snug text-ink-4">Sent with your requests only. Stored in this browser, never on a server, never logged.</p>
      <div className="mt-3 flex items-center justify-between">
        <a href={BRAND.keysUrl} target="_blank" rel="noopener noreferrer" className="text-[12.5px] text-rubric-text underline decoration-rule-strong underline-offset-4">
          Get a key on Together
        </a>
        <div className="flex gap-1.5">
          {current && (
            <button
              type="button"
              onClick={() => {
                setDraft("");
                try {
                  localStorage.removeItem(STORAGE_KEY);
                } catch {}
                onSave("");
              }}
              className="h-8 rounded-lg px-3 text-[12.5px] font-medium text-ink-2 hover:bg-sunk"
            >
              {t("key.remove")}
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={state === "checking"}
            className="h-8 rounded-lg bg-ink px-3.5 text-[12.5px] font-medium text-bg disabled:opacity-60"
          >
            {state === "checking" ? t("common.loading") : t("key.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
