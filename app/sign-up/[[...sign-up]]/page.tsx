import type { Metadata } from "next";
import { AuthForm } from "@/components/account/AuthForm";
import { AuthShell } from "@/components/account/AuthShell";

export const metadata: Metadata = { title: "Sign up · Orivell", alternates: { canonical: "/sign-up" } };

export default function SignUpPage() {
  return (
    <AuthShell mode="up">
      <AuthForm mode="up" />
    </AuthShell>
  );
}
