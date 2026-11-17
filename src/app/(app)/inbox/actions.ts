"use server";

import { storeMedia } from "@/lib/media-store";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, mediaFiles, templates, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { errorMessage, waClient } from "@/lib/whatsapp";
import { recordOutbound } from "@/lib/messaging";
import { buildSendComponents, renderTemplatePreview } from "@/lib/template-utils";
import { pauseBot } from "@/lib/chatbot";
import { getSettings } from "@/lib/settings";
import { emit } from "@/lib/events";

const fileKind = (mime: string) =>
  mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "document";

/** Web-chat contacts: nothing goes to WhatsApp — files are stored and shared as a link. */
async function sendWebChat(contactId: string, text: string, file: File | null, userId: string): Promise<Result> {
  const s = await getSettings();
  if (file) {
    const maxMb = Math.max(1, s.mediaStoreMaxMb || 16);
    if (file.size > maxMb * 1024 * 1024) return { ok: false, message: `Files sent in web chat must be under ${maxMb} MB.` };
    const id = crypto.randomUUID();
    const name = (file.name || "file").slice(0, 255);
    const mime = (file.type || "application/octet-stream").slice(0, 128);
    await db.insert(mediaFiles).values({ id, mime, filename: name, size: file.size, data: Buffer.from(await file.arrayBuffer()) });
    const base = (process.env.APP_URL || "").replace(/\/+$/, "");
    const link = `${base}/api/widget/media/${id}`;
    const body = [text, `📎 ${name}: ${link}`].filter(Boolean).join("\n");
    // stored as text + link: the inbox media proxy only serves WhatsApp media ids
    await recordOutbound({ contactId, type: "text", body, status: "sent", sentBy: userId });
  } else {
    await recordOutbound({ contactId, type: "text", body: text, status: "sent", sentBy: userId });
  }
  await pauseBot(contactId, s.botPauseHours);
  revalidatePath(`/inbox/${contactId}`);
  return { ok: true, message: "" };
}

type Result = { ok: boolean; message: string };

async function contactOf(id: string) {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  if (!c) throw new Error("Contact not found");
  return c;
}

export async function sendChatMessage(contactId: string, _: unknown, fd: FormData): Promise<Result> {
  const user = await requireUser();
  const text = String(fd.get("text") ?? "").trim();
  const file = fd.get("file");
  const hasFile = file instanceof File && file.size > 0;
  if (!text && !hasFile) return { ok: false, message: "" };
  const c = await contactOf(contactId);
  if (c.channel === "web") return sendWebChat(contactId, text, hasFile ? (file as File) : null, user.id);
  let wa;
  try {
    wa = await waClient();
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
  try {
    if (hasFile) {
      const f = file as File;
      const type = fileKind(f.type);
      const mediaId = await wa.uploadMedia(f, f.name);
      await storeMedia(mediaId, f.type || "application/octet-stream", f.name, Buffer.from(await f.arrayBuffer())).catch(() => {});
      const wamid = await wa.sendMedia(c.phone, type, mediaId, text, f.name);
      await recordOutbound({ contactId, type, body: text, media: { id: mediaId, mime: f.type, filename: f.name, caption: text }, wamid, status: "sent", sentBy: user.id });
    } else {
      const wamid = await wa.sendText(c.phone, text);
      await recordOutbound({ contactId, type: "text", body: text, wamid, status: "sent", sentBy: user.id });
    }
  } catch (e) {
    const msg = errorMessage(e);
    await recordOutbound({ contactId, type: hasFile ? "document" : "text", body: text, status: "failed", error: msg, sentBy: user.id });
    revalidatePath(`/inbox/${contactId}`);
    return { ok: false, message: msg };
  }
  await pauseBot(contactId, (await getSettings()).botPauseHours);
  revalidatePath(`/inbox/${contactId}`);
  return { ok: true, message: "" };
}

export async function toggleBot(contactId: string, paused: boolean) {
  await requireUser();
  if (paused) await pauseBot(contactId, (await getSettings()).botPauseHours);
  else await db.update(contacts).set({ botPausedUntil: null }).where(eq(contacts.id, contactId));
  revalidatePath(`/inbox/${contactId}`);
}

export async function sendChatTemplate(contactId: string, templateId: string, params: { header: string[]; body: string[] }): Promise<Result> {
  const user = await requireUser();
  const c = await contactOf(contactId);
  const [t] = await db.select().from(templates).where(eq(templates.id, templateId)).limit(1);
  if (!t) return { ok: false, message: "Template not found" };
  const body = renderTemplatePreview(t.components, params);
  if (c.channel === "web") {
    await recordOutbound({ contactId, type: "text", body, templateName: t.name, status: "sent", sentBy: user.id });
    revalidatePath(`/inbox/${contactId}`);
    return { ok: true, message: "" };
  }
  try {
    const wa = await waClient();
    const wamid = await wa.sendTemplate(c.phone, t.name, t.language, buildSendComponents(t.components, params));
    await recordOutbound({ contactId, type: "template", body, templateName: t.name, wamid, status: "sent", sentBy: user.id });
  } catch (e) {
    const msg = errorMessage(e);
    await recordOutbound({ contactId, type: "template", body, templateName: t.name, status: "failed", error: msg, sentBy: user.id });
    revalidatePath(`/inbox/${contactId}`);
    return { ok: false, message: msg };
  }
  revalidatePath(`/inbox/${contactId}`);
  return { ok: true, message: "" };
}

export async function assignChat(contactId: string, userId: string | null) {
  const me = await requireUser();
  if (userId) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new Error("User not found");
  }
  await db.update(contacts).set({ assignedTo: userId }).where(eq(contacts.id, contactId));
  await emit({ name: "chat.assigned", contactId, userId, byUserId: me.id });
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${contactId}`);
}

export async function assignChatToMe(contactId: string) {
  const user = await requireUser();
  await db.update(contacts).set({ assignedTo: user.id }).where(eq(contacts.id, contactId));
  await emit({ name: "chat.assigned", contactId, userId: user.id, byUserId: user.id });
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${contactId}`);
}

export async function setChatStatus(contactId: string, status: "open" | "closed") {
  await requireUser();
  if (status !== "open" && status !== "closed") throw new Error("Invalid status");
  await db.update(contacts).set({ chatStatus: status }).where(eq(contacts.id, contactId));
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${contactId}`);
}
