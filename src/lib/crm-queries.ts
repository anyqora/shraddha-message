import "server-only";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { companies, contacts, deals, notes, pipelineStages, tasks, users } from "@/db/schema";
import type { NoteItem, Option, TaskItem } from "./crm-utils";
import { formatPhone } from "./phone";

export async function loadTasks(where: SQL | undefined, limit = 500): Promise<TaskItem[]> {
  const rows = await db
    .select({
      t: tasks,
      uName: users.name,
      uEmail: users.email,
      cName: contacts.name,
      cPhone: contacts.phone,
      coName: companies.name,
      dTitle: deals.title,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .leftJoin(contacts, eq(contacts.id, tasks.contactId))
    .leftJoin(companies, eq(companies.id, tasks.companyId))
    .leftJoin(deals, eq(deals.id, tasks.dealId))
    .where(where)
    .orderBy(sql`${tasks.dueAt} is null`, asc(tasks.dueAt), desc(tasks.createdAt))
    .limit(limit);
  return rows.map(({ t, ...r }) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    dueAt: t.dueAt,
    completedAt: t.completedAt,
    assignee: t.assigneeId ? { id: t.assigneeId, name: r.uName || r.uEmail || "User" } : null,
    contact: t.contactId && (r.cName !== null || r.cPhone !== null) ? { id: t.contactId, name: r.cName || formatPhone(r.cPhone ?? "") } : null,
    company: t.companyId && r.coName !== null ? { id: t.companyId, name: r.coName } : null,
    deal: t.dealId && r.dTitle !== null ? { id: t.dealId, title: r.dTitle } : null,
  }));
}

export async function loadNotes(where: SQL): Promise<NoteItem[]> {
  const rows = await db
    .select({ id: notes.id, body: notes.body, createdAt: notes.createdAt, authorName: users.name })
    .from(notes)
    .leftJoin(users, eq(users.id, notes.authorId))
    .where(where)
    .orderBy(desc(notes.createdAt));
  return rows;
}

export type DealRow = {
  id: string;
  title: string;
  amount: number;
  stageId: string;
  stageName: string | null;
  stageColor: string | null;
  stageKind: "open" | "won" | "lost" | null;
  position: number;
  contactId: string | null;
  contactName: string | null;
  companyId: string | null;
  companyName: string | null;
  ownerName: string | null;
  expectedClose: Date | null;
  createdAt: Date;
};

export async function loadDeals(where: SQL | undefined): Promise<DealRow[]> {
  const rows = await db
    .select({
      id: deals.id,
      title: deals.title,
      amount: deals.amount,
      stageId: deals.stageId,
      stageName: pipelineStages.name,
      stageColor: pipelineStages.color,
      stageKind: pipelineStages.kind,
      position: deals.position,
      contactId: deals.contactId,
      cName: contacts.name,
      cPhone: contacts.phone,
      companyId: deals.companyId,
      companyName: companies.name,
      ownerName: users.name,
      expectedClose: deals.expectedClose,
      createdAt: deals.createdAt,
    })
    .from(deals)
    .leftJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(companies, eq(companies.id, deals.companyId))
    .leftJoin(users, eq(users.id, deals.ownerId))
    .where(where)
    .orderBy(asc(deals.position), desc(deals.createdAt));
  return rows.map(({ cName, cPhone, ...r }) => ({
    ...r,
    contactName: r.contactId && (cName !== null || cPhone !== null) ? cName || formatPhone(cPhone ?? "") : null,
  }));
}

/** Options for selects. Contacts are capped; `includeContactIds` are always present. */
export async function loadCrmOptions(includeContactIds: (string | null | undefined)[] = []) {
  const extra = includeContactIds.filter((x): x is string => Boolean(x));
  const [u, co, ct, ex] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name)),
    db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(asc(companies.name)),
    db
      .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
      .from(contacts)
      .orderBy(sql`${contacts.lastMessageAt} is null`, desc(contacts.lastMessageAt), desc(contacts.createdAt))
      .limit(500),
    extra.length ? db.select({ id: contacts.id, name: contacts.name, phone: contacts.phone }).from(contacts).where(inArray(contacts.id, extra)) : Promise.resolve([]),
  ]);
  const map = new Map<string, Option>();
  for (const c of [...ex, ...ct]) map.set(c.id, { id: c.id, name: c.name ? `${c.name} · ${formatPhone(c.phone)}` : formatPhone(c.phone) });
  return {
    users: u.map((x) => ({ id: x.id, name: x.name || x.email })) as Option[],
    companies: co as Option[],
    contacts: [...map.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Contacts not linked to the given company (for "link existing"). */
export async function loadLinkableContacts(companyId: string) {
  const rows = await db
    .select({ id: contacts.id, name: contacts.name, phone: contacts.phone, companyId: contacts.companyId })
    .from(contacts)
    .where(and(sql`(${contacts.companyId} is null or ${contacts.companyId} <> ${companyId})`))
    .orderBy(sql`${contacts.companyId} is not null`, asc(contacts.name))
    .limit(500);
  return rows.map((c) => ({ id: c.id, name: (c.name ? `${c.name} · ${formatPhone(c.phone)}` : formatPhone(c.phone)) + (c.companyId ? " (other company)" : "") }));
}

