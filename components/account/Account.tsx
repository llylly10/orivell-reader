"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Popover, barBtn } from "@/components/ui/Popover";
import { useT } from "@/lib/lang-context";
import { useViewer } from "@/lib/viewer";

/** Square-crops the pick to 128px jpeg — small enough to live in the users row. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const size = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, (bmp.width - size) / 2, (bmp.height - size) / 2, size, size, 0, 0, 128, 128);
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** Signed out: a quiet "Sign in". Signed in: the avatar, opening the reader's
 *  account card — photo, name, email, change the picture, sign out. */
export function Account() {
  const t = useT();
  const { loaded, id, name, email, avatar, setViewer } = useViewer();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loaded) return null;
  if (!id)
    return (
      <Link href="/sign-in" className={`${barBtn} !px-3 whitespace-nowrap`}>
        {t("topbar.signIn")}
      </Link>
    );

  const initial = (name || email || "?").trim().charAt(0).toUpperCase();
  const face = avatar ? (
    <img src={avatar} alt="" className="size-7 rounded-full object-cover" />
  ) : (
    <span className="grid size-7 place-items-center rounded-full bg-ink text-[13px] font-medium text-bg">{initial}</span>
  );

  const pick = () => fileRef.current?.click();
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await shrink(file);
      const res = await fetch("/api/account/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const j = await res.json();
      if (!res.ok) setError(j.error ?? "Something went wrong.");
      else setViewer({ avatar: j.avatar ?? null });
    } catch {
      setError(t("account.badImage"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      label={t("topbar.account")}
      tip={name ?? t("topbar.account")}
      trigger={face}
      triggerClass="!p-0 overflow-hidden"
      width={280}
    >
      {(close) => (
        <div className="grid gap-4">
          <div className="flex items-center gap-3">
            {avatar ? (
              <img src={avatar} alt="" className="size-12 rounded-full object-cover" />
            ) : (
              <span className="grid size-12 place-items-center rounded-full bg-ink text-[20px] font-medium text-bg">{initial}</span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[14.5px] font-medium text-ink">{name || email.split("@")[0]}</p>
              <p className="truncate text-[12.5px] text-ink-3">{email}</p>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          {error && <p className="text-[12.5px] text-[color:var(--rubric)]">{error}</p>}
          <button
            type="button"
            onClick={pick}
            disabled={busy}
            className="inline-flex h-9 items-center justify-center rounded-full border border-rule-strong bg-bg px-4 text-[13.5px] font-medium text-ink transition-colors hover:bg-sunk disabled:opacity-60"
          >
            {busy ? t("auth.working") : t("account.changeAvatar")}
          </button>
          <button
            type="button"
            onClick={async () => {
              close();
              await fetch("/api/auth/out", { method: "POST" });
              location.href = "/";
            }}
            className="inline-flex h-9 items-center justify-center rounded-full bg-ink px-4 text-[13.5px] font-medium text-bg transition-colors hover:bg-ink-2"
          >
            {t("topbar.signOut")}
          </button>
        </div>
      )}
    </Popover>
  );
}
