"use client";

import type { ReactNode } from "react";

/** A small segmented control: one pill per option, one selected. */
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { key: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid rounded-[10px] bg-sunk p-[3px]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-[8px] text-[12.5px] font-medium transition-colors ${value === o.key ? "bg-pill text-ink shadow-[0_1px_2px_rgb(0_0_0/0.1)]" : "text-ink-3 hover:text-ink"}`}
        >
          {/* Optically centred: the pill's shadow weighs its bottom edge, so the label sits a pixel lower. */}
          <span className="inline-flex translate-y-px items-center gap-1.5">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
