/**
 * Postgres, over postgres.js: plain TCP, so the same DATABASE_URL works against
 * Neon today and a self-hosted server tomorrow — only the URL changes. Server-side only.
 *
 * The face below mirrors the Neon HTTP client's, so callers keep their shape:
 * a tagged template (db()`select …`) and .query() that resolve to plain row
 * arrays, plus .transaction() that takes query specs and answers one result
 * array per spec, all inside one BEGIN/COMMIT.
 */

import postgres from "postgres";

let client: postgres.Sql | null = null;

/** True when a database is configured. The app works without one — only the account features need it. */
export const hasDatabase = () => Boolean(process.env.DATABASE_URL);

type Row = Record<string, unknown>;
type Spec = { text: string; params?: unknown[] };

export type Db = {
  (text: TemplateStringsArray, ...params: unknown[]): Promise<Row[]>;
  query: <T = Row>(text: string, params?: unknown[]) => Promise<T[]>;
  transaction: (specs: Spec[]) => Promise<Row[][]>;
};

export function db(): Db {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");
    // prepare:false keeps the driver safe behind transaction-mode poolers
    // (Neon's pooled endpoint); on a direct connection it costs nothing.
    client = postgres(url, { prepare: false, max: 5 });
  }
  const sql = client;
  const face = ((text: TemplateStringsArray, ...params: unknown[]) =>
    sql(text, ...(params as never[]))) as unknown as Db;
  face.query = async <T = Row>(text: string, params?: unknown[]) =>
    (await sql.unsafe(text, (params ?? []) as never[])) as unknown as T[];
  face.transaction = async (specs) => {
    return (await sql.begin(async (tx) => {
      const out: Row[][] = [];
      for (const s of specs) out.push((await tx.unsafe(s.text, (s.params ?? []) as never[])) as unknown as Row[]);
      return out;
    })) as unknown as Row[][];
  };
  return face;
}

/** The tables the sync route reads and writes. Names are only ever taken from this list. */
export const COLLECTIONS = ["articles", "highlights", "glosses", "briefs", "progress"] as const;
export type Collection = (typeof COLLECTIONS)[number];
export const isCollection = (v: unknown): v is Collection => typeof v === "string" && (COLLECTIONS as readonly string[]).includes(v);

export type PushRow = { id: string; article_id: string; data: unknown; deleted: boolean; doc?: unknown };
export type PullRow = { id: string; articleId: string; data: unknown; deleted: boolean };

/** Rows changed since `since` in every collection, tombstones included, plus the server clock to pull from next time. */
export async function pullRows(userId: string, since: string): Promise<{ now: string; changes: Record<Collection, PullRow[]> }> {
  const [clock, ...results] = await db().transaction([
    { text: "select now() as now" },
    ...COLLECTIONS.map((t) => ({
      text: `select id, article_id, data, deleted from ${t} where user_id = $1 and updated_at > $2 order by updated_at`,
      params: [userId, since],
    })),
  ]);
  const changes = Object.fromEntries(
    COLLECTIONS.map((t, i) => [
      t,
      ((results[i] ?? []) as Record<string, unknown>[]).map((r) => ({ id: String(r.id), articleId: String(r.article_id), data: r.deleted ? null : r.data, deleted: Boolean(r.deleted) })),
    ])
  ) as Record<Collection, PullRow[]>;
  return { now: new Date((clock as { now: Date | string }[])[0].now).toISOString(), changes };
}

/** Upsert every collection's rows in one transaction. The server stamps the time, so the latest write wins. */
export async function pushRows(userId: string, changes: Partial<Record<Collection, PushRow[]>>): Promise<void> {
  const specs: Spec[] = Object.entries(changes)
    .filter(([t, rows]) => isCollection(t) && rows?.length)
    // The row array goes in as a JS value, not a pre-serialized string: the
    // driver sees the ::jsonb cast and serializes it itself, and a string
    // param would arrive double-encoded (a jsonb scalar, not an array).
    .map(([t, rows]) => ({ text: upsert(t as Collection), params: [userId, rows] }));
  // A text taken off the shelf takes its painted cover with it.
  const gone = (changes.articles ?? []).filter((r) => r.deleted).map((r) => r.id);
  if (gone.length) specs.push({ text: "delete from covers where user_id = $1 and id = any($2::text[])", params: [userId, gone] });
  if (specs.length) await db().transaction(specs);
}

/** One article's full text. */
export async function articleDoc(userId: string, id: string): Promise<unknown | null> {
  const rows = await db().query("select doc from articles where user_id = $1 and id = $2 and not deleted and doc is not null", [userId, id]);
  return rows.length ? rows[0].doc : null;
}

/** One statement per table: unpack the JSON array of rows and upsert them all. An article pushed without its text keeps the stored one. */
function upsert(table: Collection): string {
  const isArticles = table === "articles";
  return `insert into ${table} (user_id, id, article_id, data, deleted, updated_at${isArticles ? ", doc" : ""})
    select $1, r.id, r.article_id, r.data, r.deleted, now()${isArticles ? ", r.doc" : ""}
    from jsonb_to_recordset($2::jsonb) as r(id text, article_id text, data jsonb, deleted boolean${isArticles ? ", doc jsonb" : ""})
    on conflict (user_id, id) do update set
      article_id = excluded.article_id, data = excluded.data, deleted = excluded.deleted, updated_at = now()${
        isArticles ? ", doc = case when excluded.deleted then null else coalesce(excluded.doc, articles.doc) end" : ""
      }`;
}

/* ---------- painted covers ---------- */

export async function saveCover(userId: string, id: string, jpeg: Uint8Array): Promise<void> {
  await db().query(
    `insert into covers (user_id, id, jpeg) values ($1, $2, $3)
     on conflict (user_id, id) do update set jpeg = excluded.jpeg, created_at = now()`,
    [userId, id, Buffer.from(jpeg).toString("base64")]
  );
}

export async function loadCover(userId: string, id: string): Promise<Uint8Array | null> {
  const rows = await db().query("select jpeg from covers where user_id = $1 and id = $2", [userId, id]);
  return rows.length ? Uint8Array.from(Buffer.from(String(rows[0].jpeg), "base64")) : null;
}

/* ---------- agent tokens ---------- */

export type AgentToken = { id: string; label: string; createdAt: string; lastUsedAt: string | null };

export async function createToken(userId: string, id: string, hash: string, label: string): Promise<void> {
  await db().query("insert into agent_tokens (id, user_id, hash, label) values ($1, $2, $3, $4)", [id, userId, hash, label]);
}

export async function listTokens(userId: string): Promise<AgentToken[]> {
  const rows = await db().query("select id, label, created_at, last_used_at from agent_tokens where user_id = $1 and not revoked order by created_at desc", [userId]);
  return rows.map((r) => ({ id: String(r.id), label: String(r.label), createdAt: new Date(r.created_at as string | Date).toISOString(), lastUsedAt: r.last_used_at ? new Date(r.last_used_at as string | Date).toISOString() : null }));
}

export async function revokeToken(userId: string, id: string): Promise<boolean> {
  const rows = await db().query("update agent_tokens set revoked = true where user_id = $1 and id = $2 and not revoked returning id", [userId, id]);
  return rows.length > 0;
}

/** The reader a token belongs to, noting that it was used. Null for an unknown or revoked token. */
export async function tokenUser(hash: string): Promise<{ userId: string; label: string } | null> {
  const rows = await db().query("update agent_tokens set last_used_at = now() where hash = $1 and not revoked returning user_id, label", [hash]);
  return rows.length ? { userId: String(rows[0].user_id), label: String(rows[0].label ?? "") } : null;
}

/* ---------- the library, for an agent ---------- */

export type ShelfRow = { id: string; data: Record<string, unknown>; pct: number };

/** Every text on a reader's shelf, with how far they've read. */
export async function shelfOf(userId: string): Promise<ShelfRow[]> {
  const rows = await db().query(
    `select a.id, a.data, p.data as progress from articles a
     left join progress p on p.user_id = a.user_id and p.id = a.id and not p.deleted
     where a.user_id = $1 and not a.deleted order by a.updated_at desc`,
    [userId]
  );
  return rows.map((r) => ({ id: String(r.id), data: (r.data ?? {}) as Record<string, unknown>, pct: Number((r.progress as { pct?: number } | null)?.pct ?? 0) }));
}

/** Put one imported text on a reader's shelf, as their browser would: the next sync brings it down. */
export async function shelveForUser(userId: string, item: { id: string }, doc: unknown): Promise<void> {
  await db().query(
    `insert into articles (user_id, id, article_id, data, doc, deleted, updated_at) values ($1, $2, $2, $3, $4, false, now())
     on conflict (user_id, id) do update set data = excluded.data, doc = excluded.doc, deleted = false, updated_at = now()`,
    [userId, item.id, JSON.stringify(item), JSON.stringify(doc)]
  );
}
