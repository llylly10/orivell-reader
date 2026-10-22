"use client";

import { useEffect, useState } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { useT } from "@/lib/lang-context";
import { useSyncState } from "@/lib/sync";

/**
 * A quiet note that the account sync has stopped working.
 *
 * The shelf itself is safe on this device — nothing is lost. What is behind
 * is the copy on the account, so this says so plainly and offers a way to try
 * again. It appears only when something has actually gone wrong, and goes
 * away by itself once the next sync succeeds.
 */
export function SyncNotice() {
  const t = useT();
  const state = useSyncState();
  const [gone, setGone] = useState(false);

  // A success clears the notice without needing a reload.
  useEffect(() => {
    if (state === "off") {
      setGone(true);
      return;
    }
    setGone(false);
  }, [state]);

  if (state !== "error" || gone) return null;

  return (
    <div
      role="status"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+16px)] left-1/2 z-[54] flex w-max max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2.5 rounded-[16px] bg-lens px-4 py-2 text-[13px] leading-snug text-lens-fg shadow-pop sm:rounded-full"
      style={{ animation: "rise 0.45s var(--ease-spring) both" }}
    >
      <CloudOff size={14} className="shrink-0 opacity-80" aria-hidden />
      <span>{t("sync.failed")}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-lens-hover px-2.5 py-1 text-[12.5px] font-medium transition-colors hover:brightness-110"
      >
        <RefreshCw size={12} aria-hidden />
        {t("sync.retry")}
      </button>
    </div>
  );
}
