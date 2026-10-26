/** 应用人工实体抽取：合并 entity-out-*.json，校验，写入 Neon entities 表。 */
const fs = require("fs");
const { neon } = require("@neondatabase/serverless");

const UID = process.env.GLOSS_USER_ID || "user_3L5fuAOEc9L4CDjPa8EQc83Yh49";
const TYPES = new Set(["person", "project", "company", "concept"]);

const PRODUCT = new Set(["Claude Code","Codex","Claude","ChatGPT","GPT","Grok","Grok Bot","Jev","Hermes","OpenClaw","REA","MediaCrawler","Obsidian","NotebookLM","Cursor","Qwen","DeepSeek","SQLite","Rust","Tailwind","Blender","Three.js","CapCut","剪映","微信","TikTok","X","Telegram","Seedance","GPT Image","Qwen Image","Opus","PDF","pstack","Oil UI","OpenUI","Anatomy","PayPal","Stripe","Z-Library","Gmail","WPS Office","giffgaff","ComfyUI","Devin","MCP","GSD","Pi-Agent","arXiv","YouTube","B 站","小红书","Discord","Spline","Excalidraw","MarkItDown","OpenRouter","Figma","Notion","Grok Imagine","OpenMuse","Leviathan","Y2A-Auto","WeChat Clean","narrator-ai-cli","agent-browser","open-slide","Supervisor-Skills","book-to-skill","PentAGI","OpenDesign Motion","ClawPal","Galaxy","TLDraw","fsearch","Kami","DeepSeek Bot","EmbeddingGemma","Indra OCR","PixelRAG","Pingora","bitnet","OpenMontage","ip-as-logo","component-canvas","harness-creator","adversarial-review","everything-claude-code","keep-codex-fast","baoyu-infographic","claude-init","pia","Serena","React Bits","Leon Sans","Wesight","iFlow CLI","CC Switch","Awesome LLM Apps","ProxyCast","Open Slide","Oh My PPT","Alook","Clawdbot","AI Edge","AgentKey","FFDownloadManager","WordCraft","Hallmark","Pele","Hub","Strata","HowToLiveBetter","Citations API","Cua Spaces SDK","SKY-001","PaperBanana","open-slide"]);
const COMPANY = new Set(["OpenAI","Anthropic","Google","Adobe","Microsoft","Apple","Meta","NVIDIA","Cloudflare","Vercel","腾讯","字节","百度","阿里","Hugging Face","Stanford","MIT","Harvard","MiniMax","Epic Games","Twitter","Amazon","Netflix","小米","阿里千问","Z.ai","机器之心","Carnegie Mellon","莱顿大学","Z Library"]);
const PERSON = new Set(["Karpathy","Sam Altman","Andrew Ng","Dario Amodei","DHH","Jack Dorsey","Jeff Dean","Demis Hassabis","Lauren Tan","PewDiePie","马斯克","宝玉","李博杰","Thariq","Mr.doob","花叔","bcherny","steipete","poteto","Matt Pocock","Felix","Chovy","Diogo Almeida","Boris Cherny"]);

function typeOf(name) {
  if (PERSON.has(name)) return "person";
  if (COMPANY.has(name)) return "company";
  if (PRODUCT.has(name)) return "project";
  return "concept";
}

function canonicalName(raw) {
  return raw.trim().replace(/\s+/g, " ").replace(/[\p{P}\p{S}]+/gu, " ").trim().toLowerCase().replace(/\s+/g, " ");
}

function loadBatches() {
  const all = {};
  let batches = 0;
  for (let i = 1; i <= 12; i++) {
    const f = `D:/shujia/entity-out-${i}.json`;
    if (!fs.existsSync(f)) continue;
    let s = fs.readFileSync(f, "utf8").trim();
    if (!s.endsWith("}")) s += "\n}";
    let prev;
    do {
      prev = s;
      s = s.replace(/\[\s*\(/, "[");
      s = s.replace(/\)\s*,\s*\(/, ", ");
      s = s.replace(/\)\s*\]/, "]");
    } while (s !== prev);
    fs.writeFileSync(f, s);
    const j = JSON.parse(s);
    batches++;
    for (const [id, ents] of Object.entries(j)) {
      if (all[id]) continue;
      all[id] = ents
        .map((e) => {
          if (Array.isArray(e)) {
            const name = String(e[0]).trim();
            const type = TYPES.has(String(e[1])) ? String(e[1]) : typeOf(name);
            return [name, type];
          }
          const name = String(e).trim();
          return [name, typeOf(name)];
        })
        .filter(([n]) => n.length > 0 && n.length <= 60)
        .slice(0, 6);
    }
  }
  return { all, batches };
}

async function main() {
  const { all, batches } = loadBatches();
  console.log(`读取 ${batches} 个批次文件，覆盖 ${Object.keys(all).length} 篇`);

  const sql = neon(process.env.DATABASE_URL);
  const existing = await sql`select article_id from articles where user_id = ${UID} and deleted = false`;
  const existingSet = new Set(existing.map((r) => String(r.article_id)));
  const ghost = Object.keys(all).filter((id) => !existingSet.has(id));
  if (ghost.length) {
    console.log(`警告：${ghost.length} 个 id 不在库中（已跳过）`);
    for (const id of ghost) delete all[id];
  }

  let inserted = 0;
  const entries = Object.entries(all).filter(([, ents]) => ents.length > 0);
  for (let i = 0; i < entries.length; i += 40) {
    const slice = entries.slice(i, i + 40);
    const values = [];
    const params = [UID];
    let pi = 2;
    for (const [id, ents] of slice) {
      for (const [name, type] of ents) {
        const display = /^[a-z0-9]/.test(name) ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : name;
        values.push(`($1, $${pi}, $${pi + 1}, $${pi + 2}, $${pi + 3})`);
        params.push(id, name, type, display);
        pi += 4;
      }
    }
    if (!values.length) continue;
    await sql.query(
      `insert into entities (user_id, article_id, name, type, display)
       values ${values.join(",")}
       on conflict (user_id, article_id, name) do nothing`,
      params
    );
    inserted += values.length;
  }

  const stats = await sql`
    select count(*)::int as ent_rows,
           count(distinct name)::int as uniq,
           count(distinct article_id)::int as arts
    from entities where user_id = ${UID}`;
  const s = stats[0];
  console.log(`写入实体行 ${inserted}。表内总计：${s.ent_rows} 行 / ${s.uniq} 个唯一实体 / 覆盖 ${s.arts} 篇文章`);

  const top = await sql`
    select coalesce(display, name) as label, count(*)::int as n
    from entities where user_id = ${UID}
    group by coalesce(display, name)
    order by n desc limit 12`;
  console.log("\n高频实体 Top 12:");
  for (const r of top) console.log(`  ${r.label}: ${r.n}`);
}

main().catch((e) => {
  console.error("失败:", e.message);
  process.exit(1);
});
