"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { LANG_KEY, resolveLang, translate, type Lang, type StringKey } from "./i18n";

/**
 * The reader's language, for the components below it.
 *
 * The language is deliberately kept beside the other settings rather than
 * inside `Settings`, because it is not a look: it changes what every string in
 * the app says, and it must be readable before React hydrates (see
 * `BOOT_SCRIPT`). So it lives in its own store with its own key.
 */

type LangState = {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** A string in the current language. `t("book.read", { n: 3 })` */
  t: (key: StringKey | string, vars?: Record<string, string | number>) => string;
};

const Ctx = createContext<LangState | null>(null);

/**
 * The same language on the server render and the first client render.
 *
 * The server has no localStorage, so it can only guess, and it always guesses
 * English. Rendering English on the server and the reader's real language on
 * the client is what React calls a hydration mismatch, so the first client
 * render has to agree: it starts on English too, then corrects itself in the
 * effect below. `mounted` is not used to blank the page, because a flash of
 * the wrong language is worse than a re-render.
 */
function initial(): Lang {
  return "en";
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);

  // The reader may have picked a language before this provider mounted.
  // The document's own `lang` is set here too, not only when the reader
  // changes it by hand: on a first visit the language comes from the browser,
  // and the document should say so for spellcheckers and screen readers.
  useEffect(() => {
    const l = resolveLang();
    setLangState(l);
    document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {}
    document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
  }, []);

  const t = useCallback((key: StringKey | string, vars?: Record<string, string | number>) => translate(key, lang, vars), [lang]);

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

/**
 * The reader's language and a `t` for it.
 *
 * Outside a `LangProvider` this still works: it falls back to English, so a
 * component rendered outside the tree (a test, a portal at the root) never
 * throws for want of a provider.
 */
export function useLang(): LangState {
  const ctx = useContext(Ctx);
  const fallbackT = useCallback((key: StringKey | string) => translate(key, "en"), []);
  if (ctx) return ctx;
  return { lang: "en", setLang: () => {}, t: fallbackT };
}

/** Just the translator, for the many components that only need strings. */
export const useT = () => useLang().t;