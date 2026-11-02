import type { Metadata } from "next";
import { AuthShell } from "@/components/account/AuthShell";
import { ResetForm } from "@/components/account/ResetForm";

export const metadata: Metadata = { title: "Reset password · Orivell", alternates: { canonical: "/reset-password" } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell mode="in">
      <ResetForm token={token ?? ""} />
    </AuthShell>
  );
}
