"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/lang-context";

/**
 * "Forgot password": an email goes in, a single-use reset link goes out —
 * if, and only if, the account exists. The reply reads the same either way.
 */
export function ForgotForm() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await res.json();
      if (!res.ok) return setError(j.error ?? "Something went wrong.");
      setSent(true);
      setNotice(j.notice ?? null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  if (sent)
    return (
      <div>
        <p className="text-[15px] leading-[1.7] text-ink">{t("auth.resetSent")}</p>
        {notice && (
          <p className="mt-4 rounded-[10px] border border-rule bg-bg p-3.5 text-[13.5px] leading-[1.6] text-ink-2">{notice}</p>
        )}
        <p className="mt-5 text-[13px] text-ink-3">
          <Link href="/sign-in" className="text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
            {t("topbar.signIn")}
          </Link>
        </p>
      </div>
    );

  const field = "h-11 w-full rounded-[10px] border border-rule-strong bg-bg px-3 text-[15px] text-ink placeholder:text-ink-4 focus:border-ink-2 focus:outline-none";

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div>
        <label htmlFor="forgot-email" className="mb-1.5 block text-[13px] text-ink-2">{t("auth.email")}</label>
        <input id="forgot-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
      </div>
      {error && <p className="text-[13px] text-[color:var(--rubric)]">{error}</p>}
      <button
        type="submit"
        disabled={busy || !email}
        className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-full bg-ink text-[14.5px] font-medium text-bg transition-all hover:bg-ink-2 active:scale-[0.99] disabled:opacity-60"
      >
        {busy ? t("auth.working") : t("auth.sendLink")}
      </button>
      <p className="mt-3 text-[13px] text-ink-3">
        <Link href="/sign-in" className="text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
          {t("topbar.signIn")}
        </Link>
      </p>
    </form>
  );
}
