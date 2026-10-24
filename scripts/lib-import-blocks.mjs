/**
 * Markdown → Gloss 的 blocks。
 *
 * Gloss 的正文是段落数组（{ id, type, runs }），不是一段 Markdown。
 * 这个转换器把从 gloss-library 导出的 Markdown 正文变成那种形状：
 * 标题成 h2/h3，引用成 quote，列表成 li，代码成 pre，图片与视频成 figure，
 * 行内的粗体、斜体、代码、链接拆进 runs。
 *
 * 导入脚本与检验脚本共用这一份，改一处两处都跟着变。
 */

/** Gloss 的 Run：{ text, em?, strong?, code?, href? } */
const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

/** 一行文字里的行内标记拆成 runs。 */
export function inlineRuns(text) {
  const runs = [];
  let last = 0;
  for (const m of String(text).matchAll(INLINE)) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("**")) runs.push({ text: tok.slice(2, -2), strong: true });
    else if (tok.startsWith("`")) runs.push({ text: tok.slice(1, -1), code: true });
    else if (tok.startsWith("*")) runs.push({ text: tok.slice(1, -1), em: true });
    else {
      const link = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) runs.push({ text: link[1], href: link[2] });
      else runs.push({ text: tok });
    }
    last = m.index + tok.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.filter((r) => r.text.length);
}

/** Markdown 正文 → Gloss 的 blocks。 */
export function toBlocks(markdown) {
  // X 推文里的换行是 U+2028（行分隔符），不是 \n。归一化成 \n，
  // 否则整条推文会挤成一段，列表和引用都认不出来。
  const text = String(markdown ?? "")
    .replace(/\r/g, "")
    .replace(/\u2028/g, "\n")
    .replace(/\u2029/g, "\n")
    // HTML 注释（X 推文里用它记时长）不是正文内容
    .replace(/<!--[\s\S]*?-->/g, "");
  const chunks = text.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
  const blocks = [];
  let i = 0;
  const id = () => `b${++i}`;

  for (const chunk of chunks) {
    // 独立成段的图片或视频
    const media = chunk.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (media) {
      blocks.push({ id: id(), type: "figure", runs: media[1] ? [{ text: media[1] }] : [], src: media[2], alt: media[1] || "" });
      continue;
    }
    // 多张图连在一起
    if (/^(?:!\[[^\]]*\]\([^)]+\)\s*)+$/.test(chunk)) {
      for (const m of chunk.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
        blocks.push({ id: id(), type: "figure", runs: m[1] ? [{ text: m[1] }] : [], src: m[2], alt: m[1] || "" });
      }
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(chunk)) continue;

    const h = chunk.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      blocks.push({ id: id(), type: h[1].length <= 2 ? "h2" : "h3", runs: inlineRuns(h[2]) });
      continue;
    }
    // 引用：整段都是 > 开头，或者段里混着 > 行与普通行。
    // 混排时要把引用行与普通行分开 —— 否则 > 符号会留在正文里。
    // 引用里也可能裹着代码块（> ``` … ```）：代码块要单独成 pre，
    // 不能和引用文字拼在一起 —— 拼了之后代码里的 ** 会和外面的 ** 配对错，
    // 把正文里的粗体也一起吃掉。
    const hasQuote = chunk.split("\n").some((l) => /^>\s?/.test(l));
    if (hasQuote) {
      let buf = [];
      let quoted = false;
      let inCode = false;
      const flush = () => {
        const t = buf.join(" ").trim();
        buf = [];
        if (!t) return;
        const runs = inlineRuns(t);
        const block = { id: id(), type: quoted ? "quote" : "p", runs };
        // 引用头里的原推链接（引用 [@handle](https://x.com/i/status/…)）提成 quoteUrl，
        // 阅读器据此在引用卡上放一个跳到原推的入口。
        if (quoted) {
          const qlink = runs.find((r) => r.href && /x\.com\/i\/status\//.test(r.href));
          if (qlink) block.quoteUrl = qlink.href;
        }
        blocks.push(block);
      };
      for (const line of chunk.split("\n")) {
        const isQ = /^>\s?/.test(line);
        const text2 = isQ ? line.replace(/^>\s?/, "") : line;

        // 代码块的起止
        if (inCode) {
          buf.push(text2);
          if (/^\s*```/.test(text2)) {
            inCode = false;
            const code = buf.join("\n").replace(/^\s*```\w*\n?/, "").replace(/\n?\s*```\s*$/, "");
            buf = [];
            blocks.push({ id: id(), type: "pre", runs: [{ text: code }] });
          }
          continue;
        }
        if (/^\s*```/.test(text2)) {
          flush();
          inCode = true;
          buf.push(text2);
          continue;
        }

        // 引用里夹的独立图片/视频行（被引用推文的媒体）：单独成 figure，
        // 紧跟在引用文字后面，不混进引用的正文里。
        const solo = text2.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (solo) {
          flush();
          blocks.push({ id: id(), type: "figure", runs: solo[1] ? [{ text: solo[1] }] : [], src: solo[2], alt: solo[1] || "" });
          continue;
        }

        if (isQ !== quoted) {
          flush();
          quoted = isQ;
        }
        buf.push(text2);
      }
      flush();
      continue;
    }
    if (/^([-*]|\d+\.)\s+/m.test(chunk)) {
      // 列表前面可能还有一句引导语（“核心优势：\n1. …\n2. …”），
      // 它不是列表项，要单独成一段，否则会跟着列表一起被丢掉。
      const lines = chunk.split("\n");
      const firstItem = lines.findIndex((l) => /^([-*]|\d+\.)\s+/.test(l));
      const lead = lines
        .slice(0, firstItem)
        .join(" ")
        .trim();
      if (lead) blocks.push({ id: id(), type: "p", runs: inlineRuns(lead) });
      for (const line of lines.slice(firstItem)) {
        const li = line.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
        if (li) blocks.push({ id: id(), type: "li", runs: inlineRuns(li[1]) });
        else {
          // 列表项的续行（缩进跟着上一项）
          const cont = line.trim();
          if (cont) {
            const last = blocks[blocks.length - 1];
            if (last && last.type === "li") last.runs.push({ text: " " }, ...inlineRuns(cont));
            else blocks.push({ id: id(), type: "p", runs: inlineRuns(cont) });
          }
        }
      }
      continue;
    }
    if (/^```/.test(chunk)) {
      const code = chunk.replace(/^```\w*\n?/, "").replace(/```\s*$/, "");
      blocks.push({ id: id(), type: "pre", runs: [{ text: code }] });
      continue;
    }
    // 代码块跨空行时会被切成两段，第二段以 ``` 开头 —— 也要当代码。
    if (/^```/.test(chunk.trimStart()) && /```/.test(chunk)) {
      const code = chunk.trimStart().replace(/^```\w*\n?/, "").replace(/```\s*$/, "");
      blocks.push({ id: id(), type: "pre", runs: [{ text: code }] });
      continue;
    }

    // 段落里混着图片或视频：把它们抽出来，剩下的文字照旧成一段。
    // X 书签的图常常紧跟在文字后面，不抽出来就只剩一个裸的 Markdown 标记。
    const embedded = [...chunk.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
    if (embedded.length) {
      let rest = chunk;
      for (const m of embedded) {
        rest = rest.replace(m[0], "");
        blocks.push({ id: id(), type: "figure", runs: m[1] ? [{ text: m[1] }] : [], src: m[2], alt: m[1] || "" });
      }
      const text2 = rest.replace(/\s+/g, " ").trim();
      if (text2) blocks.unshift({ id: id(), type: "p", runs: inlineRuns(text2) });
      continue;
    }

    blocks.push({ id: id(), type: "p", runs: inlineRuns(chunk.replace(/\n/g, " ")) });
  }
  return blocks;
}
