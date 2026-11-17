import "server-only";
import { and, eq, gte, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { contacts, segments, type Segment, type SegmentRule } from "@/db/schema";
import { fieldKind, opNeedsValue } from "@/components/segment-fields";

type SegLike = Pick<Segment, "match" | "rules">;

const DAY = 86_400_000;

function textCond(col: SQL, op: string, v: string): SQL | undefined {
  const c = sql`coalesce(${col}, '')`;
  const esc = v.replace(/[\\%_]/g, (m) => `\\${m}`);
  switch (op) {
    case "contains": return sql`${c} like ${`%${esc}%`}`;
    case "not_contains": return sql`${c} not like ${`%${esc}%`}`;
    case "is": return sql`${c} = ${v}`;
    case "is_not": return sql`${c} <> ${v}`;
    case "empty": return sql`${c} = ''`;
    case "not_empty": return sql`${c} <> ''`;
  }
  return undefined;
}

function customCol(key: string): SQL {
  // JSON path with the key quoted; escape backslashes and double quotes. The path itself is a bound parameter.
  const path = `$."${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return sql`json_unquote(json_extract(${contacts.custom}, ${path}))`;
}

function days(v: string | undefined) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function dateCond(col: typeof contacts.createdAt | typeof contacts.lastInboundAt | typeof contacts.lastMessageAt, op: string, v: string): SQL | undefined {
  if (op === "never") return isNull(col);
  if (op === "ever") return isNotNull(col);
  if (op === "within_days" || op === "older_than_days") {
    const n = days(v);
    if (n === null) return undefined;
    const cutoff = new Date(Date.now() - n * DAY);
    return op === "within_days" ? gte(col, cutoff) : lt(col, cutoff);
  }
  if (op === "before" || op === "after") {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return undefined;
    return op === "before" ? lt(col, d) : gte(col, d);
  }
  return undefined;
}

export function ruleWhere(r: SegmentRule): SQL | undefined {
  const v = String(r.value ?? "").trim();
  if (opNeedsValue(r.field, r.op) && !v && fieldKind(r.field) !== "text") return undefined;
  if (r.field.startsWith("custom.")) {
    const key = r.field.slice(7);
    return key ? textCond(customCol(key), r.op, v) : undefined;
  }
  switch (r.field) {
    case "name": return textCond(sql`${contacts.name}`, r.op, v);
    case "phone": return textCond(sql`${contacts.phone}`, r.op, r.op === "contains" || r.op === "not_contains" ? v.replace(/\D/g, "") || v : v);
    case "email": return textCond(sql`${contacts.email}`, r.op, v);
    case "list": {
      const inList = sql`${contacts.id} in (select contact_id from list_members where list_id = ${v})`;
      return r.op === "not_in" ? sql`not (${inList})` : inList;
    }
    case "opted_out": return eq(contacts.optedOut, r.op !== "is_not");
    case "chat_status":
      if (v !== "open" && v !== "closed") return undefined;
      return r.op === "is_not" ? sql`${contacts.chatStatus} <> ${v}` : eq(contacts.chatStatus, v);
    case "channel":
      if (v !== "whatsapp" && v !== "web") return undefined;
      return r.op === "is_not" ? sql`${contacts.channel} <> ${v}` : eq(contacts.channel, v);
    case "assigned_to":
      if (r.op === "empty") return isNull(contacts.assignedTo);
      if (r.op === "not_empty") return isNotNull(contacts.assignedTo);
      return r.op === "is_not" ? or(isNull(contacts.assignedTo), sql`${contacts.assignedTo} <> ${v}`) : eq(contacts.assignedTo, v);
    case "created": return dateCond(contacts.createdAt, r.op, v);
    case "last_inbound": return dateCond(contacts.lastInboundAt, r.op, v);
    case "last_message": return dateCond(contacts.lastMessageAt, r.op, v);
    case "birthday": {
      if (r.op === "empty") return sql`coalesce(${contacts.birthday}, '') = ''`;
      const m = Math.floor(Number(v));
      if (!(m >= 1 && m <= 12)) return undefined;
      return sql`${contacts.birthday} like ${`${String(m).padStart(2, "0")}-%`}`;
    }
  }
  return undefined;
}

/** Drizzle condition for a segment. Invalid/incomplete rules are ignored; no valid rules = everyone. */
export function segmentWhere(segment: SegLike): SQL {
  const conds = (Array.isArray(segment.rules) ? segment.rules : []).map(ruleWhere).filter((c): c is SQL => !!c);
  if (!conds.length) return sql`1 = 1`;
  return (segment.match === "any" ? or(...conds) : and(...conds))!;
}

export async function getSegment(id: string): Promise<Segment | null> {
  const [s] = await db.select().from(segments).where(eq(segments.id, id)).limit(1);
  return s ?? null;
}

export async function countSegment(segment: SegLike): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(contacts).where(segmentWhere(segment));
  return Number(n);
}

export async function segmentContactIds(segment: SegLike): Promise<string[]> {
  const rows = await db.select({ id: contacts.id }).from(contacts).where(segmentWhere(segment));
  return rows.map((r) => r.id);
}

/** Distinct keys used in contacts.custom (for builders). */
export async function customFieldKeys(): Promise<string[]> {
  const res = await db
    .execute(sql`select distinct jt.k from contacts, json_table(json_keys(contacts.custom), '$[*]' columns (k varchar(191) path '$')) jt limit 200`)
    .catch(() => [[]]);
  return (((res as any)[0] ?? []) as { k: string }[]).map((r) => r.k).filter(Boolean);
}
