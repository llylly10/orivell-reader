/**
 * Find English text left in the interface.
 *
 * The t() audit proves every key that is used has a translation. It cannot see
 * the strings that were never wrapped in t() in the first place: new UI from
 * an upstream merge, or copy added after a translation pass. This looks for
 * text nodes and common attributes that still hold English, so a Chinese page
 * has no English left showing.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DIRS = ["components", "app"];

/** JSX text that is a word or two, not code, not a class name. */
const ENGLISH_TEXT = />([A-Z][A-Za-z'’\-]*(?:\s+[A-Za-z'’\-]+){0,6}[.!?:]?)\s*</g;
/** An aria-label, placeholder, title or data-tip with English in it. */
const ENGLISH_ATTR = /(?:aria-label|placeholder|title|data-tip|alt)\s*=\s*"([^"]{2,})"/g;

const skip = (s) =>
  !/[A-Za-z]/.test(s) || // no letters
  /^[a-z-]+$/.test(s) || // a class or a slug
  /^(https?:|mailto:|\/)/.test(s) || // a url or a path
  /^\s*$/.test(s);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".next", ".git"].includes(e.name)) continue;
      walk(p, out);
    } else if (/\.tsx$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const hits = [];

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);
  const lines = src.split(/\r?\n/);

  lines.forEach((line, i) => {
    // Skip lines that are inside a t() call: those are already handled.
    const inTranslate = /\bt\(\s*"[^"]*"\s*\)/.test(line) || /\bt\(`/.test(line);

    for (const m of line.matchAll(ENGLISH_TEXT)) {
      const s = m[1].trim();
      if (skip(s)) continue;
      // A word that is also a code identifier is not prose.
      if (/^[A-Z][a-z]+$/.test(s) && !/[a-z]{2}/.test(s)) continue;
      hits.push({ rel, line: i + 1, kind: "text", value: s, inTranslate });
    }
    for (const m of line.matchAll(ENGLISH_ATTR)) {
      const s = m[1].trim();
      if (skip(s)) continue;
      hits.push({ rel, line: i + 1, kind: "attr", value: s, inTranslate });
    }
  });
}

const real = hits.filter((h) => !h.inTranslate);
console.log(`扫描 ${files.length} 个 tsx 文件\n`);
console.log(`疑似英文残留 ${real.length} 处\n`);

const byFile = new Map();
for (const h of real) {
  if (!byFile.has(h.rel)) byFile.set(h.rel, []);
  byFile.get(h.rel).push(h);
}

for (const [file, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`--- ${file} (${list.length}) ---`);
  for (const h of list) console.log(`  ${h.line}: [${h.kind}] ${JSON.stringify(h.value)}`);
  console.log("");
}
