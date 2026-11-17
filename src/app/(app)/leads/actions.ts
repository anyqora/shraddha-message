"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, deals, leads, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ensureDefaultPipeline, getStages } from "@/lib/crm-pipeline";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/leads";

function revalidate(id?: string) {
  revalidatePath("/leads");
  if (id) revalidatePath(`/leads/${id}`);
}

export async function setLeadStatus(id: string, status: string): Promise<{ ok: boolean; message?: string }> {
  await requireUser();
  if (!LEAD_STATUSES.includes(status as LeadStatus)) return { ok: false, message: "Unknown status." };
  await db.update(leads).set({ status: status as LeadStatus }).where(eq(leads.id, id));
  revalidate(id);
  return { ok: true };
}

export async function setLeadAssignee(id: string, userId: string | null): Promise<{ ok: boolean; message?: string }> {
  await requireUser();
  if (userId) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return { ok: false, message: "User not found." };
  }
  await db.update(leads).set({ assignedTo: userId || null }).where(eq(leads.id, id));
  revalidate(id);
  return { ok: true };
}

export async function updateLeadTitle(id: string, title: string): Promise<{ ok: boolean; message?: string }> {
  await requireUser();
  const t = title.trim().slice(0, 191);
  if (!t) return { ok: false, message: "Title is required." };
  await db.update(leads).set({ title: t }).where(eq(leads.id, id));
  revalidate(id);
  return { ok: true };
}

export async function deleteLead(id: string): Promise<void> {
  await requireUser();
  const [l] = await db.select({ title: leads.title }).from(leads).where(eq(leads.id, id)).limit(1);
  await db.delete(leads).where(eq(leads.id, id));
  if (l) await audit("lead.delete", { entity: "lead", entityId: id, summary: l.title });
  revalidate();
  redirect("/leads");
}

/** Creates a deal in the first open stage of the first pipeline and marks the lead converted. */
export async function convertLeadToDeal(id: string): Promise<{ ok: false; message: string } | void> {
  const me = await requireUser();
  const [l] = await db
    .select({ lead: leads, contactName: contacts.name, companyId: contacts.companyId })
    .from(leads)
    .leftJoin(contacts, eq(contacts.id, leads.contactId))
    .where(eq(leads.id, id))
    .limit(1);
  if (!l) return { ok: false, message: "Lead not found." };
  const [pipeline] = await ensureDefaultPipeline();
  if (!pipeline) return { ok: false, message: "No pipeline found." };
  const stages = await getStages(pipeline.id);
  const stage = stages.find((s) => s.kind === "open") ?? stages[0];
  if (!stage) return { ok: false, message: "The pipeline has no stages." };

  const who = l.contactName || l.lead.data?.name || "";
  const title = (l.lead.title && who ? `${l.lead.title} – ${who}` : l.lead.title || who || "New deal").slice(0, 191);
  const [{ m }] = await db.select({ m: sql<number>`coalesce(max(${deals.position}), -1)` }).from(deals).where(eq(deals.stageId, stage.id));
  const dealId = crypto.randomUUID();
  await db.insert(deals).values({
    id: dealId,
    title,
    pipelineId: pipeline.id,
    stageId: stage.id,
    contactId: l.lead.contactId,
    companyId: l.companyId ?? null,
    ownerId: l.lead.assignedTo ?? me.id,
    position: Number(m) + 1,
  });
  await db.update(leads).set({ status: "converted" }).where(eq(leads.id, id));
  await audit("lead.convert", { entity: "lead", entityId: id, summary: `→ deal ${title}` });
  revalidate(id);
  revalidatePath("/deals");
  redirect(`/deals/${dealId}`);
}
