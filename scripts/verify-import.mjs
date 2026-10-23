/**
 * 检验导入转换的正确性 —— 抽真实数据对一遍。
 *
 * 查四件事：
 *   1. 源里的图片/视频，是不是都变成了 figure
 *   2. 源里的正文文字，是不是都在 blocks 里（没丢）
 *   3. 没有残留的 Markdown 标记（**粗体**、*斜体*、![图片]()）
 *   4. 链接的 href 是不是提取出来了
 *
 * 跑法：node --experimental-sqlite scripts/verify-import.mjs
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const sq = new DatabaseSync("D:/shujia/gloss-library/data/library.db", { readOnly: true });
const rows = sq.prepare("select id,url,title,content,excerpt from articles").all();
sq.close();

// 复用导入脚本里的转换器（把它导出太绕，这里直接读文件里的函数太乱，
// 所以这里重写一份等价的 —— 两者必须一致，改一处要改两处。
// 更好的办法：把转换器抽到单独的文件里，两边共用。）
const { toBlocks } = await import("./lib-import-blocks.mjs");

const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => {
  console.log(`  ❌ ${m}`);
  process.exitCode = 1;
};

console.log("\n导入转换的正确性检验\n");

let missingMedia = 0;
let lostText = 0;
let leftoverMd = 0;
let lostLinks = 0;
let lostMediaUrl = 0;
let checked = 0;
const examples = [];

/** 去掉 Markdown 标记与空白，只留可比的文字。 */
const norm = (md) =>
  String(md ?? "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^([-*]|\d+\.)\s+/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, "")
    .trim();

for (const r of rows) {
  checked++;
  const src = String(r.content ?? "");
  const blocks = toBlocks(src);

  // 1. 媒体
  const srcMedia = [...src.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
  const gotMedia = blocks.filter((b) => b.type === "figure");
  if (srcMedia.length !== gotMedia.length) {
    missingMedia++;
    if (examples.length < 3) examples.push({ id: r.id, src: srcMedia.length, got: gotMedia.length });
  }

  // 2. 文字有没有丢
  // 两边都归一化（去掉标记与空白）。源里的一段可能被拆成几个块
  // （列表逐条成 li、段落里的图抽成 figure），所以整篇的文字
  // 拼起来应该包含源里每一段的关键内容。
  const srcText = norm(src);
  const gotText = norm(blocks.map((b) => b.runs.map((x) => x.text).join("")).join(" "));
  if (srcText.length > 40) {
    // 源里每段的前 25 个字，应该都能在转换结果里找到
    const srcParas = String(src)
      .split(/\n\s*\n/)
      .map((p) => norm(p))
      // 分隔线（---）与代码围栏不是正文内容，转换时会被剥掉或单独成块
      .filter((p) => p.length > 15 && !/^-+$/.test(p) && !/^`{3,}$/.test(p));
    // 代码块的源内容进了 pre，不在普通文字里
    const gotCode = norm(blocks.filter((b) => b.type === "pre").map((b) => b.runs.map((x) => x.text).join("")).join(" "));
    const missing = srcParas.filter((p) => {
      if (gotCode.includes(p.slice(0, 25))) return false;
      // 代码围栏和内容挤在一行时（```json{…}），源段落会带着 json 前缀，
      // 而转换后没有 —— 这时从中间取一段来比。
      const mid = p.slice(10, 35);
      if (mid.length > 15 && (gotCode.includes(mid) || gotText.includes(mid))) return false;
      return !gotText.includes(p.slice(0, 25));
    });
    if (missing.length) {
      lostText++;
      if (examples.length < 6) examples.push({ id: r.id, kind: "text", missing: missing[0].slice(0, 70) });
    }
  }

  // 3. 残留的 Markdown 标记
  // 粗体是 **…**；代码块（pre）里的内容是代码本身，里面有 ** 是正常的。
  const joined = blocks
    .filter((b) => b.type !== "pre")
    .map((b) => b.runs.map((x) => x.text).join(""))
    .join("\n");
  if (/!\[[^\]]*\]\(|\*\*[^*]+\*\*|\[[^\]]+\]\(/.test(joined)) {
    leftoverMd++;
    if (examples.length < 9) examples.push({ id: r.id, kind: "md", got: joined.slice(0, 80) });
  }

  // 4. 链接
  // 图片的 URL 变成 figure 的 src（不是 run 的 href），文字链接才进 href。
  // 注意 ![alt](url) 里的图片：正则从 [ 开始匹配，所以要靠 alt 前面有没有 ! 来分。
  const srcLinks = [...src.matchAll(/(!?)\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g)]
    .filter((m) => m[1] !== "!")
    .map((m) => m[3]);
  const gotLinks = blocks.flatMap((b) => [
    ...b.runs.filter((x) => x.href).map((x) => x.href),
    ...(b.src ? [b.src] : []),
  ]);
  for (const l of srcLinks) {
    if (!gotLinks.includes(l)) {
      lostLinks++;
      break;
    }
  }

  // 5. 图片的 URL 也得在（figure 的 src 里）
  const srcMediaUrls = [...src.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g)].map((m) => m[1]);
  const gotSrcs = blocks.filter((b) => b.type === "figure").map((b) => b.src);
  for (const l of srcMediaUrls) {
    if (!gotSrcs.includes(l)) {
      lostMediaUrl++;
      break;
    }
  }
}

console.log(`  检查了 ${checked} 篇文章\n`);
if (missingMedia) bad(`${missingMedia} 篇的图片/视频数量对不上`);
else ok(`图片/视频：${checked} 篇全部对得上`);
if (lostText) bad(`${lostText} 篇的正文文字有丢失`);
else ok("正文文字：没有丢失");
if (leftoverMd) bad(`${leftoverMd} 篇还残留 Markdown 标记`);
else ok("Markdown 标记：已全部转成结构");
if (lostLinks) bad(`${lostLinks} 篇的文字链接 href 没提取出来`);
else ok("文字链接：href 都提取出来了");
if (lostMediaUrl) bad(`${lostMediaUrl} 篇的图片 URL 没进 figure 的 src`);
else ok("图片 URL：都进了 figure 的 src");

if (examples.length) {
  console.log("\n  例子：");
  for (const e of examples.slice(0, 5)) console.log("   ", JSON.stringify(e).slice(0, 160));
}
console.log();
