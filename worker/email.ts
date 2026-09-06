import type { Env } from "./env";

type AuthEmail = {
  readonly to: string;
  readonly subject: string;
  readonly heading: string;
  readonly copy: string;
  readonly action: string;
  readonly url: string;
};

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[
        character
      ]!,
  );
}

export async function sendAuthEmail(env: Env, message: AuthEmail) {
  if (!env.RESEND_API_KEY) {
    const hostname = env.BETTER_AUTH_URL ? new URL(env.BETTER_AUTH_URL).hostname : "";
    if (hostname === "0.0.0.0" || hostname === "127.0.0.1" || hostname === "localhost") {
      console.info(`[auth-email] ${message.subject} for ${message.to}: ${message.url}`);
      return;
    }
    throw new Error("RESEND_API_KEY is required for deployed account emails.");
  }
  if (!env.AUTH_EMAIL_FROM) throw new Error("AUTH_EMAIL_FROM is required for account emails.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.AUTH_EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: `${message.copy}\n\n${message.action}: ${message.url}\n\nThis link expires. If you did not request it, you can ignore this email.`,
      html: `<!doctype html><html><body style="margin:0;background:#f3efe7;color:#18221d;font-family:Arial,sans-serif"><div style="max-width:560px;margin:40px auto;padding:32px;background:#fff;border-radius:18px"><p style="font-size:12px;letter-spacing:.14em;font-weight:700;color:#617067">LINER RADIO</p><h1 style="font-size:28px">${escapeHtml(message.heading)}</h1><p style="font-size:16px;line-height:1.6">${escapeHtml(message.copy)}</p><p style="margin:28px 0"><a href="${escapeHtml(message.url)}" style="display:inline-block;padding:13px 20px;border-radius:999px;background:#18221d;color:#fff;text-decoration:none;font-weight:700">${escapeHtml(message.action)}</a></p><p style="font-size:13px;line-height:1.5;color:#617067">This link expires. If you did not request it, you can ignore this email.</p></div></body></html>`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Email delivery failed with status ${response.status}.`);
  }
}
