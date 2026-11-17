import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { botRules, campaigns, contacts, deals, messages, pipelineStages, tasks, templates, users } from "@/db/schema";
import type { AppSettings } from "./settings";

const IST_MS = 330 * 60e3;
const DAY = 864e5;

export function istDayStart(now = Date.now()) {
  return new Date(Math.floor((now + IST_MS) / DAY) * DAY - IST_MS);
}

export type SetupStep = { key: string; label: string; hint: string; href: string; done: boolean };

export async function loadDashboardExtras(s: AppSettings, userId: string) {
  const now = Date.now();
  const today = istDayStart(now);
  const d7 = new Date(now - 7 * DAY);
  const d30 = new Date(now - 30 * DAY);
  const monthStart = new Date(Date.UTC(new Date(now + IST_MS).getUTCFullYear(), new Date(now + IST_MS).getUTCMonth(), 1) - IST_MS);

  const [
    [counts],
    todayMsgs,
    [todayNew],
    dueTasks,
    pipeline,
    share,
    heat,
  ] = await Promise.all([
    db
      .select({
        templates: sql<number>`(select count(*) from ${templates})`,
        approved: sql<number>`(select count(*) from ${templates} where ${templates.status} = 'APPROVED')`,
        contacts: sql<number>`(select count(*) from ${contacts})`,
        campaigns: sql<number>`(select count(*) from ${campaigns})`,
        users: sql<number>`(select count(*) from ${users})`,
        inbound: sql<number>`(select count(*) from ${messages} where ${messages.direction} = 'in')`,
        rules: sql<number>`(select count(*) from ${botRules} where ${botRules.active} = 1)`,
      })
      .from(sql`(select 1) as one`),
    db
      .select({ direction: messages.direction, n: sql<number>`count(*)` })
      .from(messages)
      .where(gte(messages.createdAt, today))
      .groupBy(messages.direction),
    db.select({ n: sql<number>`count(*)` }).from(contacts).where(gte(contacts.createdAt, today)),
    db
      .select({ t: tasks, contactName: contacts.name, contactPhone: contacts.phone })
      .from(tasks)
      .leftJoin(contacts, eq(contacts.id, tasks.contactId))
      .where(and(ne(tasks.status, "done"), isNotNull(tasks.dueAt), lt(tasks.dueAt, new Date(today.getTime() + DAY))))
      .orderBy(asc(tasks.dueAt))
      .limit(6),
    db
      .select({ kind: pipelineStages.kind, n: sql<number>`count(*)`, amount: sql<number>`coalesce(sum(${deals.amount}),0)`, recent: sql<number>`coalesce(sum(if(${deals.updatedAt} >= ${monthStart}, ${deals.amount}, 0)),0)` })
      .from(deals)
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .groupBy(pipelineStages.kind),
    db
      .select({
        kind: sql<string>`case when ${messages.campaignId} is not null then 'campaign' when ${messages.sentBy} in ('bot','ai','automation','drip','api','wish') then ${messages.sentBy} when ${messages.sentBy} is null then 'other' else 'team' end`,
        n: sql<number>`count(*)`,
      })
      .from(messages)
      .where(and(eq(messages.direction, "out"), gte(messages.createdAt, d7)))
      .groupBy(sql`1`),
    db
      .select({
        dow: sql<number>`weekday(${messages.createdAt} + interval 330 minute)`,
        hour: sql<number>`hour(${messages.createdAt} + interval 330 minute)`,
        n: sql<number>`count(*)`,
      })
      .from(messages)
      .where(and(eq(messages.direction, "in"), gte(messages.createdAt, d30)))
      .groupBy(sql`1`, sql`2`),
  ]);

  const n = (v: unknown) => Number(v ?? 0);
  const connected = Boolean(s.waAccessToken && s.waPhoneNumberId);
  const setup: SetupStep[] = [
    { key: "wa", label: "Connect WhatsApp", hint: "Add your Cloud API number and token", href: "/settings", done: connected },
    { key: "hook", label: "Receive your first message", hint: "Set the Meta webhook, then message your number", href: "/settings", done: n(counts.inbound) > 0 },
    { key: "tpl", label: "Sync or create templates", hint: "Approved templates are needed for campaigns", href: "/templates", done: n(counts.approved) > 0 },
    { key: "contacts", label: "Import your contacts", hint: "CSV or Excel with column mapping", href: "/contacts/import", done: n(counts.contacts) > 1 },
    { key: "bot", label: "Turn on the chatbot or AI", hint: "Answer customers 24×7 automatically", href: "/chatbot", done: (s.botEnabled && n(counts.rules) > 0) || s.aiEnabled },
    { key: "campaign", label: "Send your first campaign", hint: "Reach a list with an approved template", href: "/campaigns/new", done: n(counts.campaigns) > 0 },
    { key: "team", label: "Invite your team", hint: "Share the inbox with agents", href: "/settings/team", done: n(counts.users) > 1 },
  ];

  const todayIn = n(todayMsgs.find((r) => r.direction === "in")?.n);
  const todayOut = n(todayMsgs.find((r) => r.direction === "out")?.n);

  const pipe = { openValue: 0, openCount: 0, wonMonth: 0, wonCount: 0 };
  for (const p of pipeline) {
    if (p.kind === "open") {
      pipe.openValue += n(p.amount);
      pipe.openCount += n(p.n);
    }
    if (p.kind === "won") {
      pipe.wonMonth += n(p.recent);
      pipe.wonCount += n(p.n);
    }
  }

  const SHARE_LABEL: Record<string, string> = {
    team: "Team",
    bot: "Chatbot",
    ai: "AI",
    automation: "Automations",
    drip: "Drips",
    wish: "Wishes",
    campaign: "Campaigns",
    api: "API",
    other: "Other",
  };
  const shareRows = share
    .map((r) => ({ key: r.kind, label: SHARE_LABEL[r.kind] ?? r.kind, n: n(r.n) }))
    .sort((a, b) => b.n - a.n);

  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const h of heat) grid[n(h.dow)][n(h.hour)] = n(h.n);

  return {
    setup,
    today: { inbound: todayIn, outbound: todayOut, newContacts: n(todayNew?.n) },
    dueTasks: dueTasks.map((r) => ({ ...r.t, contactName: r.contactName ?? "", contactPhone: r.contactPhone ?? "", overdue: (r.t.dueAt?.getTime() ?? 0) < today.getTime() })),
    pipeline: pipe,
    share: shareRows,
    heat: grid,
    userId,
  };
}
