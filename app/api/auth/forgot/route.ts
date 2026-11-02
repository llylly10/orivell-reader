import { createResetToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { allow, clientId } from "@/lib/ratelimit";
import { SITE_URL } from "@/lib/brand";

export const runtime = "nodejs";

/** Always answers ok, whether or not the email exists — the response must not
 *  become a way to check who has an account. Mail goes out only for real ones. */
export async function POST(req: Request) {
  if (!allow(`forgot:${clientId(req)}`, 5, 60_000)) {
    return Response.json({ error: "Too many tries. Wait a minute." }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as { email?: string };
  const email = String(body.email ?? "").trim().toLowerCase();

  if (!process.env.RESEND_API_KEY) {
    // System-level fact, not account-level: safe to tell the caller.
    return Response.json({
      ok: true,
      notice: "邮件服务未配置（RESEND_API_KEY）。请在服务器上运行 scripts/reset-password.mjs 重置密码。",
    });
  }

  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    const u = await db().query("select id from users where email = $1", [email]);
    if (u.length) {
      const token = await createResetToken(u[0].id as string);
      const link = `${SITE_URL}/reset-password?token=${token}`;
      await sendMail({
        to: email,
        subject: "Orivell · 重置密码",
        html: `<div style="font-family:Georgia,'Songti SC',serif;max-width:560px;margin:0 auto;color:#1f1d1a;">
  <p style="font-size:13px;color:#8a857c;margin:24px 0 0;">Orivell</p>
  <h1 style="font-size:20px;font-weight:500;margin:4px 0 18px;">重置密码</h1>
  <p style="font-size:14.5px;line-height:1.7;margin:0 0 20px;">有人（希望是你）请求重置这个邮箱的密码。链接 30 分钟内有效、只能用一次：</p>
  <p style="margin:0 0 24px;"><a href="${link}" style="color:#1f1d1a;font-size:15px;">设置新密码</a></p>
  <p style="font-size:12.5px;color:#8a857c;margin:0;">不是你本人请求的，忽略这封邮件即可，原密码不受影响。</p>
</div>`,
      });
    }
  }
  return Response.json({ ok: true });
}
