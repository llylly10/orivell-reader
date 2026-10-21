/**
 * Find i18n keys used in components that the dictionary does not define.
 *
 * A key with no English entry falls through to the key itself, which shows up
 * on screen as "book.doesNotExist". A key with no Chinese entry falls through
 * to English, which shows up as English on a Chinese page. Both are worth
 * knowing about, so this reports them from the source rather than by eye.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DICT = path.join(ROOT, "lib", "i18n.ts");

const dictSrc = fs.readFileSync(DICT, "utf8");

/** Split the file into its two object literals: en and zh. */
function keysOf(pattern) {
  const start = dictSrc.search(pattern);
  if (start < 0) return null;
  const open = dictSrc.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < dictSrc.length; i++) {
    if (dictSrc[i] === "{") depth++;
    else if (dictSrc[i] === "}") {
      depth--;
      if (depth === 0) {
        const body = dictSrc.slice(open + 1, i);
        const keys = new Set();
        // Keys look like  "some.key": "value",  at the start of a line.
        for (const m of body.matchAll(/^\s*"([\w.]+)"\s*:/gm)) keys.add(m[1]);
        return keys;
      }
    }
  }
  return null;
}

const en = keysOf(/^const en = \{/m);
const zh = keysOf(/^const zh: Partial<Dict> = \{/m);
if (!en || !zh) {
  console.error("could not read the dictionaries");
  process.exit(1);
}

/** Every t("key") in the components and lib. */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const used = new Map(); // key -> [files]
for (const file of [...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "app"))]) {
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/\bt\(\s*"([\w.]+)"/g)) {
    const k = m[1];
    if (!used.has(k)) used.set(k, []);
    used.get(k).push(path.relative(ROOT, file));
  }
}

const missingEn = [];
const missingZh = [];
for (const [k, files] of used) {
  if (!en.has(k)) missingEn.push({ k, files });
  else if (!zh.has(k)) missingZh.push({ k, files });
}

console.log(`keys used: ${used.size}`);
console.log(`dictionary: en=${en.size} zh=${zh.size}`);

if (missingEn.length) {
  console.log(`\n=== NOT IN DICTIONARY (${missingEn.length}) — shows the key itself ===`);
  missingEn.forEach(({ k, files }) => console.log(` ${k}\n     ${[...new Set(files)].join(", ")}`));
} else {
  console.log("\nall used keys exist in en");
}

if (missingZh.length) {
  console.log(`\n=== NOT TRANSLATED INTO ZH (${missingZh.length}) — falls back to English ===`);
  missingZh.forEach(({ k, files }) => console.log(` ${k}\n     ${[...new Set(files)].join(", ")}`));
} else {
  console.log("\nevery used key has a Chinese translation");
}