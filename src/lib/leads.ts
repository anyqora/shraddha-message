import "server-only";
import { desc, eq, type SQL } from "drizzle-orm";
import { db } from "./db";
import { contacts, leads, users } from "@/db/schema";

export const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Insert a lead and return its id. */
export async function createLead(input: {
  contactId: string | null;
  title: string;
  source?: string;
  data: Record<string, string>;
  assignedTo?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.data)) if (k && v != null) data[k.slice(0, 64)] = String(v).slice(0, 1000);
  await db.insert(leads).values({
    id,
    contactId: input.contactId,
    title: (input.title || "Lead").slice(0, 191),
    source: (input.source || "chatbot").slice(0, 64),
    data,
    assignedTo: input.assignedTo ?? null,
  });
  return id;
}

export async function loadLeads(where: SQL | undefined, limit = 500) {
  return db
    .select({
      lead: leads,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      contactEmail: contacts.email,
      assigneeName: users.name,
    })
    .from(leads)
    .leftJoin(contacts, eq(contacts.id, leads.contactId))
    .leftJoin(users, eq(users.id, leads.assignedTo))
    .where(where)
    .orderBy(desc(leads.createdAt))
    .limit(limit);
}
export type LeadRow = Awaited<ReturnType<typeof loadLeads>>[number];

/** Keys that are already shown as contact columns. */
export const CONTACT_KEYS = new Set(["name", "phone", "email"]);

function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) s = "'" + s; // spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function leadsCsv(rows: LeadRow[]): string {
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r.lead.data ?? {})) if (!CONTACT_KEYS.has(k) && !keys.includes(k)) keys.push(k);
  const head = ["Created (IST)", "Title", "Status", "Source", "Name", "Phone", "Email", "Assigned to", ...keys];
  const lines = [head.map(csvCell).join(",")];
  for (const r of rows) {
    const d = r.lead.data ?? {};
    lines.push(
      [
        r.lead.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        r.lead.title,
        r.lead.status,
        r.lead.source,
        r.contactName || d.name || "",
        r.contactPhone || d.phone || "",
        r.contactEmail || d.email || "",
        r.assigneeName ?? "",
        ...keys.map((k) => d[k] ?? ""),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return "﻿" + lines.join("\r\n");
}
