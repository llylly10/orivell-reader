"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GlossWordmark } from "@/components/brand/Gloss";
import { LANGS } from "@/lib/i18n";
import { useLang, useT } from "@/lib/lang-context";

/** A small language switch, so the sign-in screen speaks the reader's language too. */
function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div role="radiogroup" aria-label="Language" className="grid shrink-0 grid-cols-2 gap-[3px] rounded-[10px] bg-sunk p-[3px]">
      {LANGS.map((l) => (
        <button
          key={l.key}
          type="button"
          role="radio"
          aria-checked={lang === l.key}
          onClick={() => setLang(l.key)}
          className={`inline-flex h-7 items-center justify-center rounded-[8px] px-2.5 text-[12.5px] font-medium transition-colors ${
            lang === l.key ? "bg-pill text-ink shadow-[0_1px_2px_rgb(0_0_0/0.1)]" : "text-ink-2 hover:text-ink"
          }`}
        >
          {l.native}
        </button>
      ))}
    </div>
  );
}

const SAMPLES = [1, 2, 3] as const;

/**
 * The product's own moment, staged as a real piece of the reader: a passage
 * from the shelf wearing the highlight, and the question it asked, answered in
 * the margin beside it. The passages change slowly; with reduced motion the
 * first one simply stays.
 */
function ReadingSample() {
  const t = useT();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setI((v) => (v + 1) % SAMPLES.length), 7000);
    return () => clearInterval(timer);
  }, []);

  return (
    <figure
      data-ui
      aria-label="Orivell reader sample"
      className="rise w-full max-w-[600px] rounded-[16px] border border-rule bg-bg-raised p-7 sm:p-8"
      style={{ animationDelay: "0.32s" }}
    >
      <div key={i} className="rise grid gap-4 sm:grid-cols-[1.35fr_1fr] sm:gap-6" style={{ animationDuration: "0.5s" }}>
        <blockquote className="font-serif text-[21px] leading-[1.8] text-ink [font-variation-settings:'opsz'_28]">
          <mark className="bg-[var(--hl)] px-[2px] text-ink">{t(`auth.sample.quote${SAMPLES[i]}` as const)}</mark>
        </blockquote>
        <figcaption className="sm:border-l sm:border-rule sm:pl-5">
          <p className="text-[14.5px] leading-[1.6] text-ink">{t(`auth.sample.gloss${SAMPLES[i]}` as const)}</p>
          <p className="mt-2 text-[12.5px] leading-[1.5] text-ink-2">—— {t(`auth.sample.source${SAMPLES[i]}` as const)}</p>
        </figcaption>
      </div>
      <div role="tablist" aria-label="Samples" className="mt-5 flex gap-2">
        {SAMPLES.map((s, idx) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={idx === i}
            aria-label={`Sample ${s}`}
            onClick={() => setI(idx)}
            className={`h-[5px] w-[5px] rounded-full transition-colors ${idx === i ? "bg-ink" : "bg-rule-strong hover:bg-ink-4"}`}
          />
        ))}
      </div>
    </figure>
  );
}

/**
 * The sign-in and sign-up pages share this frame: a title page on the left —
 * the wordmark, the headline, the product's own reading moment — and the form
 * on a quiet raised column to the right.
 */
export function AuthShell({ mode = "in", children }: { mode?: "in" | "up"; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.15fr_0.85fr]">
      <div className="flex flex-col justify-between gap-10 bg-bg px-6 py-8 sm:px-10 lg:px-16 lg:py-12">
        <div className="flex w-full items-center justify-between gap-4">
          <Link href="/" aria-label="Orivell, back to your library" className="rise w-fit rounded-md">
            <GlossWordmark />
          </Link>
          <div className="lg:hidden">
            <LangSwitch />
          </div>
        </div>
        <div>
          <h1
            className="rise font-serif text-[clamp(2.9rem,6vw,5rem)] font-[440] leading-[1.03] tracking-[-0.024em] [font-variation-settings:'opsz'_80] text-ink"
            style={{ animationDelay: "0.1s" }}
          >
            {mode === "up" ? t("auth.headlineUp") : t("auth.headline")}
          </h1>
          <p className="rise mt-6 max-w-[52ch] text-[18px] leading-[1.6] text-ink-2" style={{ animationDelay: "0.22s" }}>
            {t("auth.sub")}
          </p>
        </div>
        <div className="flex justify-center lg:justify-start">
          <ReadingSample />
        </div>
      </div>
      <div className="relative flex items-center bg-bg-raised px-6 py-14 sm:px-10 lg:px-16">
        <div className="absolute end-6 top-8 hidden sm:end-10 lg:end-16 lg:block">
          <LangSwitch />
        </div>
        <div className="mx-auto w-full max-w-[380px]">{children}</div>
      </div>
    </div>
  );
}
