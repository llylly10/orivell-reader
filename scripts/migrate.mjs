// Applies db/schema.sql to DATABASE_URL. Idempotent. Run with `npm run db:migrate`.
// Uses plain postgres over TCP, so the URL can be Neon or a self-hosted server alike.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env.local.");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1 });
const statements = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
  .replace(/--.*$/gm, "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

for (const s of statements) await sql.unsafe(s);
const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
console.log(`Applied ${statements.length} statements. Tables: ${tables.map((t) => t.table_name).join(", ")}`);
await sql.end({ timeout: 5 });
