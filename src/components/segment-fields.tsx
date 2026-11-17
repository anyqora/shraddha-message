/* Shared (client + server) definitions for segment rules. No JSX, no server imports. */

export type SegmentFieldKind = "text" | "list" | "bool" | "enum" | "user" | "date" | "activity" | "month";

export const TEXT_OPS: [string, string][] = [
  ["contains", "contains"],
  ["not_contains", "does not contain"],
  ["is", "is"],
  ["is_not", "is not"],
  ["empty", "is empty"],
  ["not_empty", "is not empty"],
];

export const OPS: Record<SegmentFieldKind, [string, string][]> = {
  text: TEXT_OPS,
  list: [["in", "is in"], ["not_in", "is not in"]],
  bool: [["is", "is true"], ["is_not", "is false"]],
  enum: [["is", "is"], ["is_not", "is not"]],
  user: [["is", "is"], ["is_not", "is not"], ["empty", "is unassigned"], ["not_empty", "is assigned"]],
  date: [["within_days", "within last N days"], ["older_than_days", "more than N days ago"], ["before", "before date"], ["after", "after date"]],
  activity: [["within_days", "within last N days"], ["older_than_days", "more than N days ago"], ["never", "never"], ["ever", "at any time"]],
  month: [["is", "is in month"], ["empty", "is not set"]],
};

export const BASE_FIELDS: { field: string; label: string; kind: SegmentFieldKind; options?: [string, string][] }[] = [
  { field: "name", label: "Name", kind: "text" },
  { field: "phone", label: "Phone", kind: "text" },
  { field: "email", label: "Email", kind: "text" },
  { field: "list", label: "List", kind: "list" },
  { field: "opted_out", label: "Opted out", kind: "bool" },
  { field: "chat_status", label: "Chat status", kind: "enum", options: [["open", "Open"], ["closed", "Closed"]] },
  { field: "channel", label: "Channel", kind: "enum", options: [["whatsapp", "WhatsApp"], ["web", "Web chat"]] },
  { field: "assigned_to", label: "Assigned to", kind: "user" },
  { field: "created", label: "Created", kind: "date" },
  { field: "last_inbound", label: "Last inbound message", kind: "activity" },
  { field: "last_message", label: "Last message (any direction)", kind: "activity" },
  { field: "birthday", label: "Birthday month", kind: "month" },
];

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function fieldKind(field: string): SegmentFieldKind {
  if (field.startsWith("custom.")) return "text";
  return BASE_FIELDS.find((f) => f.field === field)?.kind ?? "text";
}

/** Ops that take no value. */
export const NO_VALUE_OPS = new Set(["empty", "not_empty", "never", "ever"]);
export function opNeedsValue(field: string, op: string) {
  if (fieldKind(field) === "bool") return false;
  return !NO_VALUE_OPS.has(op);
}

export function defaultRule(field = "name"): { field: string; op: string; value?: string } {
  const kind = fieldKind(field);
  const op = OPS[kind][0][0];
  const opt = BASE_FIELDS.find((f) => f.field === field)?.options;
  const value = kind === "enum" ? opt?.[0]?.[0] ?? "" : kind === "date" || kind === "activity" ? "30" : kind === "month" ? "1" : "";
  return { field, op, value };
}
