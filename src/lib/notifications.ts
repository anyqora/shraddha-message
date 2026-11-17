import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { campaigns, contacts, notifications, users } from "@/db/schema";
import { formatPhone } from "./phone";
import type { AppEvent } from "./events";

type NewNotification = { userId: string; type: string; title: string; body?: string; link?: string };

async function insertMany(rows: NewNotification[]) {
  if (!rows.length) return;
  await db.insert(notifications).values(
    rows.map((r) => ({
      userId: r.userId,
      type: r.type.slice(0, 32),
      title: r.title.slice(0, 255),
      body: (r.body ?? "").slice(0, 500),
      link: (r.link ?? "").slice(0, 255),
    })),
  );
}

async function contactLabel(contactId: string) {
  const [c] = await db
    .select({ name: contacts.name, phone: contacts.phone, assignedTo: contacts.assignedTo })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  return c ? { label: c.name || formatPhone(c.phone), assignedTo: c.assignedTo } : null;
}

function previewText(text: string, type: string) {
  const t = text.trim();
  if (t) return t.length > 140 ? `${t.slice(0, 140)}…` : t;
  const icons: Record<string, string> = { image: "📷 Photo", video: "🎥 Video", audio: "🎤 Audio", document: "📎 Document", sticker: "Sticker", location: "📍 Location" };
  return icons[type] ?? `[${type}]`;
}

export async function handleEvent(event: AppEvent): Promise<void> {
  switch (event.name) {
    case "message.received": {
      const c = await contactLabel(event.contactId);
      if (!c) return;
      const link = `/inbox/${event.contactId}`;
      let targets: string[];
      if (c.assignedTo) targets = [c.assignedTo];
      else targets = (await db.select({ id: users.id }).from(users).limit(50)).map((u) => u.id);
      if (!targets.length) return;
      // One unread "message" notification per chat per user is enough.
      const already = await db
        .select({ userId: notifications.userId })
        .from(notifications)
        .where(and(inArray(notifications.userId, targets), eq(notifications.type, "message"), eq(notifications.link, link), isNull(notifications.readAt)));
      const skip = new Set(already.map((r) => r.userId));
      await insertMany(
        targets
          .filter((u) => !skip.has(u))
          .map((userId) => ({ userId, type: "message", title: `New message from ${c.label}`, body: previewText(event.text, event.type), link })),
      );
      return;
    }
    case "chat.assigned": {
      if (!event.userId || event.userId === event.byUserId) return;
      const c = await contactLabel(event.contactId);
      if (!c) return;
      let by = "";
      if (event.byUserId) {
        const [u] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, event.byUserId)).limit(1);
        if (u) by = u.name || u.email;
      }
      await insertMany([
        { userId: event.userId, type: "assigned", title: `Chat with ${c.label} assigned to you`, body: by ? `Assigned by ${by}` : "", link: `/inbox/${event.contactId}` },
      ]);
      return;
    }
    case "campaign.completed": {
      const [camp] = await db.select({ name: campaigns.name }).from(campaigns).where(eq(campaigns.id, event.campaignId)).limit(1);
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(50);
      await insertMany(
        admins.map((a) => ({ userId: a.id, type: "campaign", title: `Campaign “${camp?.name ?? "Campaign"}” completed`, link: `/campaigns/${event.campaignId}` })),
      );
      return;
    }
    default:
      return;
  }
}

/* ------------------------------------------------------------ queries */

export type NotificationItem = { id: string; type: string; title: string; body: string; link: string; read: boolean; createdAt: string };

export async function listNotifications(userId: string, limit = 30): Promise<{ items: NotificationItem[]; unread: number }> {
  const [rows, [cnt]] = await Promise.all([
    db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit),
    db.select({ n: sql<number>`count(*)` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ]);
  return {
    items: rows.map((r) => ({ id: r.id, type: r.type, title: r.title, body: r.body, link: r.link, read: !!r.readAt, createdAt: r.createdAt.toISOString() })),
    unread: Number(cnt?.n ?? 0),
  };
}

/** Mark one (by id) or all of a user's notifications read. */
export async function markNotificationsRead(userId: string, id?: string) {
  const where = id
    ? and(eq(notifications.userId, userId), eq(notifications.id, id), isNull(notifications.readAt))
    : and(eq(notifications.userId, userId), isNull(notifications.readAt));
  await db.update(notifications).set({ readAt: new Date() }).where(where);
}
