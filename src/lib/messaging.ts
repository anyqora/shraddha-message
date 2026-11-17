import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { contacts, messages, type MessageMedia } from "@/db/schema";

/** Insert or fetch a contact by phone. Returns the contact id. */
export async function upsertContactByPhone(phone: string, name?: string): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .insert(contacts)
    .values({ id, phone, name: name ?? "" })
    .onDuplicateKeyUpdate({
      // only fill the name if we don't have one yet
      set: { name: sql`if(${contacts.name} = '', values(${contacts.name}), ${contacts.name})` },
    });
  const row = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.phone, phone)).limit(1);
  return row[0].id;
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
