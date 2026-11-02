/**
 * Where mail goes. With RESEND_FROM set to an address on a verified domain,
 * mail arrives in a real inbox. Without it, Resend's test address delivers
 * only to the account's own email — enough to prove it works, not enough to
 * reach a friend.
 */
const FROM = process.env.RESEND_FROM || "onboarding@resend.dev";

export type OutgoingMail = { to: string; subject: string; html: string };

/**
 * One email via Resend's REST API — no SDK, one fetch. Returns whether it
 * actually went out; without RESEND_API_KEY nothing is sent and nothing throws,
 * so callers can stay fire-and-forget.
 */
export async function sendMail(mail: OutgoingMail): Promise<{ sent: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "RESEND_API_KEY is not set." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [mail.to], subject: mail.subject, html: mail.html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { sent: false, reason: `Resend answered ${res.status}.` };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "send failed." };
  }
}
