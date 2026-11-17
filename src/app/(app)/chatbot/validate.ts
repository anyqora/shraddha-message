import type { BotOption } from "@/db/schema";

export type ReplyType = "text" | "buttons" | "list" | "question" | "book" | "lead";
export type Validation = "none" | "email" | "phone" | "number" | "date";

export type RuleInput = {
  name: string;
  trigger: "keyword" | "welcome" | "fallback" | "menu";
  keywords: string;
  matchType: "exact" | "contains" | "starts";
  replyType: ReplyType;
  header: string;
  body: string;
  footer: string;
  listButton: string;
  options: BotOption[];
  saveTo: string;
  validation: Validation;
  nextRuleId: string | null;
  handoff: boolean;
  active: boolean;
  priority: number;
};

export const LIMITS = {
  body: 1024,
  header: 60,
  footer: 60,
  listButton: 20,
  saveKey: 60,
  buttons: { max: 3, title: 20 },
  list: { max: 10, title: 24, description: 72 },
};

export const REPLY_TYPES: ReplyType[] = ["text", "buttons", "list", "question", "book", "lead"];
export const REPLY_META: Record<ReplyType, { label: string; short: string; hint: string }> = {
  text: { label: "Text", short: "Text", hint: "A plain text message." },
  buttons: { label: "Buttons ≤3", short: "Buttons", hint: "Up to 3 quick-reply buttons." },
  list: { label: "List ≤10", short: "List", hint: "A menu of up to 10 rows." },
  question: { label: "Question", short: "Question", hint: "Asks something, waits for a typed answer and saves it." },
  book: { label: "Book appointment", short: "Booking", hint: "Offers the next free appointment slots as a list and books the one tapped." },
  lead: { label: "Save lead", short: "Save lead", hint: "Saves the answers collected so far as a lead, then sends this message." },
};

export const VALIDATION_META: Record<Validation, string> = {
  none: "Any text",
  email: "Email address",
  phone: "Phone number",
  number: "Number",
  date: "Date",
};

/** Reply types that use the "next step" (nextRuleId) link. */
export const usesNext = (t: ReplyType) => t === "question" || t === "book" || t === "lead";
export const hasOptions = (t: ReplyType) => t === "buttons" || t === "list";

/** saveTo string ⇄ picker parts. */
export type SaveKind = "name" | "email" | "custom" | "answer";
export function parseSaveTo(s: string): { kind: SaveKind; key: string } {
  if (s === "name" || s === "email") return { kind: s, key: "" };
  if (s.startsWith("custom:")) return { kind: "custom", key: s.slice(7) };
  if (s.startsWith("answer:")) return { kind: "answer", key: s.slice(7) };
  return { kind: "answer", key: s };
}
export function joinSaveTo(kind: SaveKind, key: string): string {
  return kind === "name" || kind === "email" ? kind : `${kind}:${key.trim()}`;
}

const SAVE_KEY_RE = /^[A-Za-z0-9 _-]+$/;

/** Returns a list of human-readable problems (empty = valid). Shared by the form and the server action. */
export function validateRule(r: RuleInput): string[] {
  const e: string[] = [];
  if (!r.name.trim()) e.push("Name is required.");
  if (!r.body.trim() && r.replyType !== "lead") e.push("Message body is required.");
  if (r.body.length > LIMITS.body) e.push(`Body must be ${LIMITS.body} characters or less.`);
  if (r.header.length > LIMITS.header) e.push(`Header must be ${LIMITS.header} characters or less.`);
  if (r.footer.length > LIMITS.footer) e.push(`Footer must be ${LIMITS.footer} characters or less.`);
  if (r.trigger === "keyword" && !r.keywords.split(",").some((k) => k.trim())) e.push("Keyword rules need at least one keyword.");
  if (hasOptions(r.replyType)) {
    const lim = r.replyType === "buttons" ? LIMITS.buttons : LIMITS.list;
    const label = r.replyType === "buttons" ? "buttons" : "list rows";
    if (!r.options.length) e.push(`Add at least one ${r.replyType === "buttons" ? "button" : "list row"}.`);
    if (r.options.length > lim.max) e.push(`WhatsApp allows at most ${lim.max} ${label}.`);
    r.options.forEach((o, i) => {
      if (!o.title.trim()) e.push(`Option ${i + 1} needs a title.`);
      if (o.title.length > lim.title) e.push(`Option ${i + 1} title must be ${lim.title} characters or less.`);
      if (r.replyType === "list" && (o.description ?? "").length > LIMITS.list.description)
        e.push(`Option ${i + 1} description must be ${LIMITS.list.description} characters or less.`);
    });
  }
  if (r.replyType === "list" && !r.listButton.trim()) e.push("List button text is required.");
  if ((r.replyType === "list" || r.replyType === "book") && r.listButton.length > LIMITS.listButton)
    e.push(`List button must be ${LIMITS.listButton} characters or less.`);
  if (r.replyType === "question") {
    if (!r.saveTo.trim()) e.push("Choose where to save the answer.");
    else {
      const { kind, key } = parseSaveTo(r.saveTo);
      if ((kind === "custom" || kind === "answer") && !key.trim()) e.push(`Give the ${kind === "custom" ? "custom field" : "lead answer"} a name.`);
      else if (key && (!SAVE_KEY_RE.test(key) || key.length > LIMITS.saveKey))
        e.push(`Field names may use letters, numbers, spaces, _ and - (≤${LIMITS.saveKey}).`);
    }
  }
  return e;
}

export const TRIGGER_META: Record<RuleInput["trigger"], { label: string; color: string }> = {
  welcome: { label: "Welcome", color: "green" },
  keyword: { label: "Keyword", color: "blue" },
  menu: { label: "Menu step", color: "purple" },
  fallback: { label: "Fallback", color: "orange" },
};

/** Placeholders usable in question / lead / booking messages. */
export const PLACEHOLDER_HINT = "Placeholders: {{name}}, {{phone}}, {{email}}, {{answer.key}} (e.g. {{answer.city}}).";
