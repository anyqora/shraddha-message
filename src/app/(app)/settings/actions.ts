"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions, users } from "@/db/schema";
import { requireAdmin, requireUser } from "@/lib/auth";
import { saveSettings } from "@/lib/settings";
import { hashPassword, verifyPassword } from "@/lib/password";
import { errorMessage, waClient } from "@/lib/whatsapp";
import { randomToken } from "@/lib/crypto";

export async function saveWhatsApp(fd: FormData) {
  await requireAdmin();
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
  await requireUser();
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
  await requireAdmin();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!email || password.length < 8) redirect("/settings?error=user");
  try {
    await db.insert(users).values({
      email,
      name: String(fd.get("name") ?? "").trim(),
      role: fd.get("role") === "admin" ? "admin" : "agent",
      passwordHash: await hashPassword(password),
    });
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY") redirect("/settings?error=dup");
    throw e;
  }
  revalidatePath("/settings");
  redirect("/settings?saved=user");
}

export async function removeUser(id: string) {
  const me = await requireAdmin();
  if (id === me.id) return;
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(users).where(eq(users.role, "admin"));
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (u?.role === "admin" && Number(n) <= 1) return;
  await db.delete(sessions).where(eq(sessions.userId, id));
  await db.delete(users).where(eq(users.id, id));
  revalidatePath("/settings");
}

export async function changeMyAccount(fd: FormData) {
  const me = await requireUser();
  const current = String(fd.get("current") ?? "");
  if (!(await verifyPassword(current, me.passwordHash))) redirect("/settings?error=pw");
  const email = String(fd.get("email") ?? "").trim().toLowerCase() || me.email;
  const name = String(fd.get("name") ?? "").trim();
  const next = String(fd.get("password") ?? "");
  if (next && next.length < 8) redirect("/settings?error=short");
  try {
    await db
      .update(users)
      .set({ email, name, ...(next ? { passwordHash: await hashPassword(next) } : {}) })
      .where(eq(users.id, me.id));
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY") redirect("/settings?error=dup");
    throw e;
  }
  revalidatePath("/", "layout");
  redirect("/settings?saved=me");
}
