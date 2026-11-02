"use client";

import Link from "next/link";
import { useT } from "@/lib/lang-context";
import { useViewer } from "@/lib/viewer";

/**
 * The quiet "Sign in" shown to a signed-out reader, in whatever shape the
 * caller's bar needs. Renders nothing until the viewer is known, so the link
 * never flashes for someone who is already signed in — the same promise the
 * Clerk <Show> wrapper made, without Clerk.
 */
export function SignInLink({ className }: { className?: string }) {
  const t = useT();
  const { loaded, id } = useViewer();
  if (!loaded || id) return null;
  return (
    <Link href="/sign-in" className={className}>
      {t("topbar.signIn")}
    </Link>
  );
}
