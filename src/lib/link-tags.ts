import "server-only";
import { and, isNotNull, ne } from "drizzle-orm";
import { db } from "./db";
import { listMembers, waLinks, type WaLink } from "@/db/schema";
import type { AppEvent } from "./events";

export function appBaseUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}
export function linkShortUrl(slug: string) {
  return `${appBaseUrl()}/l/${slug}`;
}
export function waMeUrl(displayPhone: string, message: string) {
  const digits = (displayPhone || "").replace(/\D/g, "");
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/** The link (with a list to tag) whose prefilled message the inbound text starts with. Longest match wins. */
export async function matchLinkTag(text: string): Promise<WaLink | null> {
  const t = norm(text || "");
  if (!t) return null;
  const links = await db.select().from(waLinks).where(and(isNotNull(waLinks.listId), ne(waLinks.message, "")));
  let best: WaLink | null = null;
  for (const l of links) {
    const m = norm(l.message);
    if (m && t.startsWith(m) && (!best || m.length > norm(best.message).length)) best = l;
  }
  return best;
}

/** message.received whose text starts with a link's prefilled message → add the contact to that link's list. Never throws. */
export async function handleEvent(event: AppEvent): Promise<void> {
  if (event.name !== "message.received" || !event.text) return;
  try {
    const link = await matchLinkTag(event.text);
    if (!link?.listId) return;
    const res = await db.insert(listMembers).ignore().values({ listId: link.listId, contactId: event.contactId });
    const affected = Number((res as any)?.[0]?.affectedRows ?? 0);
    if (affected > 0) {
      const { emit } = await import("./events");
      await emit({ name: "contact.list_added", contactId: event.contactId, listId: link.listId });
    }
  } catch (e) {
    console.error("[link-tags] failed", e);
  }
}
