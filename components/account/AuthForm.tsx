"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/lang-context";

/**
 * Sign in or create an account: an email and a password, nothing else. The
 * form posts to /api/auth, which sets the session cookie and sends the reader
 * back to the shelf. It sits on the raised half of the AuthShell frame, so it
 * is fields and a button — no card around it.
 */
export function AuthForm({ mode = "in" }: { mode?: "in" | "up" }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, email, password, name: name || undefined }),
      });
      const j = await res.json();
      if (!res.ok) return setError(j.error ?? "Something went wrong.");
      location.href = j.returnTo ?? "/";
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const field = "h-11 w-full rounded-[10px] border border-rule-strong bg-bg px-3 text-[15px] text-ink placeholder:text-ink-4 focus:border-ink-2 focus:outline-none";
  const label = "mb-1.5 block text-[13px] text-ink-2";
  const enter = (delay: number) => ({ className: "rise", style: { animationDelay: `${delay}s` } });

  return (
    <form onSubmit={submit} className="grid gap-4">
      {mode === "up" && (
        <div {...enter(0.08)}>
          <label htmlFor="auth-name" className={label}>{t("auth.name")}</label>
          <input id="auth-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </div>
      )}
      <div {...enter(mode === "up" ? 0.16 : 0.08)}>
        <label htmlFor="auth-email" className={label}>{t("auth.email")}</label>
        <input id="auth-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
      </div>
      <div {...enter(mode === "up" ? 0.24 : 0.16)}>
        <label htmlFor="auth-password" className={label}>{t("auth.password")}</label>
        <input
          id="auth-password"
          type="password"
          required
          autoComplete={mode === "up" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={field}
        />
        {mode === "up" && <p className="mt-1.5 text-[12.5px] text-ink-4">{t("auth.passwordHint")}</p>}
      </div>
      {error && <p className="text-[13px] text-[color:var(--rubric)]">{error}</p>}
      <button
        type="submit"
        disabled={busy || !email || !password}
        {...enter(mode === "up" ? 0.32 : 0.24)}
        className="rise mt-2 inline-flex h-11 w-full items-center justify-center rounded-full bg-ink text-[14.5px] font-medium text-bg transition-all hover:bg-ink-2 active:scale-[0.99] disabled:opacity-60"
      >
        {busy ? t("auth.working") : t("auth.continue")}
      </button>
      <p {...enter(mode === "up" ? 0.4 : 0.32)} className="rise mt-3 text-[13px] text-ink-3">
        {mode === "up" ? t("auth.haveAccount") : t("auth.noAccount")}{" "}
        <Link href={mode === "up" ? "/sign-in" : "/sign-up"} className="text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
          {mode === "up" ? t("auth.signIn") : t("auth.signUp")}
        </Link>
        {mode === "in" && (
          <>
            {" · "}
            <Link href="/forgot-password" className="underline decoration-rule-strong underline-offset-4 hover:text-ink">
              {t("auth.forgot")}
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
