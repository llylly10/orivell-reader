"use client";

import { useT } from "@/lib/lang-context";

/** Before the first words arrive: three lines of the pen's wash, shimmering. */
export function Writing({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <div className={`writing ${className}`} role="status" aria-label={t("card.writing")}>
      <span style={{ width: "94%" }} />
      <span style={{ width: "82%" }} />
      <span style={{ width: "58%" }} />
    </div>
  );
}
