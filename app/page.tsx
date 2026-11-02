import type { Metadata } from "next";
import { currentUser } from "@/lib/session";
import { Landing } from "@/components/landing/Landing";

export const metadata: Metadata = { title: "Orivell", alternates: { canonical: "/" } };

export default async function Home() {
const me = await currentUser();
  const userId = me?.id ?? null;
  return <Landing signedIn={Boolean(userId)} />;
}
