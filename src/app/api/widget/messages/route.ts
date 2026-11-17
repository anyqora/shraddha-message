import { after } from "next/server";
import { getSettings } from "@/lib/settings";
import { aiReply } from "@/lib/ai";
import { emit } from "@/lib/events";
import {
  clientIp,
  findWebContact,
  isVisitorId,
  json,
  preflight,
  rateLimit,
  recordWebInbound,
  upsertWebContact,
  visitorMessages,
} from "@/lib/web-chat";

export const dynamic = "force-dynamic";

const MAX_TEXT = 2000;

export function OPTIONS() {
  return preflight();
}

/** Messages for one visitor. ?visitorId=…&after=<ms timestamp> */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const visitorId = url.searchParams.get("visitorId");
  if (!isVisitorId(visitorId)) return json({ error: "Invalid visitor id" }, 400);
  if (!rateLimit(`wg:get:${visitorId}`, 40) || !rateLimit(`wg:get-ip:${clientIp(req)}`, 240)) {
    return json({ error: "Too many requests" }, 429, { "Retry-After": "30" });
  }
  const contact = await findWebContact(visitorId);
  if (!contact) return json({ messages: [] });
  const after = Number(url.searchParams.get("after")) || 0;
  return json({ messages: await visitorMessages(contact.id, after) });
}

/** Visitor sends a message. Body: { visitorId, name?, text } */
export async function POST(req: Request) {
  const s = await getSettings();
  if (!s.widgetEnabled) return json({ error: "Chat is not available" }, 403);
  const body = (await req.json().catch(() => null)) as { visitorId?: unknown; name?: unknown; text?: unknown } | null;
  const visitorId = body?.visitorId;
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
  const name = typeof body?.name === "string" ? body.name : undefined;
  if (!isVisitorId(visitorId)) return json({ error: "Invalid visitor id" }, 400);
  if (!text) return json({ error: "Message is empty" }, 400);
  const ip = clientIp(req);
  if (!rateLimit(`wg:post:${visitorId}`, 12) || !rateLimit(`wg:post-ip:${ip}`, 40)) {
    return json({ error: "You're sending messages too quickly. Please wait a moment." }, 429, { "Retry-After": "30" });
  }

  const { id: contactId, created } = await upsertWebContact(visitorId, name);
  if (created) await emit({ name: "contact.created", contactId });
  const messageId = await recordWebInbound(contactId, text);

  if (s.aiEnabled && s.aiApiKey) {
    // reply after the response is sent; the widget picks it up on its next poll
    after(async () => {
      try {
        await aiReply(contactId, text);
      } catch (e) {
        console.error("[widget] ai reply failed", e);
      }
    });
  }
  return json({ ok: true, id: messageId, createdAt: new Date().toISOString() });
}
