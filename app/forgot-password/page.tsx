import type { Metadata } from "next";
import { AuthShell } from "@/components/account/AuthShell";
import { ForgotForm } from "@/components/account/ForgotForm";

export const metadata: Metadata = { title: "Forgot password · Orivell", alternates: { canonical: "/forgot-password" } };

export default function ForgotPasswordPage() {
  return (
    <AuthShell mode="in">
      <ForgotForm />
    </AuthShell>
  );
}
