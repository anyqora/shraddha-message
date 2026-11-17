import "server-only";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { db } from "./db";
import type { AppEvent } from "./events";
import {
  automationRuns,
  automations,
  contacts,
  listMembers,
  notes,
  tasks,
  templates,
  type Automation,
  type AutomationStep,
  type AutomationTrigger,
} from "@/db/schema";
import { waClient, errorMessage } from "./whatsapp";
import { recordOutbound } from "./messaging";
import { buildSendComponents, renderTemplatePreview, templateShape } from "./template-utils";
import { pauseBot } from "./chatbot";
import { getSettings } from "./settings";

type Contact = typeof contacts.$inferSelect;
type RunEvent = AppEvent | { name: "automation.resumed"; runId: string };

const RETRIGGER_MS = 60_000;
const RESUME_BATCH = 50;

/* ------------------------------------------------------------ matching */

function keywordMatch(t: Extract<AutomationTrigger, { type: "message.received" }>, text: string): boolean {
  const words = (t.keywords ?? "")
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  if (!words.length) return true; // no keywords = any message
  const s = text.trim().toLowerCase();
  if (!s) return false;
  const mt = t.matchType ?? "contains";
  return words.some((k) => (mt === "exact" ? s === k : mt === "starts" ? s.startsWith(k) : s.includes(k)));
}

function triggerMatches(t: AutomationTrigger, ev: AppEvent): boolean {
  if (t.type !== ev.name) return false;
  if (t.type === "message.received" && ev.name === "message.received") return keywordMatch(t, ev.text);
  if (t.type === "contact.list_added" && ev.name === "contact.list_added") return t.listId === ev.listId;
  return true;
}

/* -------------------------------------------------------- placeholders */

function fill(text: string, c: Contact | null, nameFallback: string): string {
  return text
    .replace(/\{\{\s*name\s*\}\}/gi, c?.name || nameFallback || c?.phone || "")
    .replace(/\{\{\s*phone\s*\}\}/gi, c?.phone ?? "")
    .replace(/\{\{\s*email\s*\}\}/gi, c?.email ?? "");
}

/* ---------------------------------------------------------------- steps */

class StepError extends Error {}

async function runStep(step: AutomationStep, a: Automation, contact: Contact | null, event: RunEvent): Promise<void> {
  const needContact = () => {
    if (!contact) throw new StepError("This step needs a contact, but the trigger has none.");
    return contact;
  };

  switch (step.type) {
    case "send_text": {
      const c = needContact();
      if (c.optedOut) throw new StepError("Contact has opted out of messages.");
      const text = fill(step.text, c, "there");
      if (c.channel === "web") {
        await recordOutbound({ contactId: c.id, type: "text", body: text, status: "sent", sentBy: "automation" });
        return;
      }
      try {
        const wamid = await (await waClient()).sendText(c.phone, text);
        await recordOutbound({ contactId: c.id, type: "text", body: text, wamid, status: "sent", sentBy: "automation" });
      } catch (e) {
        const msg = errorMessage(e);
        await recordOutbound({ contactId: c.id, type: "text", body: text, status: "failed", error: msg, sentBy: "automation" });
        throw new StepError(msg);
      }
      return;
    }

    case "send_template": {
      const c = needContact();
      if (c.optedOut) throw new StepError("Contact has opted out of messages.");
      if (c.channel === "web") throw new StepError("Templates can only be sent to WhatsApp contacts.");
      const [tpl] = await db.select().from(templates).where(eq(templates.id, step.templateId)).limit(1);
      if (!tpl) throw new StepError("Template not found (deleted?).");
      if (tpl.status !== "APPROVED") throw new StepError(`Template “${tpl.name}” is not approved (${tpl.status}).`);
      if (templateShape(tpl.components).headerMedia) throw new StepError(`Template “${tpl.name}” has a media header, which automations can’t send.`);
      const params = { header: [] as string[], body: step.body.map((b) => fill(b, c, "there")) };
      const preview = renderTemplatePreview(tpl.components, params);
      try {
        const wamid = await (await waClient()).sendTemplate(c.phone, tpl.name, tpl.language, buildSendComponents(tpl.components, params));
        await recordOutbound({ contactId: c.id, type: "template", body: preview, templateName: tpl.name, wamid, status: "sent", sentBy: "automation" });
      } catch (e) {
        const msg = errorMessage(e);
        await recordOutbound({ contactId: c.id, type: "template", body: preview, templateName: tpl.name, status: "failed", error: msg, sentBy: "automation" });
        throw new StepError(msg);
      }
      return;
    }

    case "add_to_list": {
      const c = needContact();
      // direct insert (no contact.list_added emit) so automations can't chain into loops
      await db.insert(listMembers).ignore().values({ listId: step.listId, contactId: c.id });
      return;
    }

    case "remove_from_list": {
      const c = needContact();
      await db.delete(listMembers).where(and(eq(listMembers.listId, step.listId), eq(listMembers.contactId, c.id)));
      return;
    }

    case "assign": {
      const c = needContact();
      await db.update(contacts).set({ assignedTo: step.userId }).where(eq(contacts.id, c.id));
      return;
    }

    case "close_chat": {
      const c = needContact();
      await db.update(contacts).set({ chatStatus: "closed" }).where(eq(contacts.id, c.id));
      return;
    }

    case "pause_bot": {
      const c = needContact();
      await pauseBot(c.id, step.hours > 0 ? step.hours : (await getSettings()).botPauseHours);
      return;
    }

    case "add_note": {
      const c = needContact();
      await db.insert(notes).values({ body: `${fill(step.text, c, "")}\n\n— Automation: ${a.name}`, contactId: c.id, authorId: null });
      return;
    }

    case "create_task": {
      const c = needContact();
      await db.insert(tasks).values({
        title: fill(step.title, c, "").slice(0, 255),
        body: `Created by automation “${a.name}”.`,
        contactId: c.id,
        assigneeId: c.assignedTo ?? null,
        dueAt: step.dueInHours != null ? new Date(Date.now() + step.dueInHours * 3600_000) : null,
      });
      return;
    }

    case "webhook": {
      const payload = {
        automation: { id: a.id, name: a.name },
        contact: contact
          ? { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email, custom: contact.custom, assignedTo: contact.assignedTo, chatStatus: contact.chatStatus }
          : null,
        event,
      };
      let res: Response;
      try {
        res = await fetch(step.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": "WhatsAppCRM-Automations/1.0" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
          cache: "no-store",
        });
      } catch (e) {
        throw new StepError(`Webhook failed: ${e instanceof Error && e.name === "TimeoutError" ? "timed out after 10 s" : errorMessage(e)}`);
      }
      if (!res.ok) throw new StepError(`Webhook returned HTTP ${res.status}`);
      return;
    }

    case "wait":
      return; // handled by the executor
  }
}

/* ------------------------------------------------------------- executor */

async function loadContact(id: string | null): Promise<Contact | null> {
  if (!id) return null;
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  return c ?? null;
}

const MUTATES_CONTACT = new Set<AutomationStep["type"]>(["assign", "close_chat", "pause_bot"]);

/** Execute steps from `from` until done, failed or a wait. Never throws. */
async function execute(runId: string, a: Automation, contactId: string | null, event: RunEvent, from: number): Promise<void> {
  const steps = a.steps ?? [];
  let i = from;
  try {
    let contact = contactId ? await loadContact(contactId) : null;
    if (contactId && !contact) throw new StepError("Contact no longer exists.");
    for (; i < steps.length; i++) {
      const step = steps[i];
      if (step.type === "wait") {
        const mins = Math.max(1, Math.round(step.minutes || 1));
        await db
          .update(automationRuns)
          .set({ status: "waiting", stepIndex: i + 1, resumeAt: new Date(Date.now() + mins * 60_000) })
          .where(eq(automationRuns.id, runId));
        return;
      }
      await db.update(automationRuns).set({ stepIndex: i }).where(eq(automationRuns.id, runId));
      await runStep(step, a, contact, event);
      if (contact && MUTATES_CONTACT.has(step.type)) contact = await loadContact(contact.id);
    }
    await db.update(automationRuns).set({ status: "done", stepIndex: steps.length, resumeAt: null }).where(eq(automationRuns.id, runId));
  } catch (e) {
    const msg = e instanceof StepError ? e.message : errorMessage(e);
    await db
      .update(automationRuns)
      .set({ status: "failed", stepIndex: i, resumeAt: null, error: msg.slice(0, 500) })
      .where(eq(automationRuns.id, runId))
      .catch((err: unknown) => console.error("[automations] could not record failure", err));
  }
}

async function start(a: Automation, contactId: string | null, event: AppEvent): Promise<void> {
  const runId = crypto.randomUUID();
  await db.insert(automationRuns).values({ id: runId, automationId: a.id, contactId, status: "running", stepIndex: 0 });
  await db.update(automations).set({ runs: sql`${automations.runs} + 1` }).where(eq(automations.id, a.id));
  await execute(runId, a, contactId, event, 0);
}

/* ------------------------------------------------------------ public API */

export async function handleEvent(event: AppEvent): Promise<void> {
  if (event.name === "message.status") return;
  try {
    const active = await db.select().from(automations).where(eq(automations.active, true));
    const matching = active.filter((a) => a.trigger && triggerMatches(a.trigger, event));
    if (!matching.length) return;

    const contactId = "contactId" in event ? event.contactId : null;
    if (event.name === "message.received") {
      const c = await loadContact(event.contactId);
      if (!c || c.optedOut) return;
    }

    for (const a of matching) {
      try {
        if (contactId) {
          const recent = await db
            .select({ id: automationRuns.id })
            .from(automationRuns)
            .where(
              and(
                eq(automationRuns.automationId, a.id),
                eq(automationRuns.contactId, contactId),
                gt(automationRuns.createdAt, new Date(Date.now() - RETRIGGER_MS)),
              ),
            )
            .limit(1);
          if (recent.length) continue; // loop / burst guard
        }
        await start(a, contactId, event);
      } catch (e) {
        console.error(`[automations] ${a.name} failed to start`, e);
      }
    }
  } catch (e) {
    console.error("[automations] handleEvent failed", e);
  }
}

export async function runDueAutomations(): Promise<{ resumed: number }> {
  let resumed = 0;
  const due = await db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(and(eq(automationRuns.status, "waiting"), lte(automationRuns.resumeAt, new Date())))
    .orderBy(automationRuns.resumeAt)
    .limit(RESUME_BATCH);

  for (const { id } of due) {
    // atomic claim: only one worker flips waiting → running
    const res = await db
      .update(automationRuns)
      .set({ status: "running", resumeAt: null })
      .where(and(eq(automationRuns.id, id), eq(automationRuns.status, "waiting")));
    const claimed = (res as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
    if (!claimed) continue;

    try {
      const [run] = await db.select().from(automationRuns).where(eq(automationRuns.id, id)).limit(1);
      if (!run) continue;
      const [a] = await db.select().from(automations).where(eq(automations.id, run.automationId)).limit(1);
      if (!a || !a.active) {
        await db
          .update(automationRuns)
          .set({ status: "failed", error: a ? "Automation was turned off before this run resumed." : "Automation was deleted." })
          .where(eq(automationRuns.id, id));
        continue;
      }
      resumed++;
      await execute(id, a, run.contactId, { name: "automation.resumed", runId: id }, run.stepIndex);
    } catch (e) {
      console.error("[automations] resume failed", e);
    }
  }
  return { resumed };
}
