"use client";

import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { Languages } from "lucide-react";
import { GlossWordmark } from "@/components/brand/Gloss";
import { LANGS } from "@/lib/i18n";
import { useLang } from "@/lib/lang-context";

/** A small language switch, so the sign-up screen speaks the reader's language too. */
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
            lang === l.key ? "bg-pill text-ink shadow-[0_1px_2px_rgb(0_0_0/0.1)]" : "text-ink-3 hover:text-ink"
          }`}
        >
          {l.native}
        </button>
      ))}
    </div>
  );
}

/**
 * The sign-up screen, laid out like the sign-in one: Clerk's form, with the
 * app's own header around it.
 */
export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link href="/" aria-label="Gloss, back to your library" className="rounded-md">
          <GlossWordmark />
        </Link>
        <div className="flex items-center gap-2 text-ink-3">
          <Languages size={14} aria-hidden />
          <LangSwitch />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-5 pb-16">
        <SignUp />
      </main>
    </div>
  );
}
