import type { Metadata } from "next";
import { AuthForm } from "@/components/account/AuthForm";
import { AuthShell } from "@/components/account/AuthShell";

export const metadata: Metadata = { title: "Sign in · Orivell", alternates: { canonical: "/sign-in" } };

export default function SignInPage() {
  return (
    <AuthShell mode="in">
      <AuthForm mode="in" />
    </AuthShell>
  );
}
