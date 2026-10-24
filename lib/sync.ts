"use client";

/**
 * Account sync for signed-in readers. The browser stays the source of truth
 * while you read; this mirrors it to the account and back.
 *
 * - Push: what changed since the last push, found by comparing each entity's
 *   stable JSON with a baseline of what the server already has. Deletions are
 *   the rows the shelf itself watched leave it, sent as tombstones — never a
 *   row the account has that this device merely fails to hold.
 * - Pull: rows changed since the last pull, merged in with applyRemote. The
 *   baseline then records them, so they are not pushed straight back.
 * - Texts travel separately: pushed once with the shelf entry, fetched on
 *   another device only when it is opened there.
 *
 * The baseline lives in localStorage per user, so a second account on the
 * same browser starts fresh and receives what is on this device.
 *
 * While a page watches the shelf (the library), it also pulls every few
 * seconds, so what an agent saves arrives while you look.
 */

import { useEffect, useState } from "react";
import {
  forgetDoc,
  forgetRemovals,
  loadDoc,
  onLocalStorageFull,
  pendingRemovals,
  persistShelf,
  saveDoc,
  useStore,
  type RemoteChanges,
  type ShelfRows,
} from "./store";
import type { Article } from "./article";
import { forgetCover } from "./covers";

const COLLECTIONS = ["articles", "highlights", "glosses", "briefs", "progress"] as const;
type Collection = (typeof COLLECTIONS)[number];

type Entity = { articleId: string; data: unknown; key: string };
type Snapshot = { entities: Record<Collection, Map<string, Entity>>; busy: Set<string> };

type Baseline = {
  since: string | null;
  /** What the server has, and at what content key. */
  seen: Record<Collection, Record<string, [key: string, articleId: string]>>;
};

type OutRow = { id: string; articleId: string; data: unknown; deleted?: boolean; doc?: Article };

/** Pushes are split to stay well under the 4.5MB request cap. */
const BATCH_BYTES = 1_500_000;
const MAX_BODY = 4_300_000;
/** Pulls overlap a little, so a write that landed while the last pull ran is not missed. Applying a row twice is harmless. */
const OVERLAP_MS = 30_000;

/** JSON with sorted keys, so the same object always compares equal, whatever order Postgres hands keys back in. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

function snapshot(): Snapshot {
  const st = useStore.getState();
  const entities = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map<string, Entity>()])) as Snapshot["entities"];
  const busy = new Set<string>();
  const put = (c: Collection, id: string, articleId: string, data: unknown) => entities[c].set(id, { articleId, data, key: stable(data) });

  for (const item of st.library) put("articles", item.id, item.id, item);
  for (const [aid, list] of Object.entries(st.highlights)) for (const h of list) put("highlights", h.id, aid, h);
  for (const [aid, list] of Object.entries(st.glosses))
    for (const g of list) {
      // An answer still being written is left alone until it settles.
      if (g.turns.some((t) => t.streaming)) busy.add(`glosses:${g.id}`);
      else put("glosses", g.id, aid, g);
    }
  for (const [aid, b] of Object.entries(st.briefs)) {
    if (b.status === "ready") put("briefs", aid, aid, b);
    else busy.add(`briefs:${aid}`);
  }
  for (const [aid, p] of Object.entries(st.progress)) put("progress", aid, aid, p);
  return { entities, busy };
}

/** Pages that want arrivals as they happen, and how to tell the running sync. */
let watchers = 0;
let poke: (() => void) | null = null;

/**
 * How often a page that is watching the shelf pulls.
 *
 * Five seconds is responsive, and it is also one pull every five seconds per
 * reader — which is a lot of queries once there are more than a handful of
 * readers. A longer wait costs nothing in practice: what arrives late is
 * something an agent saved, and it is just as useful a minute later.
 *
 * `NEXT_PUBLIC_SYNC_INTERVAL_MS` raises it when the database is shared with
 * many readers.
 */
const WATCH_MS = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_SYNC_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 1000 ? raw : 5000;
})();

/** How often a page that is not watching the shelf pulls. Longer than WATCH_MS. */
const IDLE_MS = WATCH_MS * 4;

/** Pull now and every few seconds while the returned stop hasn't been called. */
export function watchShelf(): () => void {
  watchers++;
  poke?.();
  return () => {
    watchers--;
  };
}

/* ---------- what the sync is doing, for the reader to see ---------- */

/**
 * Where the account sync stands.
 *
 * `off` is the resting state. `working` is a push or pull in flight. `error`
 * is a failure worth telling the reader about: the shelf is safe on this
 * device, but it is not reaching the account, and the reader should know that
 * rather than find out later.
 */
export type SyncState = "off" | "working" | "error";

let state: SyncState = "off";
const stateListeners = new Set<(s: SyncState) => void>();

function setState(s: SyncState) {
  if (state === s) return;
  state = s;
  for (const fn of stateListeners) fn(s);
}

/** The sync's current state, and a way to hear about changes. */
export function useSyncState(): SyncState {
  const [s, setLocal] = useState<SyncState>(state);
  useEffect(() => {
    setLocal(state);
    stateListeners.add(setLocal);
    return () => {
      stateListeners.delete(setLocal);
    };
  }, []);
  return s;
}

/** The reason the last sync failed, if it did. For the reader's own eyes. */
let lastError: string | null = null;
export const syncError = () => lastError;

const emptyBaseline = (): Baseline => ({
  since: null,
  seen: Object.fromEntries(COLLECTIONS.map((c) => [c, {}])) as Baseline["seen"],
});

export function startSync(userId: string) {
  const storeKey = `gloss:sync:${userId}`;
  let base: Baseline = emptyBaseline();
  try {
    const raw = localStorage.getItem(storeKey);
    if (raw) base = { ...emptyBaseline(), ...JSON.parse(raw) };
  } catch {}
  const save = () => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(base));
    } catch {}
  };

  let stopped = false;
  // One operation at a time: a pull never lands in the middle of a push.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = (fn: () => Promise<void>) =>
    (chain = chain
      .then(() => (stopped ? undefined : fn()))
      .catch((e) => {
        // A failure here is a failure to reach the account. The shelf itself
        // is untouched on this device, so this is reported, not thrown.
        lastError = e instanceof Error ? e.message : String(e);
        setState("error");
      }));

  async function push() {
    // The shelf goes to disk first, so a deletion the reader just made is
    // witnessed before anything is pushed about it. A write that does not
    // fit witnesses nothing, and nothing is claimed about the account
    // because of it.
    persistShelf();
    const { entities, busy } = snapshot();
    const rows: { c: Collection; row: OutRow; key: string | null; size: number }[] = [];
    for (const c of COLLECTIONS) {
      const seen = base.seen[c];
      for (const [id, e] of entities[c]) {
        if (seen[id]?.[0] === e.key) continue;
        const row: OutRow = { id, articleId: e.articleId, data: e.data };
        // A text goes up with its first shelf entry, and again when it is replaced (its rev changes).
        // Samples ship with the app.
        if (c === "articles" && (e.data as { origin?: string }).origin !== "sample") {
          const doc = await loadDoc(id);
          if (doc) row.doc = doc;
        }
        rows.push({ c, row, key: e.key, size: JSON.stringify(row).length });
      }
      // A row the reader took off the shelf.
      //
      // This is the only thing that counts as a deletion. The shelf records
      // what left it, and only a write to disk can witness that: a row that
      // was on the shelf and is not any more was taken off it by the reader.
      //
      // Everything else — a row the account has but this device never stored,
      // a shelf that could not be written, a baseline that remembers rows
      // this device has not seen — is not a deletion, and is never pushed as
      // one. Those are the cases that used to empty the account.
      //
      // The removal is remembered in the shelf, so a refresh between the
      // reader's removal and this push does not lose it.
      for (const r of pendingRemovals()[c]) {
        if (entities[c].has(r.id)) continue;
        if (busy.has(`${c}:${r.id}`)) continue;
        rows.push({ c, row: { id: r.id, articleId: r.articleId, data: {}, deleted: true }, key: null, size: r.id.length + r.articleId.length + 64 });
      }
    }
    if (!rows.length) return;

    // Too big for one request even alone: send the shelf entry without the text.
    for (const r of rows) {
      if (r.size > MAX_BODY && r.row.doc) {
        delete r.row.doc;
        r.size = JSON.stringify(r.row).length;
      }
    }

    let batch: typeof rows = [];
    let bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      const changes: Partial<Record<Collection, OutRow[]>> = {};
      for (const r of batch) (changes[r.c] ??= []).push(r.row);
      const res = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ changes }) });
      if (!res.ok) throw new Error(`push ${res.status}`);
      // The account has been told. A row that was taken off the shelf need
      // not be told about again; a row that was pushed in its current form
      // makes any earlier removal of it obsolete — the reader brought it
      // back, and the account now holds what this device holds.
      const told: ShelfRows = { articles: [], highlights: [], glosses: [], briefs: [], progress: [] };
      for (const r of batch) {
        told[r.c].push({ id: r.row.id, articleId: r.row.articleId });
        if (r.key === null) delete base.seen[r.c][r.row.id];
        else base.seen[r.c][r.row.id] = [r.key, r.row.articleId];
      }
      forgetRemovals(told);
      save();
      batch = [];
      bytes = 0;
    };
    for (const r of rows) {
      if (bytes + r.size > BATCH_BYTES) await flush();
      batch.push(r);
      bytes += r.size;
    }
    await flush();
    // It reached the account, so any earlier failure is over.
    lastError = null;
    if (state === "error") setState("off");
  }

  async function pull() {
    const q = base.since ? `?since=${encodeURIComponent(new Date(Date.parse(base.since) - OVERLAP_MS).toISOString())}` : "";
    const res = await fetch(`/api/sync${q}`);
    if (!res.ok) throw new Error(`pull ${res.status}`);
    const { now, changes } = (await res.json()) as { now: string; changes: RemoteChanges };

    // A text replaced on another device: drop this device's copy so it is fetched fresh on open.
    for (const r of changes.articles ?? []) {
      const before = base.seen.articles[r.id];
      if (!r.deleted && r.data && before && (r.data as { rev?: number }).rev !== undefined && stable(r.data) !== before[0]) void forgetDoc(r.id);
      // Removed on another device: its painted cover goes from this one too.
      if (r.deleted) void forgetCover(r.id);
    }
    useStore.getState().applyRemote(changes);

    // Record what the account holds. This is a fact about the account, not
    // about this device: it holds whether or not the shelf took the rows.
    const { entities } = snapshot();
    const settled: ShelfRows = { articles: [], highlights: [], glosses: [], briefs: [], progress: [] };
    for (const c of COLLECTIONS) {
      for (const r of changes[c] ?? []) {
        const e = entities[c].get(r.id);
        if (r.deleted) {
          delete base.seen[c][r.id];
          // The account has already let this one go, so this device has
          // nothing left to tell it about.
          settled[c].push({ id: r.id, articleId: r.articleId });
        } else if (e) base.seen[c][r.id] = [e.key, e.articleId];
      }
    }
    // The shelf must reach the disk before the cursor moves over these rows.
    //
    // The baseline and the shelf are two keys in one storage, and they are
    // not written at the same moment. If the cursor moves first and the page
    // closes before the shelf lands, this device asks for rows it already
    // has and never gets them again — while the rows it does have, it may
    // not have. So the shelf goes down first, and the cursor only moves over
    // what is already there.
    //
    // When the shelf will not fit, the cursor stays where it was: these rows
    // are fetched again later, rather than being lost between the account
    // and the device.
    //
    // `settled` rides along with the write, and must: a row the account
    // deleted left this shelf for the account's reason, so the write would
    // otherwise see it as a row that vanished and blame the reader for it.
    // Naming it here keeps it out of the ledger, and out of the next push.
    if (persistShelf({ settled, force: true })) base.since = now;
    save();
  }

  const sync = () =>
    serial(async () => {
      setState("working");
      try {
        await pull();
        await push();
        lastError = null;
        setState("off");
      } catch (e) {
        // The shelf is safe on this device; it is the copy on the account that
        // is behind. Say so, rather than failing silently.
        lastError = e instanceof Error ? e.message : String(e);
        setState("error");
      }
    });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = useStore.subscribe((st, prev) => {
    if (!st.hydrated) return;
    if (st.library === prev.library && st.highlights === prev.highlights && st.glosses === prev.glosses && st.briefs === prev.briefs && st.progress === prev.progress) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => serial(push), 2000);
  });

  let lastPull = 0;
  const pullIfStale = (ms: number) => {
    if (document.visibilityState === "hidden" || Date.now() - lastPull < ms) return;
    lastPull = Date.now();
    sync();
  };
  const onVisible = () => {
    if (document.visibilityState === "hidden") serial(push);
    else pullIfStale(watchers ? WATCH_MS : IDLE_MS);
  };
  document.addEventListener("visibilitychange", onVisible);
  const ticker = setInterval(() => watchers && pullIfStale(WATCH_MS - 1000), WATCH_MS);
  poke = () => pullIfStale(3000);

  lastPull = Date.now();
  sync();

  // The shelf may no longer fit here — from an earlier session, or from this
  // one. Either way, deletions are held back until it fits again.
  const offOverflow = onLocalStorageFull((full) => {
    if (!full) serial(push);
  });

  return {
    stop() {
      stopped = true;
      unsubscribe();
      offOverflow();
      if (timer) clearTimeout(timer);
      clearInterval(ticker);
      poke = null;
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
}

/** Fetch one text from the account and keep it on this device. Null when signed out or not there. */
export async function fetchText(id: string): Promise<Article | null> {
  try {
    const res = await fetch(`/api/articles/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const { doc } = (await res.json()) as { doc: Article };
    await saveDoc(doc);
    return doc;
  } catch {
    return null;
  }
}
