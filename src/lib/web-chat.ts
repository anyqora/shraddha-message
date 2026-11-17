import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { contacts, messages } from "@/db/schema";
import { previewOf } from "./messaging";
import { emit } from "./events";

/* ------------------------------------------------------------ CORS + rate limit */

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { ...CORS_HEADERS, "Cache-Control": "no-store", ...extra } });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const buckets = new Map<string, number[]>();
let lastSweep = Date.now();

/** Sliding-window limiter kept in memory (per server process). Returns true when allowed. */
export function rateLimit(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  if (now - lastSweep > 5 * 60_000) {
    for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1] > 10 * 60_000) buckets.delete(k);
    lastSweep = now;
  }
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

export function clientIp(req: Request): string {
  const h = req.headers;
  return (h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || h.get("cf-connecting-ip") || "unknown").trim();
}

/* ------------------------------------------------------------ visitors */

export const isVisitorId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v);

/** Synthetic, never-dialable phone for web visitors: "w" + 19 hex chars (fits varchar(20), never all digits). */
const syntheticPhone = () => "w" + randomBytes(10).toString("hex").slice(0, 19);

export async function findWebContact(visitorId: string) {
  const [c] = await db.select().from(contacts).where(eq(contacts.webVisitorId, visitorId)).limit(1);
  return c ?? null;
}

/** Find or create the contact for a website visitor. */
export async function upsertWebContact(visitorId: string, name?: string): Promise<{ id: string; created: boolean }> {
  const clean = (name ?? "").replace(/\s+/g, " ").trim().slice(0, 191);
  const existing = await findWebContact(visitorId);
  if (existing) {
    if (clean && !existing.name) await db.update(contacts).set({ name: clean }).where(eq(contacts.id, existing.id));
    return { id: existing.id, created: false };
  }
  const id = crypto.randomUUID();
  try {
    await db.insert(contacts).values({ id, phone: syntheticPhone(), name: clean, channel: "web", webVisitorId: visitorId });
  } catch (e) {
    // a parallel request created it first
    const again = await findWebContact(visitorId);
    if (again) return { id: again.id, created: false };
    throw e;
  }
  return { id, created: true };
}

/** Store a visitor message and update the conversation like an inbound WhatsApp message. */
export async function recordWebInbound(contactId: string, text: string): Promise<string> {
  const id = crypto.randomUUID();
  const at = new Date();
  await db.insert(messages).values({ id, contactId, direction: "in", type: "text", body: text, status: "received", createdAt: at });
  await db
    .update(contacts)
    .set({
      lastMessageAt: at,
      lastInboundAt: at,
      lastMessagePreview: previewOf("text", text),
      unreadCount: sql`${contacts.unreadCount} + 1`,
      chatStatus: "open",
    })
    .where(eq(contacts.id, contactId));
  await emit({ name: "message.received", contactId, messageId: id, text, type: "text" });
  return id;
}

export type WidgetMessage = { id: string; direction: "in" | "out"; body: string; createdAt: string };

/** Messages visible to the visitor (no internal fields). `after` = ms timestamp of the last message seen (inclusive — the client de-dupes by id). */
export async function visitorMessages(contactId: string, after?: number): Promise<WidgetMessage[]> {
  const conds = [eq(messages.contactId, contactId)];
  if (after && Number.isFinite(after) && after > 0) conds.push(gte(messages.createdAt, new Date(after)));
  const rows = await db
    .select({ id: messages.id, direction: messages.direction, body: messages.body, type: messages.type, status: messages.status, createdAt: messages.createdAt })
    .from(messages)
    .where(and(...conds))
    .orderBy(asc(messages.createdAt))
    .limit(200);
  return rows
    .filter((m) => m.direction === "in" || m.status !== "failed")
    .filter((m) => m.body.trim() || m.type !== "text")
    .map((m) => ({
      id: m.id,
      direction: m.direction,
      body: m.body.trim() || `[${m.type}]`,
      createdAt: m.createdAt.toISOString(),
    }));
}
