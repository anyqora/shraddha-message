"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { deals, notes, pipelines, pipelineStages, tasks } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { parseIstDate } from "@/lib/crm-utils";
import { CHIP_COLORS } from "@/components/ui";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const opt = (fd: FormData, k: string) => str(fd, k) || null;

function revalidateDeal(d: { id: string; contactId?: string | null; companyId?: string | null }) {
  revalidatePath("/deals");
  revalidatePath(`/deals/${d.id}`);
  if (d.contactId) revalidatePath(`/contacts/${d.contactId}`);
  if (d.companyId) revalidatePath(`/companies/${d.companyId}`);
}

export async function saveDeal(fd: FormData) {
  await requireUser();
  const id = str(fd, "id");
  const title = str(fd, "title").slice(0, 191);
  const stageId = str(fd, "stageId");
  const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, stageId)).limit(1);
  if (!title || !stage) redirect(id ? `/deals/${id}?error=1` : `/deals/new?error=1`);
  const data = {
    title,
    amount: Math.max(0, Math.round(Number(str(fd, "amount")) || 0)),
    stageId: stage.id,
    pipelineId: stage.pipelineId,
    contactId: opt(fd, "contactId"),
    companyId: opt(fd, "companyId"),
    ownerId: opt(fd, "ownerId"),
    expectedClose: parseIstDate(str(fd, "expectedClose")),
  };
  let did = id;
  if (id) {
    const [prev] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
    if (prev && prev.stageId !== data.stageId) {
      const [{ m }] = await db.select({ m: sql<number>`coalesce(max(${deals.position}), -1)` }).from(deals).where(eq(deals.stageId, data.stageId));
      await db.update(deals).set({ ...data, position: Number(m) + 1 }).where(eq(deals.id, id));
    } else await db.update(deals).set(data).where(eq(deals.id, id));
    if (prev) revalidateDeal(prev);
  } else {
    did = crypto.randomUUID();
    const [{ m }] = await db.select({ m: sql<number>`coalesce(max(${deals.position}), -1)` }).from(deals).where(eq(deals.stageId, data.stageId));
    await db.insert(deals).values({ id: did, ...data, position: Number(m) + 1 });
  }
  revalidateDeal({ id: did, ...data });
  const ret = str(fd, "return");
  redirect(ret.startsWith("/") ? ret : `/deals/${did}`);
}

/** Move a deal to `stageId` at index `position`, re-numbering that column. */
export async function moveDeal(dealId: string, stageId: string, position: number) {
  await requireUser();
  const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, stageId)).limit(1);
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId)).limit(1);
  if (!stage || !deal) return;
  const col = (await db.select({ id: deals.id }).from(deals).where(eq(deals.stageId, stageId)).orderBy(asc(deals.position), asc(deals.createdAt)))
    .map((d) => d.id)
    .filter((id) => id !== dealId);
  const idx = Math.max(0, Math.min(col.length, Math.floor(position)));
  col.splice(idx, 0, dealId);
  await db.update(deals).set({ stageId, pipelineId: stage.pipelineId }).where(eq(deals.id, dealId));
  for (let i = 0; i < col.length; i++) await db.update(deals).set({ position: i }).where(eq(deals.id, col[i]));
  revalidateDeal(deal);
}

export async function deleteDeal(id: string) {
  await requireUser();
  const [d] = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  if (!d) redirect("/deals");
  await db.delete(notes).where(eq(notes.dealId, id));
  await db.delete(tasks).where(eq(tasks.dealId, id));
  await db.delete(deals).where(eq(deals.id, id));
  revalidateDeal(d);
  revalidatePath("/tasks");
  redirect("/deals");
}

/* ------------------------------------------------------- stage settings */

const color = (v: string) => (CHIP_COLORS.includes(v) ? v : "gray");
const kind = (v: string): "open" | "won" | "lost" => (v === "won" || v === "lost" ? v : "open");

export async function addPipeline(fd: FormData) {
  await requireUser();
  const name = str(fd, "name").slice(0, 191);
  if (!name) return;
  const [{ m }] = await db.select({ m: sql<number>`coalesce(max(${pipelines.position}), -1)` }).from(pipelines);
  const id = crypto.randomUUID();
  await db.insert(pipelines).values({ id, name, position: Number(m) + 1 });
  await db.insert(pipelineStages).values([
    { id: crypto.randomUUID(), pipelineId: id, name: "New", color: "gray", kind: "open", position: 0 },
    { id: crypto.randomUUID(), pipelineId: id, name: "Won", color: "green", kind: "won", position: 1 },
    { id: crypto.randomUUID(), pipelineId: id, name: "Lost", color: "red", kind: "lost", position: 2 },
  ]);
  revalidatePath("/deals", "layout");
}

export async function renamePipeline(id: string, fd: FormData) {
  await requireUser();
  const name = str(fd, "name").slice(0, 191);
  if (name) await db.update(pipelines).set({ name }).where(eq(pipelines.id, id));
  revalidatePath("/deals", "layout");
}

export async function addStage(pipelineId: string, fd: FormData) {
  await requireUser();
  const name = str(fd, "name").slice(0, 191);
  if (!name) return;
  const [{ m }] = await db.select({ m: sql<number>`coalesce(max(${pipelineStages.position}), -1)` }).from(pipelineStages).where(eq(pipelineStages.pipelineId, pipelineId));
  await db.insert(pipelineStages).values({ id: crypto.randomUUID(), pipelineId, name, color: color(str(fd, "color")), kind: kind(str(fd, "kind")), position: Number(m) + 1 });
  revalidatePath("/deals", "layout");
}

export async function updateStage(id: string, fd: FormData) {
  await requireUser();
  const name = str(fd, "name").slice(0, 191);
  await db
    .update(pipelineStages)
    .set({ ...(name ? { name } : {}), color: color(str(fd, "color")), kind: kind(str(fd, "kind")) })
    .where(eq(pipelineStages.id, id));
  revalidatePath("/deals", "layout");
}

export async function moveStage(id: string, dir: -1 | 1) {
  await requireUser();
  const [s] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, id)).limit(1);
  if (!s) return;
  const all = await db.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, s.pipelineId)).orderBy(asc(pipelineStages.position));
  const i = all.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  for (let k = 0; k < all.length; k++) await db.update(pipelineStages).set({ position: k }).where(eq(pipelineStages.id, all[k].id));
  revalidatePath("/deals", "layout");
}

export async function deleteStage(id: string) {
  await requireUser();
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(deals).where(eq(deals.stageId, id));
  if (Number(n) > 0) redirect("/deals/settings?error=stage_in_use");
  const [s] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, id)).limit(1);
  if (s) {
    const [{ c }] = await db.select({ c: sql<number>`count(*)` }).from(pipelineStages).where(eq(pipelineStages.pipelineId, s.pipelineId));
    if (Number(c) <= 1) redirect("/deals/settings?error=last_stage");
  }
  await db.delete(pipelineStages).where(and(eq(pipelineStages.id, id)));
  revalidatePath("/deals", "layout");
}
