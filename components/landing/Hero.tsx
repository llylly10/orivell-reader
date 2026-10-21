"use client";

import type { ReactNode } from "react";
import { useT } from "@/lib/lang-context";

/**
 * The landing's top: what Gloss does, in one line, and the place to start.
 * "any line" is marked the way a reader marks: the wash, then the pen under it.
 * The mark is a span either way, so the effect survives a translation.
 */
export function Hero({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <section className="mx-auto flex w-full max-w-[980px] flex-col items-center px-6 text-center sm:px-10">
      <h1 className="hero-title font-serif text-ink">
        <span className="block">
          {t("land.heroTitle1")} <span className="hero-mark">{t("land.heroMark")}</span>
        </span>
        <span className="block">{t("land.heroSub")}</span>
      </h1>
      {children}
    </section>
  );
}