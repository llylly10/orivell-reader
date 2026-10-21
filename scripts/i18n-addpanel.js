/**
 * AddPanel: translate the visible strings. Done as a scripted edit because
 * the file has many small strings and a missed one shows as English on screen.
 */
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "components", "library", "AddPanel.tsx");
const raw = fs.readFileSync(FILE, "utf8");
const CRLF = raw.includes("\r\n");
// Work in LF so the patterns below can be written with plain newlines, then put the file back.
let src = raw.replace(/\r\n/g, "\n");

/** Each pair: the exact source text, the call that replaces it. */
const subs = [
  // imports
  [`import { Glyph } from "./Book";`, `import { Glyph } from "./Book";\nimport { useT } from "@/lib/lang-context";`],

  // panel header
  [`  }, [onClose]);

  return createPortal(`, `  }, [onClose]);

  const t = useT();

  return createPortal(`],
  [`aria-label="Add to the library"`, `aria-label={t("add.dialogLabel")}`],
  [`aria-label="Add"\n            >`, `aria-label={t("add.tabAria")}\n            >`],
  [`              Connect an agent\n            </button>`, `              {t("add.tabAgent")}\n            </button>`],
  [`              Save links manually\n            </button>`, `              {t("add.tabLinks")}\n            </button>`],
  [`aria-label="Close" data-tip="Close" data-tip-kbd="Esc"`, `aria-label={t("common.close")} data-tip={t("common.close")} data-tip-kbd="Esc"`],

  // AddButton
  [`        <span className="lib-add-title">Add articles</span>
        {!compact && <span className="lib-add-sub">Connect an agent, or paste links</span>}`,
   `        <span className="lib-add-title">{t("lib.addArticles")}</span>
        {!compact && <span className="lib-add-sub">{t("lib.addArticlesHint")}</span>}`],

  // Links: intro
  [`      <p className="text-[19px] font-serif leading-tight text-ink">Save links to your library</p>
      <p className="mt-1 text-[13px] text-ink-3">
        One or many, a line each. Gloss reads each page in and sorts it onto a topic. PDFs work too. Leaving Pocket, Instapaper or Raindrop?{" "}
        <button type="button" onClick={() => fileRef.current?.click()} className="text-ink-2 underline decoration-rule-strong underline-offset-2 hover:text-ink">
          Drop its export here
        </button>
        .
      </p>`,
   `      <p className="text-[19px] font-serif leading-tight text-ink">{t("add.title")}</p>
      <p className="mt-1 text-[13px] text-ink-3">
        {t("add.blurb")}{" "}
        <button type="button" onClick={() => fileRef.current?.click()} className="text-ink-2 underline decoration-rule-strong underline-offset-2 hover:text-ink">
          {t("add.dropExport")}
        </button>
        {t("add.dropExportTail")}
      </p>`],
  [`        aria-label="Links to save"`, `        aria-label={t("add.linksLabel")}`],
  [`        <span className="text-[12.5px] text-ink-4">{urls.length ? \`\${urls.length} link\${urls.length === 1 ? "" : "s"}\` : text.trim() ? "No links found yet" : ""}</span>
        <button type="button" onClick={save} disabled={!urls.length || busy} className="add-btn">
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy ? "Saving" : urls.length > 1 ? \`Save \${Math.min(urls.length, BATCH)}\` : "Save"}
        </button>`,
   `        <span className="text-[12.5px] text-ink-4">{urls.length ? t("add.linkCount", { n: urls.length }) : text.trim() ? t("add.noLinksYet") : ""}</span>
        <button type="button" onClick={save} disabled={!urls.length || busy} className="add-btn">
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy ? t("add.saving") : urls.length > 1 ? t("add.saveN", { n: Math.min(urls.length, BATCH) }) : t("add.save")}
        </button>`],
  [`                  {r.state === "saved" ? "On the shelf" : r.state === "already" ? "Already in your library" : r.state === "failed" ? r.error : r.state === "reading" ? "Reading" : "Waiting"}`,
   `                  {r.state === "saved" ? t("add.onShelf") : r.state === "already" ? t("add.alreadyIn") : r.state === "failed" ? r.error : r.state === "reading" ? t("add.statusReading") : t("add.statusWaiting")}`],
  [`    if (!found.length) return setNote(\`No links found in \${f.name}.\`);
    setText((cur) => [cur.trim(), ...found].filter(Boolean).join("\\n"));
    setNote(\`Found \${found.length} link\${found.length === 1 ? "" : "s"} in \${f.name}.\`);`,
   `    if (!found.length) return setNote(t("add.noLinksInFile", { file: f.name }));
    setText((cur) => [cur.trim(), ...found].filter(Boolean).join("\\n"));
    setNote(t("add.foundLinks", { n: found.length, file: f.name }));`],
  [`    setNote(
      all.length > BATCH
        ? [rest.length ? \`Saving \${BATCH} now; \${rest.length} more wait above for the next Save.\` : \`Saving \${fresh.length}.\`, known ? \`\${known} already in your library.\` : ""].filter(Boolean).join(" ")
        : null
    );`,
   `    setNote(
      all.length > BATCH
        ? [rest.length ? t("add.savingBatch", { done: BATCH, rest: rest.length }) : t("add.savingN", { n: fresh.length }), known ? t("add.alreadyCount", { n: known }) : ""].filter(Boolean).join(" ")
        : null
    );`],
  [`  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);`,
   `  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const t = useT();
  useEffect(() => ref.current?.focus(), []);`],

  // Bookmarklets
  [`  useEffect(() => {
    readRef.current?.setAttribute("href", code("url"));
    saveRef.current?.setAttribute("href", code("save"));
  });`,
   `  useEffect(() => {
    readRef.current?.setAttribute("href", code("url"));
    saveRef.current?.setAttribute("href", code("save"));
  });
  const t = useT();`],
  [`      <p className="lib-label">From any page</p>
      <p className="mt-1 text-[13px] text-ink-3">Drag one to your bookmarks bar, then click it on any article.</p>`,
   `      <p className="lib-label">{t("add.bookmarklets")}</p>
      <p className="mt-1 text-[13px] text-ink-3">{t("add.bookmarkletsHint")}</p>`],
  [`        <a ref={readRef} onClick={(e) => e.preventDefault()} data-tip="Drag me to your bookmarks bar" className={pill}>
          <BookOpen size={14} className="text-ink-3" /> Read in Gloss
        </a>
        <a ref={saveRef} onClick={(e) => e.preventDefault()} data-tip="Drag me to your bookmarks bar" className={pill}>
          <BookmarkPlus size={14} className="text-ink-3" /> Save to Gloss
        </a>`,
   `        <a ref={readRef} onClick={(e) => e.preventDefault()} data-tip={t("add.dragMe")} className={pill}>
          <BookOpen size={14} className="text-ink-3" /> {t("add.readInGloss")}
        </a>
        <a ref={saveRef} onClick={(e) => e.preventDefault()} data-tip={t("add.dragMe")} className={pill}>
          <BookmarkPlus size={14} className="text-ink-3" /> {t("add.saveToGloss")}
        </a>`],
  [`        <summary className="cursor-pointer select-none hover:text-ink-2">On a phone</summary>
        <div className="mt-2">
          <CopyBlock title="Bookmark any page, then edit the bookmark" body="Paste this as its address and name it Save to Gloss." text={code("save")} />
        </div>`,
   `        <summary className="cursor-pointer select-none hover:text-ink-2">{t("add.onPhone")}</summary>
        <div className="mt-2">
          <CopyBlock title={t("add.phoneTitle")} body={t("add.phoneHint")} text={code("save")} />
        </div>`],

  // Agent: signed out
  [`        <AgentIntro />
        <p className="mt-4 text-[13.5px] text-ink-2">An agent saves to the library in your account, so it needs you signed in.</p>
        <SignInButton mode="modal">
          <button type="button" className="add-btn mt-4">
            Sign in to connect
          </button>
        </SignInButton>`,
   `        <AgentIntro />
        <p className="mt-4 text-[13.5px] text-ink-2">{t("add.needsSignIn")}</p>
        <SignInButton mode="modal">
          <button type="button" className="add-btn mt-4">
            {t("add.signInToConnect")}
          </button>
        </SignInButton>`],
  [`  const origin = typeof window !== "undefined" ? window.location.origin : "https://usegloss.io";`,
   `  const origin = typeof window !== "undefined" ? window.location.origin : "https://usegloss.io";
  const t = useT();`],
  [`    if (!res.ok || !j.token || !j.id) return setErr(j.error ?? "Could not make a connection. Try again.");`,
   `    if (!res.ok || !j.token || !j.id) return setErr(j.error ?? t("add.connFailed"));`],
  [`          <div className="lib-sort !ml-0" role="radiogroup" aria-label="Which agent">`,
   `          <div className="lib-sort !ml-0" role="radiogroup" aria-label={t("add.whichAgent")}>`],
  [`            Make a connection
          </button>`, `            {t("add.makeConnection")}
          </button>`],
  [`          <p className="lib-label">Connected</p>`, `          <p className="lib-label">{t("add.connected")}</p>`],
  [`                    {c.lastUsedAt ? \`last used \${new Date(c.lastUsedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}\` : "not used yet"}`,
   `                    {c.lastUsedAt ? t("add.lastUsed", { date: new Date(c.lastUsedAt).toLocaleDateString(locale, { day: "numeric", month: "short" }) }) : t("add.notUsedYet")}`],
  [`                  <Trash2 size={13} /> Revoke`, `                  <Trash2 size={13} /> {t("add.revoke")}`],

  // AgentIntro
  [`function AgentIntro() {
  return (
    <div className="flex items-start gap-3.5">
      <Glyph k="agent" size={46} className="shrink-0" />
      <div>
        <p className="font-serif text-[19px] leading-tight text-ink">Let your agent shelve for you</p>
        <p className="mt-1 text-[13px] leading-[1.5] text-ink-3">
          Gloss has an MCP server. Give it to Grok Bot, Claude or ChatGPT, then ask: &ldquo;go through my X bookmarks from this month and save the articles to my Gloss library.&rdquo; Each one is read in, sorted onto a topic, and on your shelves the next time you open Gloss.
        </p>
      </div>
    </div>
  );
}`,
   `function AgentIntro() {
  const t = useT();
  return (
    <div className="flex items-start gap-3.5">
      <Glyph k="agent" size={46} className="shrink-0" />
      <div>
        <p className="font-serif text-[19px] leading-tight text-ink">{t("add.agentShelve")}</p>
        <p className="mt-1 text-[13px] leading-[1.5] text-ink-3">{t("add.agentIntro")}</p>
      </div>
    </div>
  );
}`],

  // Setup
  [`      <p className="text-[13px] text-good">Made. This token is shown once: copy it now.</p>`,
   `      <p className="text-[13px] text-good">{t("add.tokenOnce")}</p>`],
  [`      <CopyBlock title="Then ask it something like" body="Agents save the article a post links to. When the post is the piece, like an X Article or a long post, they send its text." text={PROMPT} />`,
   `      <CopyBlock title={t("add.thenAsk")} body={t("add.thenAskBody")} text={PROMPT} />`],
  [`function CopyBlock({ title, body, text }: { title: string; body: string; text: string }) {
  const [copied, setCopied] = useState(false);`,
   `function CopyBlock({ title, body, text }: { title: string; body: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();`],
  [`          {copied ? "Copied" : "Copy"}`, `          {copied ? t("common.copied") : t("common.copy")}`],
];

let missed = [];
for (const [from, to] of subs) {
  if (!src.includes(from)) {
    missed.push(from.slice(0, 70));
    continue;
  }
  src = src.replace(from, to);
}

fs.writeFileSync(FILE, CRLF ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log(`applied ${subs.length - missed.length}/${subs.length}`);
if (missed.length) {
  console.log("MISSED:");
  missed.forEach((m) => console.log("  -", JSON.stringify(m)));
  process.exit(1);
}