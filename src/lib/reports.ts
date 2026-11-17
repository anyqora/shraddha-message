import "server-only";
import { and, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { campaignRecipients, campaigns, contacts, messages, tasks, users } from "@/db/schema";
import { summarize } from "./campaign-runner";

/* ------------------------------------------------------------ range */

const IST_MS = 330 * 60e3;
const DAY_MS = 864e5;
const IST = sql`interval 330 minute`;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PRESETS = [7, 30, 90] as const;
export const MAX_RANGE_DAYS = 366;

export type ReportRange = {
  /** UTC instant of IST midnight on fromDay (inclusive) */
  from: Date;
  /** UTC instant of IST midnight after toDay (exclusive) */
  to: Date;
  fromDay: string;
  toDay: string;
  /** preset day count, or null for a custom range */
  preset: number | null;
  days: { day: string; label: string }[];
};

const istToday = () => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);
const dayStart = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - IST_MS);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const validDay = (d?: string) => !!d && DAY_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

export function parseRange(sp: { range?: string; from?: string; to?: string }): ReportRange {
  let preset: number | null = null;
  let fromDay: string;
  let toDay: string;
  if (validDay(sp.from) && validDay(sp.to) && !sp.range) {
    fromDay = sp.from!;
    toDay = sp.to!;
    if (fromDay > toDay) [fromDay, toDay] = [toDay, fromDay];
    const today = istToday();
    if (toDay > today) toDay = today;
    if (fromDay > toDay) fromDay = toDay;
    const span = Math.round((Date.parse(toDay) - Date.parse(fromDay)) / DAY_MS) + 1;
    if (span > MAX_RANGE_DAYS) fromDay = addDays(toDay, -(MAX_RANGE_DAYS - 1));
  } else {
    const n = Number(sp.range);
    preset = (PRESETS as readonly number[]).includes(n) ? n : 30;
    toDay = istToday();
    fromDay = addDays(toDay, -(preset - 1));
  }
  const days: { day: string; label: string }[] = [];
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) {
    days.push({
      day: d,
      label: new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }),
    });
  }
  return { from: dayStart(fromDay), to: dayStart(addDays(toDay, 1)), fromDay, toDay, preset, days };
}

const dayExpr = (col: unknown) => sql<string>`date_format(${col} + ${IST}, '%Y-%m-%d')`;

/* --------------------------------------------------------- overview */

export type OverviewDay = { day: string; label: string; sent: number; received: number; newContacts: number; optOuts: number };
export type OverviewReport = {
  days: OverviewDay[];
  totals: { sent: number; received: number; delivered: number; read: number; failed: number; pending: number; newContacts: number; optOuts: number };
  rates: { delivered: number; read: number; failed: number };
};

export async function overviewReport(r: ReportRange): Promise<OverviewReport> {
  const inRange = (col: typeof messages.createdAt | typeof contacts.createdAt) => and(gte(col, r.from), lt(col, r.to));
  const [daily, statuses, newC, opt] = await Promise.all([
    db
      .select({ day: dayExpr(messages.createdAt), direction: messages.direction, n: sql<number>`count(*)` })
      .from(messages)
      .where(inRange(messages.createdAt))
      .groupBy(sql`1`, messages.direction),
    db
      .select({ status: messages.status, n: sql<number>`count(*)` })
      .from(messages)
      .where(and(inRange(messages.createdAt), eq(messages.direction, "out")))
      .groupBy(messages.status),
    db
      .select({ day: dayExpr(contacts.createdAt), n: sql<number>`count(*)` })
      .from(contacts)
      .where(inRange(contacts.createdAt))
      .groupBy(sql`1`),
    db
      .select({ day: dayExpr(contacts.optedOutAt), n: sql<number>`count(*)` })
      .from(contacts)
      .where(and(eq(contacts.optedOut, true), gte(contacts.optedOutAt, r.from), lt(contacts.optedOutAt, r.to)))
      .groupBy(sql`1`),
  ]);
  const byDay = new Map<string, OverviewDay>(r.days.map((d) => [d.day, { ...d, sent: 0, received: 0, newContacts: 0, optOuts: 0 }]));
  for (const x of daily) {
    const p = byDay.get(x.day);
    if (p) p[x.direction === "in" ? "received" : "sent"] += Number(x.n);
  }
  for (const x of newC) {
    const p = byDay.get(x.day);
    if (p) p.newContacts += Number(x.n);
  }
  for (const x of opt) {
    const p = byDay.get(x.day);
    if (p) p.optOuts += Number(x.n);
  }
  const st: Record<string, number> = {};
  for (const x of statuses) st[x.status] = Number(x.n);
  const s = summarize(st);
  const list = [...byDay.values()];
  const sum = (k: keyof OverviewDay) => list.reduce((a, d) => a + Number(d[k]), 0);
  const attempted = s.sent + s.failed;
  const pct = (v: number) => (attempted ? v / attempted : 0);
  return {
    days: list,
    totals: {
      sent: s.sent,
      received: sum("received"),
      delivered: s.delivered,
      read: s.read,
      failed: s.failed,
      pending: s.pending,
      newContacts: sum("newContacts"),
      optOuts: sum("optOuts"),
    },
    rates: { delivered: pct(s.delivered), read: pct(s.read), failed: pct(s.failed) },
  };
}

/* ----------------------------------------------------------- agents */

export const NON_HUMAN = new Set(["bot", "ai", "automation", "drip", "api"]);
const SILENCE_MS = 60 * 60e3;
/** Cap on messages scanned for first-response time; keeps memory bounded on huge ranges. */
const FRT_SCAN_LIMIT = 250_000;

export type AgentRow = {
  userId: string;
  name: string;
  email: string;
  role: string;
  assignedOpen: number;
  assignedTotal: number;
  sent: number;
  frtCount: number;
  frtMedianMin: number | null;
  frtAvgMin: number | null;
  closed: number;
  openTasks: number;
};
export type AgentsReport = { rows: AgentRow[]; truncated: boolean };

export async function agentsReport(r: ReportRange): Promise<AgentsReport> {
  const [people, assigned, sent, closed, openTasks, scan] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users),
    db
      .select({ id: contacts.assignedTo, open: sql<number>`coalesce(sum(${contacts.chatStatus} = 'open'),0)`, n: sql<number>`count(*)` })
      .from(contacts)
      .where(isNotNull(contacts.assignedTo))
      .groupBy(contacts.assignedTo),
    db
      .select({ id: messages.sentBy, n: sql<number>`count(*)` })
      .from(messages)
      .where(and(eq(messages.direction, "out"), gte(messages.createdAt, r.from), lt(messages.createdAt, r.to), isNotNull(messages.sentBy)))
      .groupBy(messages.sentBy),
    // no closed_at/closed_by column: a chat counts as closed by its assignee when it was last updated in range while closed
    db
      .select({ id: contacts.assignedTo, n: sql<number>`count(*)` })
      .from(contacts)
      .where(and(eq(contacts.chatStatus, "closed"), isNotNull(contacts.assignedTo), gte(contacts.updatedAt, r.from), lt(contacts.updatedAt, r.to)))
      .groupBy(contacts.assignedTo),
    db
      .select({ id: tasks.assigneeId, n: sql<number>`count(*)` })
      .from(tasks)
      .where(and(ne(tasks.status, "done"), isNotNull(tasks.assigneeId)))
      .groupBy(tasks.assigneeId),
    db
      .select({ contactId: messages.contactId, direction: messages.direction, sentBy: messages.sentBy, createdAt: messages.createdAt })
      .from(messages)
      .where(and(gte(messages.createdAt, new Date(r.from.getTime() - SILENCE_MS)), lt(messages.createdAt, r.to)))
      .orderBy(messages.contactId, messages.createdAt)
      .limit(FRT_SCAN_LIMIT + 1),
  ]);

  // first response: first human outbound after an inbound that followed >= 1h of silence
  const frt = new Map<string, number[]>();
  let cur = "";
  let prevAt = 0;
  let waitingSince: number | null = null;
  const truncated = scan.length > FRT_SCAN_LIMIT;
  for (const m of truncated ? scan.slice(0, FRT_SCAN_LIMIT) : scan) {
    const t = new Date(m.createdAt).getTime();
    if (m.contactId !== cur) {
      cur = m.contactId;
      prevAt = 0;
      waitingSince = null;
    }
    if (m.direction === "in") {
      const silent = prevAt ? t - prevAt >= SILENCE_MS : t >= r.from.getTime();
      if (waitingSince === null && silent && t >= r.from.getTime()) waitingSince = t;
    } else if (waitingSince !== null && m.sentBy && !NON_HUMAN.has(m.sentBy)) {
      const arr = frt.get(m.sentBy) ?? [];
      arr.push((t - waitingSince) / 60e3);
      frt.set(m.sentBy, arr);
      waitingSince = null;
    }
    prevAt = t;
  }

  const toMap = (rows: { id: string | null; n: number }[]) => new Map(rows.map((x) => [x.id ?? "", Number(x.n)]));
  const sentM = toMap(sent);
  const closedM = toMap(closed);
  const tasksM = toMap(openTasks);
  const assignedM = new Map(assigned.map((x) => [x.id ?? "", { open: Number(x.open), n: Number(x.n) }]));

  const rows = people.map((p): AgentRow => {
    const times = (frt.get(p.id) ?? []).sort((a, b) => a - b);
    const mid = Math.floor(times.length / 2);
    const median = !times.length ? null : times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2;
    return {
      userId: p.id,
      name: p.name || p.email,
      email: p.email,
      role: p.role,
      assignedOpen: assignedM.get(p.id)?.open ?? 0,
      assignedTotal: assignedM.get(p.id)?.n ?? 0,
      sent: sentM.get(p.id) ?? 0,
      frtCount: times.length,
      frtMedianMin: median,
      frtAvgMin: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
      closed: closedM.get(p.id) ?? 0,
      openTasks: tasksM.get(p.id) ?? 0,
    };
  });
  rows.sort((a, b) => b.sent - a.sent || a.name.localeCompare(b.name));
  return { rows, truncated };
}

/* -------------------------------------------------------- campaigns */

export const DEFAULT_COST_PER_MSG = 0.8;

export type CampaignRow = {
  id: string;
  name: string;
  status: string;
  startedAt: string;
  recipients: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  replied: number;
  wonDeals: number;
  wonValue: number;
};

export async function campaignsReport(r: ReportRange): Promise<CampaignRow[]> {
  const start = sql`coalesce(${campaigns.startedAt}, ${campaigns.scheduledAt})`;
  const list = await db
    .select({ id: campaigns.id, name: campaigns.name, status: campaigns.status, startedAt: sql<Date>`${start}` })
    .from(campaigns)
    .where(and(sql`${start} >= ${r.from}`, sql`${start} < ${r.to}`))
    .orderBy(sql`${start} desc`)
    .limit(500);
  if (!list.length) return [];
  const ids = list.map((c) => c.id);
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const [stats, replied, won] = await Promise.all([
    db
      .select({ id: campaignRecipients.campaignId, status: campaignRecipients.status, n: sql<number>`count(*)` })
      .from(campaignRecipients)
      .where(inArray(campaignRecipients.campaignId, ids))
      .groupBy(campaignRecipients.campaignId, campaignRecipients.status),
    db.execute(sql`
      select r.campaign_id as id, count(*) as n
      from campaign_recipients r
      where r.campaign_id in (${idList}) and r.sent_at is not null and r.contact_id is not null
        and exists (
          select 1 from messages m
          where m.contact_id = r.contact_id and m.direction = 'in'
            and m.created_at > r.sent_at and m.created_at <= r.sent_at + interval 24 hour
        )
      group by r.campaign_id`),
    db.execute(sql`
      select x.campaign_id as id, count(*) as n, coalesce(sum(d.amount),0) as v
      from (
        select distinct cr.campaign_id, cr.contact_id, coalesce(c.started_at, c.scheduled_at) as started
        from campaign_recipients cr join campaigns c on c.id = cr.campaign_id
        where cr.campaign_id in (${idList}) and cr.contact_id is not null and cr.status in ('sent','delivered','read')
      ) x
      join deals d on d.contact_id = x.contact_id and d.updated_at >= x.started
      join pipeline_stages s on s.id = d.stage_id and s.kind = 'won'
      group by x.campaign_id`),
  ]);
  const rows0 = (res: unknown) => ((res as unknown as [Record<string, unknown>[]])[0] ?? []) as Record<string, unknown>[];
  const statM = new Map<string, Record<string, number>>();
  for (const s of stats) {
    const m = statM.get(s.id) ?? {};
    m[s.status] = Number(s.n);
    statM.set(s.id, m);
  }
  const repM = new Map(rows0(replied).map((x) => [String(x.id), Number(x.n)]));
  const wonM = new Map(rows0(won).map((x) => [String(x.id), { n: Number(x.n), v: Number(x.v) }]));
  return list.map((c) => {
    const raw = statM.get(c.id) ?? {};
    const s = summarize(raw);
    const recipients = Object.values(raw).reduce((a, b) => a + b, 0);
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      startedAt: new Date(c.startedAt).toISOString(),
      recipients,
      sent: s.sent,
      delivered: s.delivered,
      read: s.read,
      failed: s.failed,
      replied: repM.get(c.id) ?? 0,
      wonDeals: wonM.get(c.id)?.n ?? 0,
      wonValue: wonM.get(c.id)?.v ?? 0,
    };
  });
}

/* ------------------------------------------------- bot & automation */

export const SENDER_KINDS = [
  { key: "human", label: "Team", color: "#2a78d6" },
  { key: "campaign", label: "Campaigns", color: "#eb6834" },
  { key: "bot", label: "Chatbot", color: "#1baf7a" },
  { key: "ai", label: "AI", color: "#eda100" },
  { key: "automation", label: "Automations", color: "#e87ba4" },
  { key: "drip", label: "Drips", color: "#008300" },
  { key: "api", label: "API", color: "#6250d6" },
  { key: "other", label: "Other", color: "#e34948" },
] as const;
export type SenderKind = (typeof SENDER_KINDS)[number]["key"];
export type AutomationDay = { day: string; label: string } & Record<SenderKind, number>;
export type AutomationReport = { days: AutomationDay[]; totals: Record<SenderKind, number> };

export async function automationReport(r: ReportRange): Promise<AutomationReport> {
  const kind = sql<string>`case
    when ${messages.campaignId} is not null then 'campaign'
    when ${messages.sentBy} in ('bot','ai','automation','drip','api') then ${messages.sentBy}
    when ${messages.sentBy} is null then 'other'
    else 'human' end`;
  const rows = await db
    .select({ day: dayExpr(messages.createdAt), kind, n: sql<number>`count(*)` })
    .from(messages)
    .where(and(eq(messages.direction, "out"), gte(messages.createdAt, r.from), lt(messages.createdAt, r.to)))
    .groupBy(sql`1`, sql`2`);
  const zero = () => Object.fromEntries(SENDER_KINDS.map((k) => [k.key, 0])) as Record<SenderKind, number>;
  const byDay = new Map<string, AutomationDay>(r.days.map((d) => [d.day, { ...d, ...zero() }]));
  const totals = zero();
  for (const x of rows) {
    const k = (SENDER_KINDS.some((s) => s.key === x.kind) ? x.kind : "other") as SenderKind;
    const p = byDay.get(x.day);
    if (p) p[k] += Number(x.n);
    totals[k] += Number(x.n);
  }
  return { days: [...byDay.values()], totals };
}

/* -------------------------------------------------------------- CSV */

type Cell = string | number | null | undefined;

function cell(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a UTF-8 BOM so Excel detects the encoding. */
export function toCsv(rows: Cell[][]): string {
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const mins = (v: number | null) => (v === null ? "" : v.toFixed(1));

export function fmtMinutes(m: number | null): string {
  if (m === null) return "—";
  if (m < 1) return `${Math.max(1, Math.round(m * 60))}s`;
  if (m < 60) return `${Math.round(m)}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
  return `${Math.floor(m / 1440)}d ${Math.round((m % 1440) / 60)}h`;
}

export async function reportCsv(tab: string, r: ReportRange, opts: { rate?: number } = {}): Promise<string | null> {
  const head: Cell[][] = [[`Range ${r.fromDay} to ${r.toDay} (IST)`], []];
  if (tab === "overview") {
    const o = await overviewReport(r);
    return toCsv([
      ...head,
      ["Date", "Sent", "Received", "New contacts", "Opt-outs"],
      ...o.days.map((d) => [d.day, d.sent, d.received, d.newContacts, d.optOuts]),
      [],
      ["Total sent", o.totals.sent],
      ["Total received", o.totals.received],
      ["Delivered", o.totals.delivered, pct1(o.rates.delivered)],
      ["Read", o.totals.read, pct1(o.rates.read)],
      ["Failed", o.totals.failed, pct1(o.rates.failed)],
      ["New contacts", o.totals.newContacts],
      ["Opt-outs", o.totals.optOuts],
    ]);
  }
  if (tab === "agents") {
    const a = await agentsReport(r);
    return toCsv([
      ...head,
      ["Agent", "Email", "Role", "Open chats assigned", "Total chats assigned", "Messages sent", "First responses", "Median first response (min)", "Avg first response (min)", "Chats closed", "Open tasks"],
      ...a.rows.map((x) => [x.name, x.email, x.role, x.assignedOpen, x.assignedTotal, x.sent, x.frtCount, mins(x.frtMedianMin), mins(x.frtAvgMin), x.closed, x.openTasks]),
    ]);
  }
  if (tab === "campaigns") {
    const rate = Number.isFinite(opts.rate) && (opts.rate ?? -1) >= 0 ? opts.rate! : DEFAULT_COST_PER_MSG;
    const rows = await campaignsReport(r);
    return toCsv([
      ...head,
      [`Cost per message (INR)`, rate],
      [],
      ["Campaign", "Status", "Started", "Recipients", "Sent", "Delivered", "Read", "Failed", "Replied (24h)", "Reply rate", "Est. cost (INR)", "Won deals", "Won value (INR)"],
      ...rows.map((c) => [
        c.name,
        c.status,
        c.startedAt,
        c.recipients,
        c.sent,
        c.delivered,
        c.read,
        c.failed,
        c.replied,
        c.sent ? pct1(c.replied / c.sent) : "",
        (c.sent * rate).toFixed(2),
        c.wonDeals,
        c.wonValue,
      ]),
    ]);
  }
  if (tab === "automation") {
    const a = await automationReport(r);
    return toCsv([
      ...head,
      ["Date", ...SENDER_KINDS.map((k) => k.label)],
      ...a.days.map((d) => [d.day, ...SENDER_KINDS.map((k) => d[k.key])]),
      ["Total", ...SENDER_KINDS.map((k) => a.totals[k.key])],
    ]);
  }
  return null;
}
