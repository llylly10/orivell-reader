"use client";

import { ViewTransition } from "react";
import { fmtMinutes, isCustomKey, lookOf, topicArtSrc, type Book, type ShelfDef } from "@/lib/library";
import { Cover, Glyph } from "./Book";
import { useT, useLang } from "@/lib/lang-context";
import { topicBlurb, topicName } from "@/lib/i18n";

const hours = (books: Book[]) => fmtMinutes(books.reduce((n, b) => n + b.minutes, 0));

function TopicArt({ t, name }: { t: ShelfDef; name?: string }) {
  if (isCustomKey(t.key))
    return (
      <span className="topic-custom-art" style={{ background: `linear-gradient(150deg, ${t.shades[1]}, ${t.shades[0]} 55%, ${t.shades[2]})` }} aria-hidden>
        <span>{(name ?? t.name).charAt(0).toUpperCase()}</span>
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={topicArtSrc(t.key)} alt="" decoding="async" draggable={false} />;
}

/** Every topic as a card: its drawing, its name, and its books standing in a row. */
export function TopicGrid({ topics, onPick }: { topics: { topic: ShelfDef; books: Book[] }[]; onPick: (t: ShelfDef) => void }) {
  const t = useT();
  const { lang } = useLang();
  return (
    <div className="topic-grid">
      {topics.map(({ topic: t2, books }, i) => (
        <button
          key={t2.key}
          type="button"
          className="topic-card"
          onClick={() => onPick(t2)}
          style={{ ["--c" as string]: t2.shades[0], ["--c-deep" as string]: t2.shades[2], ["--i" as string]: i }}
        >
          <ViewTransition name={`topic-art-${t2.key}`} share="lib-morph" default="none">
            <div className="topic-card-art">
              <TopicArt t={t2} />
            </div>
          </ViewTransition>
          <div className="relative flex items-end justify-between gap-4 px-5 pb-1 pt-4">
            <div className="min-w-0">
              <ViewTransition name={`topic-name-${t2.key}`} share="lib-morph" default="none">
                <h3 className="w-fit font-serif text-[27px] leading-[1.05] tracking-[-0.015em] text-ink">
                  <Glyph k={t2.key} size={30} className="mr-2 -mt-1" label={t2.name} />
                  {topicName(t2.key, t2.name, lang)}
                  {t2.custom && <span className="ml-2 align-middle text-[11px] font-sans font-medium text-ink-3">{t("book.yourShelf")}</span>}
                </h3>
              </ViewTransition>
              <p className="mt-1.5 text-[13px] text-ink-3">
                {t("topics.pieces", { n: books.length })} · {hours(books)}
              </p>
            </div>
          </div>
          <div className="mini-shelf" aria-hidden>
            {books.slice(0, 14).map((b, j) => {
              const l = lookOf(b);
              return (
                <ViewTransition key={b.id} name={`book-${b.id}`} share="lib-morph" default="none">
                  <span className="mini-spine" style={{ width: Math.round(l.w * 0.36), height: Math.round(l.h * 0.27), background: l.color, ["--j" as string]: j }} />
                </ViewTransition>
              );
            })}
          </div>
        </button>
      ))}
    </div>
  );
}

/** One topic, its books face-out, like the table at the front of a bookshop. */
export function TopicPage({ topic: t2, books, tools, onOpen }: { topic: ShelfDef; books: Book[]; tools?: React.ReactNode; onOpen: (b: Book, el: HTMLElement) => void }) {
  const t = useT();
  const { lang } = useLang();
  const reading = books.filter((b) => b.pct > 0 && b.pct < 1).length;
  return (
    <div style={{ ["--c" as string]: t2.shades[0] }}>
      <header className="topic-head">
        <ViewTransition name={`topic-art-${t2.key}`} share="lib-morph" default="none">
          <div className="topic-head-art">
            <TopicArt t={t2} />
          </div>
        </ViewTransition>
        <div className="relative max-w-[640px]">
          <ViewTransition name={`topic-name-${t2.key}`} share="lib-morph" default="none">
            <h2 className="w-fit font-serif text-[clamp(40px,6vw,64px)] leading-[0.98] tracking-[-0.025em] text-ink">
              <Glyph k={t2.key} size={64} className="mr-3 !align-[-0.12em] max-sm:!size-[44px]" label={t2.name} />
              {topicName(t2.key, t2.name, lang)}
            </h2>
          </ViewTransition>
          <p className="mt-4 text-pretty font-serif text-[18px] leading-[1.5] text-ink-2">{topicBlurb(t2.key, t2.blurb, lang)}</p>
          <p className="mt-3 text-[13px] text-ink-3">
            {t("topics.pieces", { n: books.length })} · {t("topics.readingTime", { n: hours(books) })}
            {reading > 0 && ` · ${t("topics.inProgress", { n: reading })}`}
          </p>
        </div>
      </header>

      {tools}

      <ul className="face-out">
        {books.map((b, i) => (
          <li key={b.id} style={{ ["--i" as string]: i }}>
            <button type="button" className="face-btn" aria-label={`${b.title}, ${b.author}`} onClick={(e) => onOpen(b, e.currentTarget.querySelector(".face-cover") as HTMLElement)}>
              <ViewTransition name={`book-${b.id}`} share="lib-morph" default="none">
                <div className="face-cover">
                  <Cover book={b} />
                  {b.pct > 0 && b.pct < 1 && <span className="face-ribbon" aria-hidden />}
                </div>
              </ViewTransition>
            </button>
            <p className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-3">
              <span>{b.bookmark ? "Saved link" : fmtMinutes(b.minutes)}</span>
              {b.pct > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span className={b.pct >= 1 ? "text-good" : "text-rubric-text"}>{b.pct >= 1 ? t("book.read") : `${Math.round(b.pct * 100)}%`}</span>
                </>
              )}
              {b.favorite && <span aria-label={t("book.favourite")}>⭐</span>}
            </p>
          </li>
        ))}
        {!books.length && <li className="col-span-full py-16 text-center text-[14px] text-ink-3">{t("topics.nothingHere")}</li>}
      </ul>
    </div>
  );
}
