"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useViewer } from "@/lib/viewer";
import { Toast } from "@/components/reader/Overlays";
import { useT } from "@/lib/lang-context";
import { useStore } from "@/lib/store";

const KEY = "gloss:nudge";
const DAY = 86_400_000;

/** How many marks a signed-out reader has made: highlights, notes and questions, across every text. */
function marks(st: ReturnType<typeof useStore.getState>) {
  let n = 0;
  for (const l of Object.values(st.highlights)) n += l.length;
  for (const l of Object.values(st.glosses)) n += l.length;
  return n;
}

/**
 * A light suggestion to sign in, at the moment it means something: just after
 * a signed-out reader keeps their first highlight, note or question, and once
 * more after a handful, a few days later. Never more than twice.
 */
export function SignInNudge() {
  const t = useT();
  const { loaded, id } = useViewer();
  const hydrated = useStore((s) => s.hydrated);
  const count = useStore(marks);
  const prev = useRef<number | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!hydrated || !loaded) return;
    const before = prev.current;
    prev.current = count;
    // Only a mark made just now counts, not what was already there on load.
    if (id || before === null || count <= before) return;
    let seen = { n: 0, last: 0 };
    try {
      seen = { ...seen, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch {}
    const due = seen.n === 0 || (seen.n === 1 && count >= 5 && Date.now() - seen.last > 3 * DAY);
    if (!due) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ n: seen.n + 1, last: Date.now() }));
    } catch {}
    // A beat after the mark lands, so it reads as a follow-up rather than an interruption.
    setTimeout(() => setOpen(true), 900);
  }, [count, hydrated, loaded, id]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setOpen(false), 12_000);
    return () => clearTimeout(timer);
  }, [open]);

  if (!open || id) return null;
  return (
    <Toast onClose={() => setOpen(false)}>
      <span>{t("nb.localOnly")}</span>
      <Link href="/sign-in" onClick={() => setOpen(false)} className="font-medium underline decoration-lens-mute underline-offset-4">
        {t("topbar.signIn")}
      </Link>
    </Toast>
  );
}
