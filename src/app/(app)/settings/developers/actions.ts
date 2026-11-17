"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKeys, webhookEndpoints } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { generateApiKey } from "@/lib/api-auth";
import { deliver } from "@/lib/outgoing-webhooks";
import { EVENT_NAMES } from "@/lib/events";
import { assertPermission } from "@/lib/permissions";

const PATH = "/settings/developers";

export async function createApiKey(fd: FormData): Promise<{ ok: boolean; message: string; key?: string }> {
  const me = await assertPermission("settings.developers");
  const name = String(fd.get("name") ?? "").trim().slice(0, 191);
  if (!name) return { ok: false, message: "Give the key a name." };
  const k = generateApiKey();
  await db.insert(apiKeys).values({ name, prefix: k.prefix, keyHash: k.hash, createdBy: me.id });
  revalidatePath(PATH);
  return { ok: true, message: "Created.", key: k.key };
}

export async function revokeApiKey(id: string) {
  await assertPermission("settings.developers");
  await db.delete(apiKeys).where(eq(apiKeys.id, id));
  revalidatePath(PATH);
}

function parseEndpoint(fd: FormData): { url: string; events: string[]; active: boolean } | null {
  const url = String(fd.get("url") ?? "").trim();
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  } catch {
    return null;
  }
  const events = fd.getAll("events").map(String).filter((e) => (EVENT_NAMES as string[]).includes(e));
  return { url: url.slice(0, 500), events, active: fd.get("active") === "on" };
}

export async function createWebhook(fd: FormData) {
  await assertPermission("settings.developers");
  const p = parseEndpoint(fd);
  if (!p) redirect(`${PATH}?error=url`);
  if (!p.events.length) redirect(`${PATH}?error=events`);
  await db.insert(webhookEndpoints).values({ url: p.url, events: p.events, active: true, secret: "whsec_" + randomToken(24) });
  revalidatePath(PATH);
  redirect(`${PATH}?saved=webhook`);
}

export async function updateWebhook(id: string, fd: FormData) {
  await assertPermission("settings.developers");
  const p = parseEndpoint(fd);
  if (!p) redirect(`${PATH}?error=url`);
  if (!p.events.length) redirect(`${PATH}?error=events`);
  await db.update(webhookEndpoints).set(p).where(eq(webhookEndpoints.id, id));
  revalidatePath(PATH);
  redirect(`${PATH}?saved=webhook`);
}

export async function rotateWebhookSecret(id: string) {
  await assertPermission("settings.developers");
  await db.update(webhookEndpoints).set({ secret: "whsec_" + randomToken(24) }).where(eq(webhookEndpoints.id, id));
  revalidatePath(PATH);
}

export async function deleteWebhook(id: string) {
  await assertPermission("settings.developers");
  await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id));
  revalidatePath(PATH);
}

export async function testWebhook(id: string): Promise<{ ok: boolean; message: string }> {
  await assertPermission("settings.developers");
  const [ep] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).limit(1);
  if (!ep) return { ok: false, message: "Endpoint not found." };
  const r = await deliver(ep, "test", { message: "This is a test event from Shraddha Message." });
  revalidatePath(PATH);
  return r.ok ? { ok: true, message: `Delivered (HTTP ${r.status}).` } : { ok: false, message: r.error };
}
