import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { contacts, messages, type MessageMedia } from "@/db/schema";
import { applyStatus, previewOf, upsertContactByPhone } from "./messaging";
import { runChatbot } from "./chatbot";

const OPT_OUT = /^(stop|unsubscribe|stop all|opt ?out|cancel)$/i;
const OPT_IN = /^(start|subscribe|unstop|opt ?in)$/i;

type WaMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  video?: { id: string; mime_type: string; caption?: string };
  audio?: { id: string; mime_type: string };
  sticker?: { id: string; mime_type: string };
  document?: { id: string; mime_type: string; caption?: string; filename?: string };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  button?: { text: string; payload: string };
  interactive?: { button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string; description?: string } };
  reaction?: { emoji: string; message_id: string };
  contacts?: { name?: { formatted_name?: string }; phones?: { phone?: string }[] }[];
};

function replyIdOf(m: WaMessage): string | null {
  const i = m.interactive as any;
  return i?.button_reply?.id ?? i?.list_reply?.id ?? (m.button?.payload || null);
}

function extract(m: WaMessage): { body: string; media: MessageMedia | null } {
  switch (m.type) {
    case "text":
      return { body: m.text?.body ?? "", media: null };
    case "image":
    case "video":
    case "audio":
    case "sticker":
    case "document": {
      const x = (m as any)[m.type] as { id: string; mime_type: string; caption?: string; filename?: string };
      return { body: x?.caption ?? "", media: { id: x?.id, mime: x?.mime_type, filename: x?.filename, caption: x?.caption } };
    }
    case "location":
      return {
        body: `📍 ${[m.location?.name, m.location?.address].filter(Boolean).join(", ")} https://maps.google.com/?q=${m.location?.latitude},${m.location?.longitude}`,
        media: null,
      };
    case "button":
      return { body: m.button?.text ?? "", media: null };
    case "interactive":
      return { body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "", media: null };
    case "reaction":
      return { body: `Reacted ${m.reaction?.emoji ?? ""}`, media: null };
    case "contacts":
      return {
        body: (m.contacts ?? []).map((c) => `👤 ${c.name?.formatted_name ?? ""} ${c.phones?.[0]?.phone ?? ""}`).join("\n"),
        media: null,
      };
    default:
      return { body: `[${m.type} message]`, media: null };
  }
}

export async function handleWebhook(payload: any) {
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const v = change?.value;
      if (!v) continue;

      for (const st of v.statuses ?? []) {
        const err = (st.errors ?? []).map((e: any) => e.error_data?.details || e.title || e.message).filter(Boolean).join("; ");
        await applyStatus(String(st.id), String(st.status), err);
      }

      const names = new Map<string, string>();
      for (const c of v.contacts ?? []) names.set(String(c.wa_id), c.profile?.name ?? "");

      for (const m of (v.messages ?? []) as WaMessage[]) {
        const phone = String(m.from).replace(/\D/g, "");
        const contactId = await upsertContactByPhone(phone, names.get(m.from));
        const [before] = await db.select({ lastInboundAt: contacts.lastInboundAt }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
        const { body, media } = extract(m);
        const at = new Date(Number(m.timestamp) * 1000 || Date.now());

        const res = await db
          .insert(messages)
          .ignore()
          .values({ contactId, direction: "in", type: m.type, body, media, wamid: m.id, status: "received", createdAt: at });
        const inserted = (res as any)[0]?.affectedRows ?? 1;
        if (!inserted) continue; // duplicate delivery from Meta

        const text = body.trim();
        const patch: Record<string, unknown> = {
          lastMessageAt: at,
          lastInboundAt: at,
          lastMessagePreview: previewOf(m.type, body, media),
          unreadCount: sql`${contacts.unreadCount} + 1`,
          chatStatus: "open",
        };
        if (m.type === "text" && OPT_OUT.test(text)) Object.assign(patch, { optedOut: true, optedOutAt: new Date() });
        if (m.type === "text" && OPT_IN.test(text)) Object.assign(patch, { optedOut: false, optedOutAt: null });
        await db.update(contacts).set(patch).where(eq(contacts.id, contactId));
        if (!OPT_OUT.test(text)) {
          await runChatbot(contactId, text, replyIdOf(m), before?.lastInboundAt ?? null).catch((e) => console.error("chatbot error", e));
        }
      }
    }
  }
}
