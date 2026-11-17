import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { campaignRecipients, campaigns, contacts, lists, users, type Contact } from "@/db/schema";
import { getSettings } from "./settings";
import type { AppEvent } from "./events";

type Row = Record<string, string | number | boolean>;

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : "");

/** POST JSON to the Apps Script web app. Never throws. */
export async function postToSheet(url: string, payload: unknown, timeoutMs = 8000): Promise<{ ok: boolean; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "ShraddhaMessage-Sheets/1.0" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      redirect: "follow",
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 200)}`.trim() };
    // Apps Script returns an HTML page (status 200) when the script throws or access isn't "Anyone".
    if (/<html/i.test(text) && !/"ok"\s*:\s*true/.test(text))
      return { ok: false, error: "The web app returned an HTML page — check it is deployed with access “Anyone” and the script has no errors." };
    return { ok: true, error: "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? (e.name === "TimeoutError" ? `Timed out after ${Math.round(timeoutMs / 1000)} s` : e.message) : String(e) };
  }
}

export function contactRow(c: Contact, extra: Row = {}): Row {
  const row: Row = {
    time: new Date().toISOString(),
    name: c.name,
    phone: c.phone,
    email: c.email,
    opted_out: c.optedOut ? "yes" : "no",
    chat_status: c.chatStatus,
    channel: c.channel,
    birthday: c.birthday ?? "",
    created: iso(c.createdAt),
    last_inbound: iso(c.lastInboundAt),
    ...extra,
  };
  for (const [k, v] of Object.entries(c.custom ?? {})) if (!(k in row)) row[k] = String(v ?? "");
  return row;
}

async function contactById(id: string | null) {
  if (!id) return null;
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  return c ?? null;
}

async function userName(id: string | null) {
  if (!id) return "";
  const [u] = await db.select({ n: users.name, e: users.email }).from(users).where(eq(users.id, id)).limit(1);
  return u ? u.n || u.e : "";
}

async function buildRow(event: AppEvent): Promise<Row | null> {
  const time = new Date().toISOString();
  switch (event.name) {
    case "contact.created": {
      const c = await contactById(event.contactId);
      return c ? contactRow(c, { time }) : null;
    }
    case "message.received": {
      const c = await contactById(event.contactId);
      return { time, name: c?.name ?? "", phone: c?.phone ?? "", email: c?.email ?? "", type: event.type, text: event.text };
    }
    case "message.status": {
      const c = await contactById(event.contactId);
      return { time, name: c?.name ?? "", phone: c?.phone ?? "", status: event.status, error: event.error, wamid: event.wamid };
    }
    case "contact.list_added": {
      const c = await contactById(event.contactId);
      const [l] = await db.select({ name: lists.name }).from(lists).where(eq(lists.id, event.listId)).limit(1);
      return { time, name: c?.name ?? "", phone: c?.phone ?? "", email: c?.email ?? "", list: l?.name ?? event.listId };
    }
    case "chat.assigned": {
      const [c, to, by] = await Promise.all([contactById(event.contactId), userName(event.userId), userName(event.byUserId)]);
      return { time, name: c?.name ?? "", phone: c?.phone ?? "", assigned_to: to, assigned_by: by };
    }
    case "campaign.completed": {
      const [cp] = await db.select().from(campaigns).where(eq(campaigns.id, event.campaignId)).limit(1);
      if (!cp) return null;
      const rs = await db.select({ status: campaignRecipients.status }).from(campaignRecipients).where(eq(campaignRecipients.campaignId, cp.id));
      const n = (s: string) => rs.filter((r) => r.status === s).length;
      return {
        time,
        campaign: cp.name,
        template: cp.templateName,
        audience: cp.audience,
        total: cp.total,
        skipped: cp.skipped,
        sent: n("sent") + n("delivered") + n("read"),
        delivered: n("delivered") + n("read"),
        read: n("read"),
        failed: n("failed"),
      };
    }
  }
  return null;
}

export async function handleEvent(event: AppEvent): Promise<void> {
  try {
    const s = await getSettings();
    if (!s.sheetsWebhookUrl) return;
    const subscribed = s.sheetsEvents.split(",").map((x) => x.trim()).filter(Boolean);
    if (!subscribed.includes(event.name)) return;
    const data = await buildRow(event);
    if (!data) return;
    const r = await postToSheet(s.sheetsWebhookUrl, { event: event.name, data });
    if (!r.ok) console.error(`[sheets] ${event.name}: ${r.error}`);
  } catch (e) {
    console.error("[sheets] handler failed", e);
  }
}
