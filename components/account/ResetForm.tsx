"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/lang-context";

/**
 * The half of "forgot password" that comes after the email: a new password,
 * sent with the single-use token from the reset link.
 */
export function ResetForm({ token }: { token: string }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const j = await res.json();
      if (!res.ok) return setError(j.error ?? "Something went wrong.");
      setDone(true);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  if (!token)
    return (
      <div>
        <p className="text-[15px] leading-[1.7] text-ink">{t("auth.resetInvalid")}</p>
        <p className="mt-5 text-[13px] text-ink-3">
          <Link href="/forgot-password" className="text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
            {t("auth.forgot")}
          </Link>
        </p>
      </div>
    );

  if (done)
    return (
      <div>
        <p className="text-[15px] leading-[1.7] text-ink">{t("auth.resetDone")}</p>
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
        <label htmlFor="reset-password" className="mb-1.5 block text-[13px] text-ink-2">{t("auth.resetTitle")}</label>
        <input
          id="reset-password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
        />
        <p className="mt-1.5 text-[12.5px] text-ink-4">{t("auth.passwordHint")}</p>
      </div>
      {error && <p className="text-[13px] text-[color:var(--rubric)]">{error}</p>}
      <button
        type="submit"
        disabled={busy || password.length < 10}
        className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-full bg-ink text-[14.5px] font-medium text-bg transition-all hover:bg-ink-2 active:scale-[0.99] disabled:opacity-60"
      >
        {busy ? t("auth.working") : t("auth.resetBtn")}
      </button>
    </form>
  );
}
