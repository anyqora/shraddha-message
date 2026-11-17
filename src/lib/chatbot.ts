import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, pool } from "./db";
import { appointments, botRules, contacts, type BotRule, type Contact } from "@/db/schema";
import { getSettings } from "./settings";
import { waClient, errorMessage } from "./whatsapp";
import { recordOutbound } from "./messaging";
import { aiReply } from "./ai";
import { computeFreeSlots, fmtDay, fmtTime, isSlotFree } from "./appointments";
import { createLead } from "./leads";

const WELCOME_GAP_MS = 24 * 3600 * 1000;
const FORM_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_RETRIES = 2;
const MAX_CHAIN = 12;
const EXIT_WORDS = /^(cancel|stop|exit|quit)$/i;

type BotState = NonNullable<Contact["botState"]> & { retries?: number };

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

const hasOptions = (t: BotRule["replyType"]) => t === "buttons" || t === "list";

/** Text shown in the inbox for a bot message. */
export function botPreview(rule: Pick<BotRule, "header" | "body" | "footer" | "options" | "replyType">) {
  const opts = hasOptions(rule.replyType) ? "\n\n" + rule.options.map((o, i) => `${i + 1}. ${o.title}`).join("\n") : "";
  const header = hasOptions(rule.replyType) ? rule.header : "";
  const footer = hasOptions(rule.replyType) ? rule.footer : "";
  return [header && `*${header}*`, rule.body, footer && `_${footer}_`].filter(Boolean).join("\n\n") + opts;
}

/** WhatsApp payload for a rule. Option ids encode the rule + option index. */
export function botPayload(rule: BotRule) {
  if (!hasOptions(rule.replyType) || !rule.options.length) {
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

/* ------------------------------------------------------------- helpers */

/** Replace {{name}}, {{phone}}, {{email}} and {{answer.key}} placeholders. */
export function fillBotText(text: string, contact: Pick<Contact, "name" | "phone" | "email">, answers: Record<string, string> = {}) {
  return text.replace(/\{\{\s*([\w.:-]+)\s*\}\}/g, (m, key: string) => {
    const k = key.toLowerCase();
    if (k === "name") return contact.name || answers.name || "there";
    if (k === "phone") return contact.phone;
    if (k === "email") return contact.email || answers.email || "";
    if (k.startsWith("answer.") || k.startsWith("answers.")) {
      const a = key.slice(key.indexOf(".") + 1);
      const hit = Object.keys(answers).find((x) => x.toLowerCase() === a.toLowerCase());
      return hit ? answers[hit] : "";
    }
    return m;
  });
}

/** Short key under which a question's answer is kept in botState.answers / lead data. */
export function answerKey(rule: Pick<BotRule, "saveTo" | "name">): string {
  const s = rule.saveTo.trim();
  if (s === "name" || s === "email") return s;
  if (s.startsWith("custom:") || s.startsWith("answer:")) return s.slice(s.indexOf(":") + 1).trim() || "answer";
  return (
    rule.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "answer"
  );
}

async function sendRaw(contact: Contact, payload: Record<string, unknown>, preview: string, type: string) {
  let wamid: string | null = null;
  let error = "";
  try {
    const wa = await waClient();
    const r = await wa.graph<{ messages?: { id: string }[] }>(`${wa.cfg.waPhoneNumberId}/messages`, {
      body: { messaging_product: "whatsapp", recipient_type: "individual", to: contact.phone, ...payload },
    });
    wamid = r.messages?.[0]?.id ?? null;
  } catch (e) {
    error = errorMessage(e);
  }
  await recordOutbound({ contactId: contact.id, type, body: preview, wamid, status: wamid ? "sent" : "failed", error, sentBy: "bot" });
}

const sendText = (contact: Contact, body: string) =>
  sendRaw(contact, { type: "text", text: { body: body.slice(0, 4096), preview_url: true } }, body, "text");

/** Bookkeeping after a rule was sent: hit counter + optional handoff pause. */
async function afterSend(rule: BotRule, contact: Contact) {
  await db.update(botRules).set({ hits: sql`${botRules.hits} + 1` }).where(eq(botRules.id, rule.id));
  if (rule.handoff) {
    const s = await getSettings();
    await db
      .update(contacts)
      .set({ botPausedUntil: new Date(Date.now() + s.botPauseHours * 3600 * 1000) })
      .where(eq(contacts.id, contact.id));
  }
}

async function sendRule(rule: BotRule, contact: Contact) {
  await sendRaw(contact, botPayload(rule), botPreview(rule), hasOptions(rule.replyType) ? "interactive" : "text");
  await afterSend(rule, contact);
}

async function setState(contactId: string, state: BotState | null) {
  await db.update(contacts).set({ botState: state as Contact["botState"] }).where(eq(contacts.id, contactId));
}

async function loadRule(id: string | null | undefined, rules?: BotRule[]): Promise<BotRule | undefined> {
  if (!id) return undefined;
  return rules?.find((r) => r.id === id) ?? (await db.select().from(botRules).where(eq(botRules.id, id)).limit(1))[0];
}

async function reloadContact(id: string): Promise<Contact | undefined> {
  return (await db.select().from(contacts).where(eq(contacts.id, id)).limit(1))[0];
}

/* ---------------------------------------------------------- validation */

const VALIDATION_HINT: Record<BotRule["validation"], string> = {
  none: "Please type your answer.",
  email: "Please send a valid email address (e.g. name@example.com).",
  phone: "Please send a valid phone number (10–15 digits).",
  number: "Please send a number (digits only).",
  date: "Please send a valid date, e.g. 25/12/2026.",
};

/** Returns the cleaned value, or null when the answer doesn't pass. */
export function validateAnswer(raw: string, v: BotRule["validation"]): string | null {
  const t = raw.trim();
  if (!t) return null;
  switch (v) {
    case "email": {
      const e = t.toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 191 ? e : null;
    }
    case "phone": {
      const d = t.replace(/[\s().-]/g, "");
      return /^\+?\d{10,15}$/.test(d) ? d.replace(/^\+/, "") : null;
    }
    case "number": {
      const n = t.replace(/[,\s₹]/g, "");
      return /^-?\d+(\.\d+)?$/.test(n) ? n : null;
    }
    case "date": {
      let y: number, m: number, d: number;
      let x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
      if (x) [y, m, d] = [Number(x[1]), Number(x[2]), Number(x[3])];
      else if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t))) {
        [d, m, y] = [Number(x[1]), Number(x[2]), Number(x[3])];
        if (y < 100) y += 2000;
      } else {
        // free text like "25 Dec 2026" — needs a month name and a 4-digit year
        if (!/[a-z]{3}/i.test(t) || !/\b\d{4}\b/.test(t)) return null;
        const p = new Date(`${t} 12:00`);
        if (Number.isNaN(p.getTime())) return null;
        [y, m, d] = [p.getFullYear(), p.getMonth() + 1, p.getDate()];
      }
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1900 || y > 2200) return null;
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    default:
      return t.slice(0, 1000);
  }
}

/* -------------------------------------------------------------- steps */

/**
 * Run a step. `answers` is the form data collected so far (kept when chaining via nextRuleId,
 * reset when a step is entered fresh from a keyword / welcome / option).
 */
async function runStep(rule: BotRule, contact: Contact, answers: Record<string, string>, depth = 0): Promise<void> {
  if (depth > MAX_CHAIN) return;
  const chain = async (c: Contact, a: Record<string, string>) => {
    const next = rule.nextRuleId && rule.nextRuleId !== rule.id ? await loadRule(rule.nextRuleId) : undefined;
    if (next && next.active) await runStep(next, c, a, depth + 1);
  };

  switch (rule.replyType) {
    case "question": {
      const body = fillBotText(rule.body, contact, answers);
      await sendText(contact, body);
      await afterSend(rule, contact);
      await setState(contact.id, { awaitingRuleId: rule.id, answers, startedAt: new Date().toISOString(), retries: 0 });
      return;
    }
    case "lead": {
      const c = (await reloadContact(contact.id)) ?? contact;
      await createLead({
        contactId: c.id,
        title: rule.name,
        source: "chatbot",
        data: { ...answers, name: c.name || answers.name || "", phone: c.phone, ...(c.email ? { email: c.email } : {}) },
      });
      await setState(c.id, null);
      if (rule.body.trim()) await sendText(c, fillBotText(rule.body, c, answers));
      await afterSend(rule, c);
      await chain(c, {});
      return;
    }
    case "book": {
      await sendSlots(rule, contact, answers);
      await afterSend(rule, contact);
      // keep collected answers so a later "lead" step can use them; nothing is awaited as typed text
      await setState(contact.id, Object.keys(answers).length ? { answers, startedAt: new Date().toISOString() } : null);
      return;
    }
    default:
      await sendRule(rule, contact);
  }
}

async function sendSlots(rule: BotRule, contact: Contact, answers: Record<string, string>, intro?: string) {
  const slots = await computeFreeSlots(10);
  if (!slots.length) {
    await sendText(contact, "Sorry, there are no free slots in the next few days. Our team will get back to you to fix a time. 🙏");
    return;
  }
  const groups = new Map<string, Date[]>();
  for (const d of slots) groups.set(fmtDay(d), [...(groups.get(fmtDay(d)) ?? []), d]);
  const body = (intro ? intro + "\n\n" : "") + fillBotText(rule.body || "Please pick a time that suits you.", contact, answers);
  const service = rule.header || rule.name;
  const payload = {
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: service.slice(0, 60) },
      body: { text: body.slice(0, 1024) },
      ...(rule.footer ? { footer: { text: rule.footer.slice(0, 60) } } : { footer: { text: "Times in IST" } }),
      action: {
        button: (rule.listButton && rule.listButton !== "Menu" ? rule.listButton : "Pick a slot").slice(0, 20),
        sections: [...groups].slice(0, 10).map(([day, ds]) => ({
          title: day.slice(0, 24),
          rows: ds.map((d) => ({ id: `book:${rule.id}:${d.toISOString()}`, title: fmtTime(d).slice(0, 24), description: day.slice(0, 72) })),
        })),
      },
    },
  };
  const preview = `*${service}*\n\n${body}\n\n` + slots.map((d, i) => `${i + 1}. ${fmtDay(d)} ${fmtTime(d)}`).join("\n");
  await sendRaw(contact, payload, preview, "interactive");
}

async function handleSlotTap(ruleId: string, iso: string, contact: Contact) {
  const rule = await loadRule(ruleId);
  const state = (contact.botState ?? {}) as BotState;
  const answers = state.answers ?? {};
  const start = new Date(iso);
  if (!rule || rule.replyType !== "book" || Number.isNaN(start.getTime())) return;
  if (start.getTime() < Date.now()) {
    await sendSlots(rule, contact, answers, "That time has already passed.");
    return;
  }
  const s = await getSettings();
  const duration = Math.max(5, s.apptSlotMin || 30);
  const service = (rule.header || rule.name).slice(0, 191);

  // one booking at a time for this slot window
  const lockName = `appt:${start.toISOString()}`;
  const conn = await pool.getConnection().catch(() => null);
  try {
    if (conn) await conn.query("SELECT GET_LOCK(?, 5)", [lockName]);
    // the same customer tapping the same slot twice → just reconfirm
    const [mine] = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.contactId, contact.id), eq(appointments.startAt, start), sql`${appointments.status} <> 'cancelled'`))
      .limit(1);
    if (!mine) {
      if (!(await isSlotFree(start, duration))) {
        await sendSlots(rule, contact, answers, "Sorry, that slot was just taken. Here are the next free times:");
        return;
      }
      const notes = Object.entries(answers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      await db.insert(appointments).values({
        contactId: contact.id,
        service,
        startAt: start,
        durationMin: duration,
        status: "booked",
        notes,
        source: "chatbot",
      });
    }
  } finally {
    if (conn) {
      await conn.query("SELECT RELEASE_LOCK(?)", [lockName]).catch(() => {});
      conn.release();
    }
  }

  const when = `${fmtDay(start)} at ${fmtTime(start)}`;
  await sendText(contact, `✅ Booked! Your ${service} is on *${when}* (IST).\nWe'll send you a reminder before it.`);
  const next = rule.nextRuleId ? await loadRule(rule.nextRuleId) : undefined;
  if (next?.active) await runStep(next, (await reloadContact(contact.id)) ?? contact, { ...answers, appointment: `${when} IST`, service }, 1);
}

/** Saves a typed answer for the question the contact was asked. Returns true when the message was consumed. */
async function handleAnswer(contact: Contact, state: BotState, text: string): Promise<boolean> {
  const rule = await loadRule(state.awaitingRuleId);
  if (!rule || rule.replyType !== "question") {
    await setState(contact.id, null);
    return false;
  }
  const answers = { ...(state.answers ?? {}) };
  const value = validateAnswer(text, rule.validation);
  if (value === null) {
    const retries = (state.retries ?? 0) + 1;
    if (retries > MAX_RETRIES) {
      await setState(contact.id, null);
      await sendText(contact, "No problem — let's leave it here for now. Type *menu* anytime to start again.");
      return true;
    }
    await setState(contact.id, { ...state, retries });
    await sendText(contact, `${VALIDATION_HINT[rule.validation]} (type *exit* to stop)`);
    return true;
  }

  const key = answerKey(rule);
  answers[key] = value;
  const target = rule.saveTo.trim();
  const patch: Partial<Contact> = {};
  if (target === "name") patch.name = value.slice(0, 191);
  else if (target === "email") patch.email = value.slice(0, 191);
  else if (target.startsWith("custom:") && key) patch.custom = { ...(contact.custom ?? {}), [key]: value.slice(0, 500) };
  if (Object.keys(patch).length) await db.update(contacts).set(patch).where(eq(contacts.id, contact.id));

  const fresh = { ...contact, ...patch };
  const next = rule.nextRuleId && rule.nextRuleId !== rule.id ? await loadRule(rule.nextRuleId) : undefined;
  if (next?.active) {
    await setState(contact.id, { answers, startedAt: new Date().toISOString() });
    await runStep(next, fresh, answers, 1);
  } else {
    await setState(contact.id, null);
  }
  return true;
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

  // 0a. a tapped appointment slot
  const bm = replyId?.match(/^book:([0-9a-f-]{36}):(.+)$/);
  if (bm) {
    await handleSlotTap(bm[1], bm[2], contact);
    return;
  }

  // 0b. an open question waiting for a typed answer
  const state = contact.botState as BotState | null;
  if (state?.awaitingRuleId) {
    const started = state.startedAt ? Date.parse(state.startedAt) : NaN;
    if (!Number.isFinite(started) || Date.now() - started > FORM_TIMEOUT_MS) {
      await setState(contact.id, null);
    } else if (EXIT_WORDS.test(text.trim())) {
      await setState(contact.id, null);
      await sendText(contact, "Okay, stopped. Type *menu* anytime to see options.");
      return;
    } else if (replyId?.startsWith("bot:")) {
      // tapped an older menu option: leave the form and handle the tap normally
      await setState(contact.id, null);
    } else if (await handleAnswer(contact, state, text)) {
      return;
    }
  }

  const rules = await db.select().from(botRules).where(eq(botRules.active, true)).orderBy(asc(botRules.priority), asc(botRules.createdAt));
  let chosen: BotRule | undefined;

  // 1. a tapped option that points to a next step
  const m = replyId?.match(/^bot:([0-9a-f-]{36}):(\d+)$/);
  if (m) {
    const parent = await loadRule(m[1], rules);
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
  await runStep(chosen, contact, {});
}

export async function resumeBot(contactId: string) {
  await db.update(contacts).set({ botPausedUntil: null }).where(and(eq(contacts.id, contactId)));
}

export async function pauseBot(contactId: string, hours: number) {
  await db.update(contacts).set({ botPausedUntil: new Date(Date.now() + hours * 3600 * 1000) }).where(eq(contacts.id, contactId));
}
