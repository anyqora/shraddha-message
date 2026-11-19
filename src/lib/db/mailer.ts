import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'

/**
 * Auth emails (signup confirm, password recovery, invite, email change) over SMTP_URL.
 * Without SMTP_URL the link is logged to the server console (same as the staging fork).
 */
export type AuthEmailKind = 'signup' | 'recovery' | 'invite' | 'email_change'

const COPY: Record<AuthEmailKind, { subject: string; lead: string; cta: string }> = {
  signup: { subject: 'Confirm your email', lead: 'Confirm your email address to finish creating your account.', cta: 'Confirm email' },
  recovery: {
    subject: 'Reset your password',
    lead: "Someone asked to reset the password for this account. If it was you, continue below.",
    cta: 'Reset password',
  },
  invite: { subject: 'You have been invited', lead: 'You have been invited to join a workspace.', cta: 'Accept invite' },
  email_change: { subject: 'Confirm your new email', lead: 'Confirm this address to finish changing your email.', cta: 'Confirm new email' },
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

let transport: Transporter | null | undefined

function getTransport(): Transporter | null {
  if (transport !== undefined) return transport
  transport = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null
  return transport
}

export async function sendAuthEmail(kind: AuthEmailKind, to: string, link: string) {
  const app = process.env.APP_NAME || 'Anyqora'
  const c = COPY[kind]
  const t = getTransport()
  if (!t) {
    console.info(`[auth] ${kind} link for ${to} (no SMTP_URL configured):\n  ${link}`)
    return
  }
  await t.sendMail({
    from: process.env.SMTP_FROM || `${app} <no-reply@localhost>`,
    to,
    subject: `${c.subject} — ${app}`,
    text: `${c.lead}\n\n${link}\n\nIf you didn't request this, you can ignore this email.`,
    html: `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#333">
      <p>${esc(c.lead)}</p>
      <p><a href="${esc(link)}" style="display:inline-block;padding:8px 14px;border-radius:6px;background:#333;color:#fff;text-decoration:none">${esc(c.cta)}</a></p>
      <p style="color:#999;font-size:12px">If you didn't request this, you can ignore this email.</p></div>`,
  })
}
