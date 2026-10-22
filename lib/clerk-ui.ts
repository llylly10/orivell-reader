import { zhCN } from "@clerk/localizations";
import type { LocalizationResource } from "@clerk/shared/types";

/**
 * Clerk's sign-in, sign-up and account screens, in the page's own ink and paper.
 *
 * The variables point at the app's own CSS custom properties rather than at
 * fixed colours, so the screens follow the reader's theme — light or dark —
 * without a second set of values to keep in step.
 */
export const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: "var(--ink)",
    colorBackground: "var(--bg-raised)",
    colorForeground: "var(--ink)",
    colorMutedForeground: "var(--ink-3)",
    colorInput: "var(--bg)",
    colorInputForeground: "var(--ink)",
    colorBorder: "var(--rule-strong)",
    colorNeutral: "var(--ink)",
    fontFamily: "var(--font-sans)",
    borderRadius: "12px",
  },
  elements: {
    // The card sits on the page like a sheet of paper, not a floating dialog.
    cardBox: "w-full max-w-[400px] shadow-none border border-rule",
    rootBox: "w-full",
    card: "gap-4",
    headerTitle: "font-[var(--font-serif)] text-ink",
    headerSubtitle: "text-ink-3",
    formButtonPrimary: "bg-ink text-bg hover:bg-ink-2",
    socialButtonsBlockButton: "border border-rule-strong bg-bg hover:bg-bg-sunk",
    formFieldInput: "border border-rule-strong bg-bg",
    footerActionLink: "text-ink underline decoration-rule-strong underline-offset-4",
    identityPreviewText: "text-ink-2",
    alternativeFlow: "text-ink-3",
    // The sign-in and sign-up pop-ups sit in the middle of the screen rather
    // than hanging from the top of it. Clerk's backdrop aligns to the top and
    // gives the card a top margin, so both are undone here: the backdrop
    // centres its child, and the card's margin goes away.
    modalBackdrop: "!items-center",
    modalContent: "!m-0",
  },
} as const;

/** The app's name, as Clerk should say it. */
const NAME = "Gloss";

/**
 * Clerk's headings interpolate the instance's application name, which is set
 * in the Clerk Dashboard and reads "My Application" until it is changed there.
 * Since the app's own header already carries the wordmark, those headings are
 * rewritten to name the app directly — the reader should never see the
 * placeholder.
 */
const OVERRIDES = {
  en: {
    signIn: {
      start: {
        title: `Sign in to ${NAME}`,
        titleCombined: `Continue with ${NAME}`,
      },
    },
    signUp: {
      start: {
        subtitle: `Continue with ${NAME}`,
      },
    },
  },
  zh: {
    signIn: {
      start: {
        title: `登录 ${NAME}`,
        titleCombined: `继续使用 ${NAME}`,
      },
    },
    signUp: {
      start: {
        subtitle: `继续使用 ${NAME}`,
      },
    },
    // Clerk's own zh-CN resource leaves these input placeholders untranslated,
    // so the password field asks for a password in English. They are the only
    // strings a reader meets on the sign-in and sign-up screens, so they are
    // filled in here.
    formFieldInputPlaceholder__password: "请输入密码",
    formFieldInputPlaceholder__signUpPassword: "设置一个密码",
    formFieldInputPlaceholder__firstName: "请输入名字",
    formFieldInputPlaceholder__lastName: "请输入姓氏",
    formFieldInputPlaceholder__username: "请输入用户名",
    formFieldInputPlaceholder__phoneNumber: "请输入电话号码",
    formFieldInputPlaceholder__backupCode: "请输入备用代码",
  },
} as const;

/** Merge two localization resources, key by key, so nothing from the base is lost. */
function deepMerge<T extends Record<string, unknown>>(base: T, over: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    const b = out[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) && v && typeof v === "object" && !Array.isArray(v)
      ? deepMerge(b as Record<string, unknown>, v as Record<string, unknown>)
      : v;
  }
  return out as T;
}

/**
 * Clerk's own strings, in the reader's language.
 *
 * English is the source of truth in Clerk, so it needs no translation of its
 * own; only the app-name headings are laid over it. Chinese comes from
 * Clerk's own `zh-CN` resource, which keeps Clerk's wording intact instead of
 * a hand-rolled approximation of it.
 */
export function clerkLocalization(lang: "en" | "zh"): LocalizationResource {
  if (lang === "zh") {
    return deepMerge(zhCN as unknown as Record<string, unknown>, OVERRIDES.zh as unknown as Record<string, unknown>) as unknown as LocalizationResource;
  }
  return OVERRIDES.en as unknown as LocalizationResource;
}
