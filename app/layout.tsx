import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Atkinson_Hyperlegible_Next, Literata, Newsreader, Schibsted_Grotesk } from "next/font/google";
import { BOOT_SCRIPT } from "@/lib/settings";
import "./globals.css";
import { InlineScript } from "@/components/ui/InlineScript";
import { Tooltips } from "@/components/ui/Tooltips";
import { SyncAgent } from "@/components/account/SyncAgent";
import { SyncNotice } from "@/components/account/SyncNotice";
import { ViewerProvider } from "@/lib/viewer";
import { currentUser } from "@/lib/session";
import { OG_IMAGE, SITE_URL } from "@/lib/brand";
import { LangProvider } from "@/lib/lang-context";
import { DevPanel } from "@/components/ui/DevPanel";

const serif = Newsreader({
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  style: ["normal", "italic"],
  variable: "--nf-serif",
  display: "swap",
});

const sans = Schibsted_Grotesk({
  subsets: ["latin"],
  variable: "--nf-sans",
  display: "swap",
});

// Optional reading faces: declared here, fetched only when a reader picks them.
const book = Literata({
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  style: ["normal", "italic"],
  variable: "--nf-book",
  display: "swap",
  preload: false,
});

const legible = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  variable: "--nf-legible",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const DESCRIPTION = "Explore ideas, deeply. Highlight any line and ask it anything. An open model writes the answer in the margin, beside the words, citing the paragraphs it used.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Orivell", template: "%s" },
  description: DESCRIPTION,
  applicationName: "Orivell",
  openGraph: { type: "website", siteName: "Orivell", title: "Orivell", description: DESCRIPTION, url: "/", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", title: "Orivell", description: DESCRIPTION, images: [OG_IMAGE.url] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f3ec" },
    { media: "(prefers-color-scheme: dark)", color: "#151412" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await currentUser();
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${book.variable} ${legible.variable}`} suppressHydrationWarning>
      <head>
        <InlineScript html={BOOT_SCRIPT} />
      </head>
      <body>
        {/* The language provider sits above everything, so every string —
            including the sign-in form — follows the reader's choice. The
            viewer is seeded from the session server-side, so the top bar
            never flickers. */}
        <LangProvider>
          <ViewerProvider initial={{ id: me?.id ?? null, name: me?.name ?? null, email: me?.email ?? "", avatar: me?.avatar ?? null }}>
            {children}
            <SyncAgent />
            <SyncNotice />
            <DevPanel />
          </ViewerProvider>
        </LangProvider>
        <Tooltips />
        {/* Plausible: cookieless page views, from the production site only, so previews and local runs never count. */}
        {process.env.VERCEL_ENV === "production" && <Script defer data-domain="usegloss.io" src="https://plausible.io/js/script.js" strategy="afterInteractive" />}
      </body>
    </html>
  );
}
