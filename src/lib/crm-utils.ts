/* Client-safe CRM helpers (formatting / dates). */

export function inr(n: number | null | undefined): string {
  return "₹" + Math.round(Number(n ?? 0)).toLocaleString("en-IN");
}

/** YYYY-MM-DD of a date in India time. */
export function istDay(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Parse a <input type="date"> value as midnight India time. */
export function parseIstDate(v: string | null | undefined): Date | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T00:00:00+05:30`);
}

export function formatDay(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export type DueBucket = "overdue" | "today" | "upcoming" | "none";
export function dueBucket(d: Date | string | null | undefined): DueBucket {
  if (!d) return "none";
  const day = istDay(d);
  const today = istDay(new Date());
  return day < today ? "overdue" : day === today ? "today" : "upcoming";
}

export const STAGE_KIND_COLOR: Record<string, string> = { open: "blue", won: "green", lost: "red" };

export type TaskItem = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done";
  dueAt: Date | null;
  completedAt: Date | null;
  assignee: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  company: { id: string; name: string } | null;
  deal: { id: string; title: string } | null;
};

export type NoteItem = {
  id: string;
  body: string;
  createdAt: Date;
  authorName: string | null;
};

export type CrmTarget = { contactId?: string; companyId?: string; dealId?: string };
export type Option = { id: string; name: string };
