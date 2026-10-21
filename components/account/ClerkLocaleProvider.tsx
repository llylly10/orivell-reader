"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { useLang } from "@/lib/lang-context";
import { CLERK_APPEARANCE, clerkLocalization } from "@/lib/clerk-ui";

/**
 * Clerk, wrapped so that it speaks the reader's language.
 *
 * Clerk's own strings — "Sign in", "Continue with Google", "Create an account" —
 * live in Clerk's components, not in ours, so the app's i18n dictionary cannot
 * reach them. Clerk does accept a localization resource, and the `zh-CN` one
 * that ships with Clerk is a translation of Clerk's own wording rather than
 * our guess at it.
 *
 * This has to be a client component: the language is a stored preference the
 * server cannot see, so the provider is mounted on the client and told the
 * language once it is known. `ClerkProvider` picks up a changed
 * `localization` and re-renders its children in the new language.
 */
export function ClerkLocaleProvider({ children }: { children: React.ReactNode }) {
  const { lang } = useLang();
  return (
    <ClerkProvider appearance={CLERK_APPEARANCE} localization={clerkLocalization(lang)}>
      {children}
    </ClerkProvider>
  );
}
