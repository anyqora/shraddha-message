import "server-only";
import nodemailer from "nodemailer";
import { getSettings, type AppSettings } from "./settings";

export function mailConfiguredFrom(s: AppSettings): boolean {
  return Boolean(s.smtpHost && s.smtpFrom);
}

export async function mailConfigured(): Promise<boolean> {
  return mailConfiguredFrom(await getSettings());
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const s = await getSettings();
  if (!mailConfiguredFrom(s)) return { ok: false, error: "SMTP is not configured (Settings → Email)." };
  try {
    const port = Number(s.smtpPort) || 587;
    const transport = nodemailer.createTransport({
      host: s.smtpHost,
      port,
      secure: port === 465,
      auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    await transport.sendMail({ from: s.smtpFrom, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Simple branded email with one call-to-action button. */
export function actionEmail(opts: { heading: string; intro: string; cta: string; url: string; footer?: string }) {
  const appName = process.env.APP_NAME || "Shraddha Message";
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#333">
<h2 style="font-size:18px;margin:0 0 12px">${esc(opts.heading)}</h2>
<p style="font-size:14px;line-height:20px">${esc(opts.intro)}</p>
<p style="margin:24px 0"><a href="${esc(opts.url)}" style="background:#1961ed;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;font-weight:600">${esc(opts.cta)}</a></p>
<p style="font-size:12px;color:#888;word-break:break-all">Or open this link: ${esc(opts.url)}</p>
${opts.footer ? `<p style="font-size:12px;color:#888">${esc(opts.footer)}</p>` : ""}
<p style="font-size:12px;color:#aaa">— ${esc(appName)}</p></div>`;
  const text = `${opts.heading}\n\n${opts.intro}\n\n${opts.cta}: ${opts.url}\n${opts.footer ? `\n${opts.footer}\n` : ""}`;
  return { html, text };
}
