// Pure helpers shared by the drip engine, server actions and client components.
import type { DripStep } from "@/db/schema";

type PlaceholderContact = { name?: string | null; phone?: string | null; email?: string | null; custom?: Record<string, string> | null };

/** Replace {{name}}, {{phone}}, {{email}} and {{custom.Field}} placeholders. */
export function fillPlaceholders(text: string, c: PlaceholderContact, nameFallback = "there"): string {
  return text
    .replace(/\{\{\s*name\s*\}\}/gi, () => c.name || nameFallback || c.phone || "")
    .replace(/\{\{\s*phone\s*\}\}/gi, () => (c.phone ? `+${c.phone}` : ""))
    .replace(/\{\{\s*email\s*\}\}/gi, () => c.email ?? "")
    .replace(/\{\{\s*custom\.([^}]+?)\s*\}\}/gi, (_m, key: string) => {
      const custom = c.custom ?? {};
      const k = key.trim();
      if (k in custom) return custom[k] ?? "";
      const hit = Object.keys(custom).find((x) => x.toLowerCase() === k.toLowerCase());
      return hit ? custom[hit] ?? "" : "";
    });
}

export const SAMPLE_CONTACT: PlaceholderContact = { name: "Priya", phone: "919876543210", email: "priya@example.com", custom: {} };

/** Hours from enrollment until each step is sent (delays are relative to the previous step). */
export function cumulativeHours(steps: Pick<DripStep, "delayHours">[]): number[] {
  let t = 0;
  return steps.map((s) => (t += Math.max(0, Number(s.delayHours) || 0)));
}

/** "Day 1" = within the first 24h of enrollment. */
export function dayLabel(hoursFromStart: number): string {
  const day = Math.floor(hoursFromStart / 24) + 1;
  const rem = hoursFromStart % 24;
  return `Day ${day}${rem ? ` · ${rem}h in` : ""}`;
}

export function validateSteps(steps: DripStep[], templateVars: (id: string) => number | undefined): string[] {
  const errs: string[] = [];
  if (!steps.length) errs.push("Add at least one step.");
  steps.forEach((s, i) => {
    const n = `Step ${i + 1}`;
    if (!Number.isFinite(s.delayHours) || s.delayHours < 0) errs.push(`${n}: delay must be 0 or more hours.`);
    if (s.delayHours > 24 * 365) errs.push(`${n}: delay can be at most a year.`);
    if (s.kind === "text") {
      if (!s.text?.trim()) errs.push(`${n}: enter the message text.`);
    } else {
      if (!s.templateId) errs.push(`${n}: choose a template.`);
      else {
        const vars = templateVars(s.templateId);
        if (vars === undefined) errs.push(`${n}: template is not approved or no longer exists.`);
        else if ((s.body ?? []).slice(0, vars).some((v) => !v?.trim()) || (s.body ?? []).length < vars)
          errs.push(`${n}: fill every template parameter.`);
      }
    }
  });
  return errs;
}

/** Parse many common date formats into "MM-DD" (day-first for ambiguous a/b dates, as used in India). */
export function toMonthDay(input: string | null | undefined): string | null {
  const s = String(input ?? "").trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;
  let month = 0;
  let day = 0;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) {
    month = +m[2];
    day = +m[3];
  } else if ((m = s.match(/^(\d{1,2})-(\d{1,2})$/)) && s.length === 5 && +m[1] <= 12) {
    // already stored "MM-DD"
    month = +m[1];
    day = +m[2];
  } else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?$/))) {
    day = +m[1];
    month = +m[2];
    if (month > 12 && day <= 12) [day, month] = [month, day];
  } else {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    month = d.getMonth() + 1;
    day = d.getDate();
  }
  const max = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (!max || day < 1 || day > max) return null;
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatMonthDay(md: string | null | undefined): string {
  if (!md || !/^\d{2}-\d{2}$/.test(md)) return "";
  return `${Number(md.slice(3))} ${MONTHS[Number(md.slice(0, 2)) - 1] ?? ""}`;
}
