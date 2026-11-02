// Re-creates the existing reader under their old Clerk user id, so the whole
// library keeps pointing at the right owner without touching a single row.
// Run: node --env-file-if-exists=.env.local scripts/adopt-clerk-user.mjs
import { createHash, randomBytes, scryptSync } from "node:crypto";
import readline from "node:readline/promises";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env.local.");
  process.exit(1);
}
const sql = postgres(url, { prepare: false, max: 1 });

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const enc = (b) => b.toString("base64url");
const hashPassword = (plain) => {
  const salt = randomBytes(16);
  const hash = scryptSync(plain.normalize("NFKC"), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${enc(salt)}$${enc(hash)}`;
};

const TABLES = ["articles", "highlights", "glosses", "briefs", "progress"];

// Which owner ids carry data today. A Clerk id looks like "user_2abc…".
const owners = new Set();
for (const t of TABLES) {
  const rows = await sql.unsafe(`select distinct user_id from ${t} limit 50`);
  for (const r of rows) owners.add(String(r.user_id));
  if (owners.size > 5) break;
}
const legacy = [...owners].filter((id) => id.startsWith("user_"));
console.log("Owners found with data:", [...owners].join(", ") || "(none)");

if (legacy.length !== 1) {
  console.error(
    legacy.length === 0
      ? "No legacy Clerk owner found — just sign up in the app normally."
      : "More than one legacy owner — refusing to guess. Run a signup in the app instead."
  );
  await sql.end({ timeout: 5 });
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const email = (await rl.question("Email (the login name): ")).trim().toLowerCase();
const password = await rl.question("Password (at least 10 chars): ");
const name = (await rl.question("Name (optional, enter to skip): ")).trim() || null;
rl.close();

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("That email does not look right.");
  await sql.end({ timeout: 5 });
  process.exit(1);
}
if (password.length < 10) {
  console.error("Use at least 10 characters.");
  await sql.end({ timeout: 5 });
  process.exit(1);
}

try {
  await sql.unsafe("insert into users (id, email, name, hash) values ($1, $2, $3, $4)", [legacy[0], email, name, hashPassword(password)]);
  console.log(`Adopted. "${email}" now signs in as ${legacy[0]} — the whole library comes with it.`);
} catch (e) {
  console.error("Could not create the account:", e.message);
  process.exitCode = 1;
}
await sql.end({ timeout: 5 });
