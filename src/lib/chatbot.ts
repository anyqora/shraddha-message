import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { botRules, contacts, type BotRule, type Contact } from "@/db/schema";
import { getSettings } from "./settings";
import { waClient, errorMessage } from "./whatsapp";
import { recordOutbound } from "./messaging";
import { aiReply } from "./ai";

const WELCOME_GAP_MS = 24 * 3600 * 1000;

function matches(rule: BotRule, text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  const words = rule.keywords
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  return words.some((k) =>
    rule.matchType === "exact" ? t === k : rule.matchType === "starts" ? t.startsWith(k) : t.includes(k),
  );
}

/** Text shown in the inbox for a bot message. */
export function botPreview(rule: Pick<BotRule, "header" | "body" | "footer" | "options" | "replyType">) {
  const opts = rule.replyType === "text" ? "" : "\n\n" + rule.options.map((o, i) => `${i + 1}. ${o.title}`).join("\n");
  return [rule.header && `*${rule.header}*`, rule.body, rule.footer && `_${rule.footer}_`].filter(Boolean).join("\n\n") + opts;
}

/** WhatsApp payload for a rule. Option ids encode the rule + option index. */
export function botPayload(rule: BotRule) {
  if (rule.replyType === "text" || !rule.options.length) {
    return { type: "text", text: { body: rule.body, preview_url: true } };
  }
  const header = rule.header ? { header: { type: "text", text: rule.header.slice(0, 60) } } : {};
  const footer = rule.footer ? { footer: { text: rule.footer.slice(0, 60) } } : {};
  if (rule.replyType === "buttons") {
    return {
      type: "interactive",
      interactive: {
        type: "button",
        ...header,
        body: { text: rule.body.slice(0, 1024) },
        ...footer,
        action: {
          buttons: rule.options.slice(0, 3).map((o, i) => ({ type: "reply", reply: { id: `bot:${rule.id}:${i}`, title: o.title.slice(0, 20) } })),
        },
      },
    };
  }
  return {
    type: "interactive",
    interactive: {
      type: "list",
      ...header,
      body: { text: rule.body.slice(0, 1024) },
      ...footer,
      action: {
        button: (rule.listButton || "Menu").slice(0, 20),
        sections: [
          {
            title: (rule.header || "Options").slice(0, 24),
            rows: rule.options.slice(0, 10).map((o, i) => ({
              id: `bot:${rule.id}:${i}`,
              title: o.title.slice(0, 24),
              ...(o.description ? { description: o.description.slice(0, 72) } : {}),
            })),
          },
        ],
      },
    },
  };
}

async function sendRule(rule: BotRule, contact: Contact) {
  const wa = await waClient();
  const payload = botPayload(rule);
  let wamid: string | null = null;
  let error = "";
  try {
    const r = await wa.graph<{ messages?: { id: string }[] }>(`${wa.cfg.waPhoneNumberId}/messages`, {
      body: { messaging_product: "whatsapp", recipient_type: "individual", to: contact.phone, ...payload },
    });
    wamid = r.messages?.[0]?.id ?? null;
  } catch (e) {
    error = errorMessage(e);
  }
  await recordOutbound({
    contactId: contact.id,
    type: rule.replyType === "text" ? "text" : "interactive",
    body: botPreview(rule),
    wamid,
    status: wamid ? "sent" : "failed",
    error,
    sentBy: "bot",
  });
  await db.update(botRules).set({ hits: sql`${botRules.hits} + 1` }).where(eq(botRules.id, rule.id));
  if (rule.handoff) {
    const s = await getSettings();
    await db
      .update(contacts)
      .set({ botPausedUntil: new Date(Date.now() + s.botPauseHours * 3600 * 1000) })
      .where(eq(contacts.id, contact.id));
  }
}

/**
 * Called by the webhook for every inbound message (after it is stored).
 * `replyId` is the id of a tapped button / list row, if any.
 */
export async function runChatbot(contactId: string, text: string, replyId: string | null, previousInboundAt: Date | null) {
  const s = await getSettings();
  if (!s.botEnabled || !s.waAccessToken) return;
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!contact || contact.optedOut) return;
  if (contact.botPausedUntil && contact.botPausedUntil.getTime() > Date.now()) return;

  const rules = await db.select().from(botRules).where(eq(botRules.active, true)).orderBy(asc(botRules.priority), asc(botRules.createdAt));
  let chosen: BotRule | undefined;

  // 1. a tapped option that points to a next step
  const m = replyId?.match(/^bot:([0-9a-f-]{36}):(\d+)$/);
  if (m) {
    const parent = rules.find((r) => r.id === m[1]) ?? (await db.select().from(botRules).where(eq(botRules.id, m[1])).limit(1))[0];
    const next = parent?.options[Number(m[2])]?.next;
    if (next) chosen = rules.find((r) => r.id === next);
  }
  // 2. keyword rules (also matches option titles typed by hand)
  if (!chosen) chosen = rules.find((r) => r.trigger === "keyword" && matches(r, text));
  // 3. welcome on first contact or after a quiet day
  if (!chosen && (!previousInboundAt || Date.now() - previousInboundAt.getTime() > WELCOME_GAP_MS)) {
    chosen = rules.find((r) => r.trigger === "welcome");
  }
  // 4. AI assistant (preferred over the fallback rule when enabled), then the fallback rule
  if (!chosen && s.aiEnabled && (await aiReply(contactId, text)) !== null) return;
  if (!chosen) chosen = rules.find((r) => r.trigger === "fallback");
  if (!chosen) return;
  await sendRule(chosen, contact);
}

export async function resumeBot(contactId: string) {
  await db.update(contacts).set({ botPausedUntil: null }).where(and(eq(contacts.id, contactId)));
}

export async function pauseBot(contactId: string, hours: number) {
  await db.update(contacts).set({ botPausedUntil: new Date(Date.now() + hours * 3600 * 1000) }).where(eq(contacts.id, contactId));
}
