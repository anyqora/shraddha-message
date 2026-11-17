import type { BotOption } from "@/db/schema";

export type RuleInput = {
  name: string;
  trigger: "keyword" | "welcome" | "fallback" | "menu";
  keywords: string;
  matchType: "exact" | "contains" | "starts";
  replyType: "text" | "buttons" | "list";
  header: string;
  body: string;
  footer: string;
  listButton: string;
  options: BotOption[];
  handoff: boolean;
  active: boolean;
  priority: number;
};

export const LIMITS = {
  body: 1024,
  header: 60,
  footer: 60,
  listButton: 20,
  buttons: { max: 3, title: 20 },
  list: { max: 10, title: 24, description: 72 },
};

/** Returns a list of human-readable problems (empty = valid). Shared by the form and the server action. */
export function validateRule(r: RuleInput): string[] {
  const e: string[] = [];
  if (!r.name.trim()) e.push("Name is required.");
  if (!r.body.trim()) e.push("Message body is required.");
  if (r.body.length > LIMITS.body) e.push(`Body must be ${LIMITS.body} characters or less.`);
  if (r.header.length > LIMITS.header) e.push(`Header must be ${LIMITS.header} characters or less.`);
  if (r.footer.length > LIMITS.footer) e.push(`Footer must be ${LIMITS.footer} characters or less.`);
  if (r.trigger === "keyword" && !r.keywords.split(",").some((k) => k.trim())) e.push("Keyword rules need at least one keyword.");
  if (r.replyType === "buttons" || r.replyType === "list") {
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
    if (r.replyType === "list") {
      if (!r.listButton.trim()) e.push("List button text is required.");
      if (r.listButton.length > LIMITS.listButton) e.push(`List button must be ${LIMITS.listButton} characters or less.`);
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
