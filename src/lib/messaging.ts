import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { contacts, messages, type MessageMedia } from "@/db/schema";

/** Insert or fetch a contact by phone. Returns the contact id. */
export async function upsertContactByPhone(phone: string, name?: string): Promise<string> {
  return (await upsertContactByPhoneEx(phone, name)).id;
}

/** Like upsertContactByPhone, but also reports whether a new contact row was inserted. */
export async function upsertContactByPhoneEx(phone: string, name?: string): Promise<{ id: string; created: boolean }> {
  const id = crypto.randomUUID();
  const res = await db
    .insert(contacts)
    .values({ id, phone, name: name ?? "" })
    .onDuplicateKeyUpdate({
      // only fill the name if we don't have one yet
      set: { name: sql`if(${contacts.name} = '', values(${contacts.name}), ${contacts.name})` },
    });
  const row = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.phone, phone)).limit(1);
  // MySQL: affectedRows = 1 for a fresh insert, 2 (or 0) when the duplicate-key branch ran
  const affected = Number((res as any)?.[0]?.affectedRows ?? 0);
  return { id: row[0].id, created: affected === 1 && row[0].id === id };
}

/** Contact that owns a message, looked up by WhatsApp message id. */
export async function contactIdByWamid(wamid: string): Promise<string | null> {
  const [r] = await db.select({ contactId: messages.contactId }).from(messages).where(eq(messages.wamid, wamid)).limit(1);
  return r?.contactId ?? null;
}

/** Set (or clear, with "") the reaction shown on a message, by wamid. */
export async function setReactionByWamid(wamid: string, emoji: string) {
  await db.update(messages).set({ reaction: emoji.slice(0, 16) }).where(eq(messages.wamid, wamid));
}

/** Send a WhatsApp reaction to one of the contact's messages and mirror it on our copy. */
export async function sendReaction(messageId: string, emoji: string) {
  const [m] = await db
    .select({ id: messages.id, wamid: messages.wamid, contactId: messages.contactId, phone: contacts.phone })
    .from(messages)
    .innerJoin(contacts, eq(contacts.id, messages.contactId))
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!m?.wamid) throw new Error("This message can't be reacted to.");
  const { waClient } = await import("./whatsapp");
  const wa = await waClient();
  await wa.graph(`${wa.cfg.waPhoneNumberId}/messages`, {
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: m.phone,
      type: "reaction",
      reaction: { message_id: m.wamid, emoji },
    },
  });
  await db.update(messages).set({ reaction: emoji.slice(0, 16) }).where(eq(messages.id, m.id));
  return m.contactId;
}

export function previewOf(type: string, body: string, media?: MessageMedia | null): string {
  if (body) return body.slice(0, 250);
  if (media?.filename) return `📎 ${media.filename}`;
  const icons: Record<string, string> = { image: "📷 Photo", video: "🎥 Video", audio: "🎤 Audio", document: "📎 Document", sticker: "Sticker", location: "📍 Location" };
  return icons[type] ?? type;
}

export async function recordOutbound(opts: {
  contactId: string;
  type: string;
  body: string;
  media?: MessageMedia | null;
  templateName?: string | null;
  wamid?: string | null;
  status: "sent" | "failed" | "pending";
  error?: string;
  campaignId?: string | null;
  sentBy?: string | null;
}) {
  const now = new Date();
  await db.insert(messages).values({
    contactId: opts.contactId,
    direction: "out",
    type: opts.type,
    body: opts.body,
    media: opts.media ?? null,
    templateName: opts.templateName ?? null,
    wamid: opts.wamid ?? null,
    status: opts.status,
    error: (opts.error ?? "").slice(0, 500),
    campaignId: opts.campaignId ?? null,
    sentBy: opts.sentBy ?? null,
    createdAt: now,
  });
  await db
    .update(contacts)
    .set({ lastMessageAt: now, lastMessagePreview: previewOf(opts.type, opts.body, opts.media) })
    .where(eq(contacts.id, opts.contactId));
}

const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

/** Apply a delivery status from the webhook to messages + campaign recipients (never downgrade). */
export async function applyStatus(wamid: string, status: string, error: string) {
  const rank = STATUS_RANK[status];
  if (rank === undefined) return;
  const rankSql = (col: unknown) =>
    sql`(case ${col} when 'pending' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 4 else 0 end)`;
  await db.execute(sql`
    update messages set status = ${status}, error = ${error.slice(0, 500)}
    where wamid = ${wamid} and ${rankSql(sql.raw("status"))} < ${rank}`);
  await db.execute(sql`
    update campaign_recipients set status = ${status}, error = ${error.slice(0, 500)}
    where wamid = ${wamid} and ${rankSql(sql.raw("status"))} < ${rank}`);
}

export async function markRead(contactId: string) {
  await db.update(contacts).set({ unreadCount: 0 }).where(and(eq(contacts.id, contactId), sql`${contacts.unreadCount} > 0`));
}
