import "server-only";
import type { Contact, Message } from "@/db/schema";

export const PAGE_SIZE = 50;

export function pageOf(url: URL): number {
  return Math.max(1, Math.floor(Number(url.searchParams.get("page")) || 1));
}

export function contactJson(c: Contact) {
  return {
    id: c.id,
    phone: c.phone,
    name: c.name,
    email: c.email,
    custom: c.custom ?? {},
    opted_out: c.optedOut,
    chat_status: c.chatStatus,
    assigned_to: c.assignedTo,
    last_message_at: c.lastMessageAt?.toISOString() ?? null,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

export function messageJson(m: Message) {
  return {
    id: m.id,
    contact_id: m.contactId,
    direction: m.direction,
    type: m.type,
    body: m.body,
    media: m.media ?? null,
    template_name: m.templateName,
    wamid: m.wamid,
    status: m.status,
    error: m.error || null,
    sent_by: m.sentBy,
    created_at: m.createdAt.toISOString(),
  };
}
