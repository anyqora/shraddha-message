"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { authTokens, sessions, users } from "@/db/schema";
import { requireAdmin, requireUser } from "@/lib/auth";
import { saveSettings } from "@/lib/settings";
import { hashPassword, verifyPassword } from "@/lib/password";
import { errorMessage, waClient } from "@/lib/whatsapp";
import { randomToken } from "@/lib/crypto";
import { actionEmail, mailConfigured, sendMail } from "@/lib/mailer";
import { createAuthToken } from "@/app/reset-password/tokens";
import { assertPermission, GRANTABLE_ROLES, ALL_PERMISSION_KEYS, type Role } from "@/lib/permissions";
import type { User } from "@/db/schema";
import { audit } from "@/lib/audit";

type Result = { ok: boolean; message: string; link?: string };

export async function saveWhatsApp(fd: FormData) {
  await assertPermission("settings.whatsapp");
  await audit("settings.update", { entity: "settings", summary: "WhatsApp settings" });
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const patch: Record<string, string | number> = {
    waPhoneNumberId: s("waPhoneNumberId"),
    waBusinessAccountId: s("waBusinessAccountId"),
    waAppId: s("waAppId"),
    waVerifyToken: s("waVerifyToken") || randomToken(18),
    waApiVersion: s("waApiVersion") || "v22.0",
    defaultCountryCode: s("defaultCountryCode").replace(/\D/g, "") || "91",
    throttlePerMinute: Math.min(1000, Math.max(1, Number(s("throttlePerMinute")) || 60)),
  };
  // Secrets: keep the stored value when the field is left blank.
  if (s("waAccessToken")) patch.waAccessToken = s("waAccessToken");
  if (s("waAppSecret")) patch.waAppSecret = s("waAppSecret");
  await saveSettings(patch);
  revalidatePath("/", "layout");
  redirect("/settings?saved=1");
}

export async function testWhatsApp(): Promise<{ ok: boolean; message: string }> {
  await assertPermission("settings.whatsapp");
  try {
    const wa = await waClient();
    const info = await wa.phoneInfo();
    await saveSettings({ waDisplayPhone: info.display_phone_number });
    return { ok: true, message: `Connected: ${info.verified_name} (${info.display_phone_number}) · quality ${info.quality_rating ?? "n/a"}` };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

export async function addUser(fd: FormData) {
  const me = await assertPermission("settings.team");
  await audit("user.create", { entity: "users", summary: String(fd.get("email") ?? "") });
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!email || password.length < 8) redirect("/settings/team?error=user");
  try {
    await db.insert(users).values({
      email,
      name: String(fd.get("name") ?? "").trim(),
      role: roleFor(me, fd.get("role")),
      passwordHash: await hashPassword(password),
    });
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY") redirect("/settings/team?error=dup");
    throw e;
  }
  revalidatePath("/settings/team");
  redirect("/settings/team?saved=user");
}

export async function removeUser(id: string) {
  const me = await assertPermission("settings.team");
  await audit("user.delete", { entity: "users", entityId: id });
  if (id === me.id) return;
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(users).where(eq(users.role, "admin"));
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (u?.role === "admin" && (Number(n) <= 1 || me.role !== "admin")) return;
  await db.delete(sessions).where(eq(sessions.userId, id));
  await db.delete(users).where(eq(users.id, id));
  await db.delete(authTokens).where(eq(authTokens.userId, id));
  revalidatePath("/settings/team");
}

export async function changeMyAccount(fd: FormData) {
  const me = await requireUser();
  const current = String(fd.get("current") ?? "");
  if (!(await verifyPassword(current, me.passwordHash))) redirect("/settings/account?error=pw");
  const email = String(fd.get("email") ?? "").trim().toLowerCase() || me.email;
  const name = String(fd.get("name") ?? "").trim();
  const next = String(fd.get("password") ?? "");
  if (next && next.length < 8) redirect("/settings/account?error=short");
  try {
    await db
      .update(users)
      .set({ email, name, ...(next ? { passwordHash: await hashPassword(next) } : {}) })
      .where(eq(users.id, me.id));
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY") redirect("/settings/account?error=dup");
    throw e;
  }
  revalidatePath("/", "layout");
  redirect("/settings/account?saved=me");
}

/** Role from a form value; only admins may hand out the admin role. */
function roleFor(me: User, v: FormDataEntryValue | null): Role {
  if (v === "admin" && me.role === "admin") return "admin";
  return v === "manager" ? "manager" : "agent";
}

export async function setUserRole(userId: string, next: string): Promise<Result> {
  const me = await assertPermission("settings.team");
  await audit("user.role", { entity: "users", entityId: userId, summary: next });
  if (next !== "admin" && next !== "manager" && next !== "agent") return { ok: false, message: "Unknown role." };
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return { ok: false, message: "User not found." };
  if (u.role === next) return { ok: true, message: "" };
  if (me.role !== "admin" && (u.role === "admin" || next === "admin")) return { ok: false, message: "Only admins can change admin roles." };
  if (u.role === "admin") {
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(users).where(eq(users.role, "admin"));
    if (Number(n) <= 1) return { ok: false, message: "Keep at least one admin." };
  }
  await db.update(users).set({ role: next }).where(eq(users.id, userId));
  revalidatePath("/", "layout");
  return { ok: true, message: "Role updated." };
}

export async function savePermissions(fd: FormData) {
  await requireAdmin();
  await audit("settings.permissions", { entity: "settings" });
  const grants = Object.fromEntries(
    GRANTABLE_ROLES.map((r) => [r, ALL_PERMISSION_KEYS.filter((k) => fd.get(`perm:${r}:${k}`) === "on")]),
  );
  await saveSettings({ permissions: JSON.stringify(grants), agentSeesOnlyOwnChats: fd.get("agentSeesOnlyOwnChats") === "on" });
  revalidatePath("/", "layout");
  redirect("/settings/team?saved=perms");
}

/* ------------------------------------------------------------ team: invites + reset links */

export async function createResetLink(userId: string): Promise<Result> {
  const me = await assertPermission("settings.team");
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return { ok: false, message: "User not found." };
  if (u.role === "admin" && me.role !== "admin") return { ok: false, message: "Only admins can reset an admin's password." };
  const { url } = await createAuthToken({ kind: "reset", email: u.email, userId: u.id });
  return { ok: true, message: "Valid for 1 hour.", link: url };
}

export async function createInvite(fd: FormData): Promise<Result> {
  const me = await assertPermission("settings.team");
  await audit("user.invite", { entity: "auth_tokens", summary: String(fd.get("email") ?? "") });
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  // invite links can only carry admin|agent (auth_tokens.role); promote to manager after they join
  const role = roleFor(me, fd.get("role")) === "admin" ? "admin" : "agent";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Enter a valid email." };
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
  if (exists) return { ok: false, message: "That email already has an account." };
  // replace any older pending invite for the same email
  await db.delete(authTokens).where(and(eq(authTokens.kind, "invite"), eq(authTokens.email, email)));
  const { url } = await createAuthToken({ kind: "invite", email, role });
  let message = "Invite created — copy the link below.";
  if (await mailConfigured()) {
    const appName = process.env.APP_NAME || "Shraddha Message";
    const mail = actionEmail({
      heading: `You're invited to ${appName}`,
      intro: `${me.name || me.email} invited you to join ${appName} as ${role === "admin" ? "an admin" : "an agent"}. The link is valid for 7 days.`,
      cta: "Accept invite",
      url,
    });
    const r = await sendMail({ to: email, subject: `You're invited to ${appName}`, ...mail });
    message = r.ok ? `Invite emailed to ${email}.` : `Invite created, but the email failed: ${r.error}`;
  }
  revalidatePath("/settings/team");
  return { ok: true, message, link: url };
}

export async function revokeInvite(id: string) {
  await assertPermission("settings.team");
  await db.delete(authTokens).where(and(eq(authTokens.id, id), eq(authTokens.kind, "invite")));
  revalidatePath("/settings/team");
}

/* ------------------------------------------------------------ email (SMTP) */

export async function saveEmail(fd: FormData) {
  await assertPermission("settings.email");
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const patch: Record<string, string | number> = {
    smtpHost: s("smtpHost"),
    smtpPort: Math.min(65535, Math.max(1, Number(s("smtpPort")) || 587)),
    smtpUser: s("smtpUser"),
    smtpFrom: s("smtpFrom"),
  };
  if (s("smtpPass")) patch.smtpPass = s("smtpPass");
  await saveSettings(patch);
  revalidatePath("/settings/email");
  redirect("/settings/email?saved=1");
}

export async function testEmail(): Promise<Result> {
  const me = await assertPermission("settings.email");
  const appName = process.env.APP_NAME || "Shraddha Message";
  const r = await sendMail({
    to: me.email,
    subject: `${appName}: test email`,
    text: "SMTP is working. You'll receive password-reset and invite emails from this address.",
    html: "<p>SMTP is working. You'll receive password-reset and invite emails from this address.</p>",
  });
  return r.ok ? { ok: true, message: `Sent to ${me.email}.` } : { ok: false, message: r.error ?? "Failed." };
}
