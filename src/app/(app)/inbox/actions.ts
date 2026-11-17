"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, templates, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { errorMessage, waClient } from "@/lib/whatsapp";
import { recordOutbound } from "@/lib/messaging";
import { buildSendComponents, renderTemplatePreview } from "@/lib/template-utils";
import { pauseBot } from "@/lib/chatbot";
import { getSettings } from "@/lib/settings";

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
  let wa;
  try {
    wa = await waClient();
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
  try {
    if (hasFile) {
      const f = file as File;
      const type = f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : f.type.startsWith("audio/") ? "audio" : "document";
      const mediaId = await wa.uploadMedia(f, f.name);
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
  await requireUser();
  if (userId) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) throw new Error("User not found");
  }
  await db.update(contacts).set({ assignedTo: userId }).where(eq(contacts.id, contactId));
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${contactId}`);
}

export async function assignChatToMe(contactId: string) {
  const user = await requireUser();
  await db.update(contacts).set({ assignedTo: user.id }).where(eq(contacts.id, contactId));
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
