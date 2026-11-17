import type { AutomationStep, AutomationTrigger } from "@/db/schema";

/* Shared (client + server) metadata and validation for automations. */

export type TriggerType = AutomationTrigger["type"];
export type StepType = AutomationStep["type"];

export const TRIGGER_META: Record<TriggerType, { label: string; hint: string; color: string }> = {
  "contact.created": { label: "New contact", hint: "A contact is created (first inbound message, import or manual add).", color: "green" },
  "message.received": { label: "Message received", hint: "A customer sends a WhatsApp message, optionally matching keywords.", color: "blue" },
  "contact.list_added": { label: "Added to list", hint: "A contact is added to a specific list.", color: "purple" },
  "chat.assigned": { label: "Chat assigned", hint: "A conversation is assigned (or unassigned).", color: "orange" },
  "campaign.completed": { label: "Campaign completed", hint: "A broadcast campaign finishes. No contact — only webhook steps run.", color: "turquoise" },
};
export const TRIGGER_TYPES = Object.keys(TRIGGER_META) as TriggerType[];

export const STEP_META: Record<StepType, { label: string; color: string; needsContact: boolean }> = {
  send_text: { label: "Send WhatsApp text", color: "green", needsContact: true },
  send_template: { label: "Send template", color: "green", needsContact: true },
  add_to_list: { label: "Add to list", color: "purple", needsContact: true },
  remove_from_list: { label: "Remove from list", color: "purple", needsContact: true },
  assign: { label: "Assign chat", color: "orange", needsContact: true },
  close_chat: { label: "Close chat", color: "gray", needsContact: true },
  pause_bot: { label: "Pause chatbot", color: "gray", needsContact: true },
  add_note: { label: "Add note", color: "yellow", needsContact: true },
  create_task: { label: "Create task", color: "yellow", needsContact: true },
  webhook: { label: "Call webhook", color: "pink", needsContact: false },
  wait: { label: "Wait", color: "blue", needsContact: false },
};
export const STEP_TYPES = Object.keys(STEP_META) as StepType[];

export function defaultStep(type: StepType): AutomationStep {
  switch (type) {
    case "send_text": return { type, text: "" };
    case "send_template": return { type, templateId: "", body: [] };
    case "add_to_list": return { type, listId: "" };
    case "remove_from_list": return { type, listId: "" };
    case "assign": return { type, userId: null };
    case "close_chat": return { type };
    case "pause_bot": return { type, hours: 24 };
    case "add_note": return { type, text: "" };
    case "create_task": return { type, title: "", dueInHours: 24 };
    case "webhook": return { type, url: "" };
    case "wait": return { type, minutes: 60 };
  }
}

export function defaultTrigger(type: TriggerType): AutomationTrigger {
  switch (type) {
    case "message.received": return { type, keywords: "", matchType: "contains" };
    case "contact.list_added": return { type, listId: "" };
    default: return { type };
  }
}

export function triggerSummary(t: AutomationTrigger, listName?: (id: string) => string | undefined): string {
  const label = TRIGGER_META[t.type]?.label ?? t.type;
  if (t.type === "message.received") {
    const kw = (t.keywords ?? "").split(",").map((k) => k.trim()).filter(Boolean);
    return kw.length ? `${label} · ${t.matchType ?? "contains"}: ${kw.join(", ")}` : `${label} · any`;
  }
  if (t.type === "contact.list_added") return `${label} · ${listName?.(t.listId) ?? "unknown list"}`;
  return label;
}

export function waitLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} min`;
}

export type AutomationInput = { name: string; active: boolean; trigger: AutomationTrigger; steps: AutomationStep[] };

const str = (v: unknown, max = 4000) => String(v ?? "").slice(0, max);
const num = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Coerce untrusted JSON into a well-formed automation (unknown fields dropped). */
export function normalizeAutomation(raw: unknown): AutomationInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const tr = (r.trigger ?? {}) as Record<string, unknown>;
  const tType = (TRIGGER_TYPES.includes(tr.type as TriggerType) ? tr.type : "contact.created") as TriggerType;
  let trigger: AutomationTrigger;
  if (tType === "message.received") {
    const mt = ["exact", "contains", "starts"].includes(String(tr.matchType)) ? (tr.matchType as "exact" | "contains" | "starts") : "contains";
    const keywords = str(tr.keywords, 1000).split(",").map((k) => k.trim()).filter(Boolean).join(",");
    trigger = { type: tType, keywords, matchType: mt };
  } else if (tType === "contact.list_added") {
    trigger = { type: tType, listId: str(tr.listId, 36) };
  } else trigger = { type: tType };

  const steps: AutomationStep[] = (Array.isArray(r.steps) ? r.steps : []).slice(0, 50).map((s0: unknown) => {
    const s = (s0 ?? {}) as Record<string, unknown>;
    const type = (STEP_TYPES.includes(s.type as StepType) ? s.type : "send_text") as StepType;
    switch (type) {
      case "send_text": return { type, text: str(s.text).trim() };
      case "send_template": return { type, templateId: str(s.templateId, 36), body: (Array.isArray(s.body) ? s.body : []).slice(0, 20).map((b) => str(b, 1000)) };
      case "add_to_list":
      case "remove_from_list": return { type, listId: str(s.listId, 36) };
      case "assign": return { type, userId: s.userId ? str(s.userId, 36) : null };
      case "close_chat": return { type };
      case "pause_bot": return { type, hours: Math.round(num(s.hours, 24)) };
      case "add_note": return { type, text: str(s.text).trim() };
      case "create_task": return { type, title: str(s.title, 255).trim(), dueInHours: s.dueInHours === "" || s.dueInHours == null ? undefined : Math.round(num(s.dueInHours, 24)) };
      case "webhook": return { type, url: str(s.url, 1000).trim() };
      case "wait": return { type, minutes: Math.round(num(s.minutes, 60)) };
    }
  });
  return { name: str(r.name, 191).trim(), active: r.active !== false, trigger, steps };
}

/** Returns a list of human-readable problems; empty = valid. */
export function validateAutomation(a: AutomationInput, opts?: { templateVars?: (id: string) => number | undefined }): string[] {
  const e: string[] = [];
  if (!a.name) e.push("Give the automation a name.");
  if (a.trigger.type === "contact.list_added" && !a.trigger.listId) e.push("Pick the list for the “Added to list” trigger.");
  if (!a.steps.length) e.push("Add at least one step.");
  const noContact = a.trigger.type === "campaign.completed";
  a.steps.forEach((s, i) => {
    const n = `Step ${i + 1}:`;
    if (noContact && STEP_META[s.type].needsContact) e.push(`${n} “${STEP_META[s.type].label}” needs a contact, but campaign triggers have none.`);
    switch (s.type) {
      case "send_text": if (!s.text) e.push(`${n} message text is empty.`); else if (s.text.length > 4096) e.push(`${n} message is longer than 4096 characters.`); break;
      case "send_template": {
        if (!s.templateId) { e.push(`${n} pick a template.`); break; }
        const need = opts?.templateVars?.(s.templateId);
        if (need !== undefined && s.body.slice(0, need).filter((b) => b.trim()).length < need) e.push(`${n} fill all ${need} template variable(s).`);
        break;
      }
      case "add_to_list":
      case "remove_from_list": if (!s.listId) e.push(`${n} pick a list.`); break;
      case "pause_bot": if (!(s.hours >= 1 && s.hours <= 720)) e.push(`${n} pause hours must be 1–720.`); break;
      case "add_note": if (!s.text) e.push(`${n} note text is empty.`); break;
      case "create_task":
        if (!s.title) e.push(`${n} task title is empty.`);
        if (s.dueInHours !== undefined && !(s.dueInHours >= 0 && s.dueInHours <= 8760)) e.push(`${n} due-in hours must be 0–8760.`);
        break;
      case "webhook": if (!/^https?:\/\/\S+$/i.test(s.url)) e.push(`${n} webhook URL must start with http:// or https://.`); break;
      case "wait": if (!(s.minutes >= 1 && s.minutes <= 60 * 24 * 90)) e.push(`${n} wait must be between 1 minute and 90 days.`); break;
    }
  });
  if (a.steps.length && a.steps[a.steps.length - 1].type === "wait") e.push("The last step can’t be a wait.");
  return e;
}
