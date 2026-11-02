// Resets a reader's password right on the server — the no-email fallback of
// "forgot password". Run: node --env-file-if-exists=.env.local scripts/reset-password.mjs
// Interactive on a terminal; when stdin is piped it reads two lines instead
// (email, then the new password), so automation does not hang on readline.
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
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
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${enc(salt)}$${enc(scryptSync(plain.normalize("NFKC"), salt, SCRYPT.keylen, SCRYPT))}`;
};

let email;
let password;

if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  email = (await rl.question("Email of the account: ")).trim().toLowerCase();
  password = await rl.question("New password (at least 10 chars): ");
  rl.close();
} else {
  const lines = readFileSync(0, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  email = (lines[0] ?? "").toLowerCase();
  password = lines[1] ?? "";
}

if (password.length < 10) {
  console.error("Use at least 10 characters.");
  await sql.end({ timeout: 5 });
  process.exit(1);
}

const u = await sql.unsafe("select id from users where email = $1", [email]);
if (!u.length) {
  console.error("No account with that email.");
  await sql.end({ timeout: 5 });
  process.exit(1);
}

await sql.unsafe("update users set hash = $1 where id = $2", [hashPassword(password), u[0].id]);
const gone = await sql.unsafe("delete from sessions where user_id = $1", [u[0].id]);
console.log(`Password updated for ${email}. ${gone.length} old session(s) signed out — sign in with the new password.`);
await sql.end({ timeout: 5 });
