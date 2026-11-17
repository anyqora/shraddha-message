"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, dateWishes, dripEnrollments, dripSequences, listMembers, templates, type DripStep } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { enrollContacts, stopEnrollments } from "@/lib/drips";
import { templateShape } from "@/lib/template-utils";
import { validateSteps } from "./shared";
import { assertPermission } from "@/lib/permissions";

type Result = { ok: boolean; message: string; id?: string };

async function templateVarsLookup() {
  const rows = await db.select().from(templates).where(eq(templates.status, "APPROVED"));
  const m = new Map(rows.filter((t) => !templateShape(t.components).headerMedia).map((t) => [t.id, templateShape(t.components).bodyVars]));
  return (id: string) => m.get(id);
}

function cleanSteps(raw: unknown): DripStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 30).map((s: any): DripStep => {
    const delayHours = Math.max(0, Math.round(Number(s?.delayHours) || 0));
    if (s?.kind === "text") return { delayHours, kind: "text", text: String(s.text ?? "").slice(0, 4096) };
    return {
      delayHours,
      kind: "template",
      templateId: String(s?.templateId ?? ""),
      body: Array.isArray(s?.body) ? s.body.map((b: unknown) => String(b ?? "").slice(0, 1000)) : [],
    };
  });
}

/** Create (id = null) or update a sequence from the builder's JSON payload. */
export async function saveSequence(id: string | null, payload: string): Promise<Result> {
  await assertPermission("drips.manage");
  let p: any;
  try {
    p = JSON.parse(payload);
  } catch {
    return { ok: false, message: "Invalid data." };
  }
  const name = String(p?.name ?? "").trim().slice(0, 191);
  const steps = cleanSteps(p?.steps);
  const errs: string[] = [];
  if (!name) errs.push("Give the sequence a name.");
  errs.push(...validateSteps(steps, await templateVarsLookup()));
  if (errs.length) return { ok: false, message: errs.join(" ") };
  const data = {
    name,
    steps,
    listId: String(p?.listId ?? "") || null,
    stopOnReply: p?.stopOnReply !== false,
    active: p?.active !== false,
  };
  let sid = id;
  if (id) await db.update(dripSequences).set(data).where(eq(dripSequences.id, id));
  else {
    sid = crypto.randomUUID();
    await db.insert(dripSequences).values({ id: sid, ...data });
  }
  revalidatePath("/drips");
  if (sid) revalidatePath(`/drips/${sid}`);
  return { ok: true, message: "Sequence saved.", id: sid ?? undefined };
}

export async function toggleSequence(id: string, active: boolean) {
  await assertPermission("drips.manage");
  await db.update(dripSequences).set({ active }).where(eq(dripSequences.id, id));
  revalidatePath("/drips");
  revalidatePath(`/drips/${id}`);
}

export async function deleteSequence(id: string) {
  await assertPermission("drips.manage");
  await db.delete(dripEnrollments).where(eq(dripEnrollments.sequenceId, id));
  await db.delete(dripSequences).where(eq(dripSequences.id, id));
  revalidatePath("/drips");
}

export async function enrollList(sequenceId: string, listId: string): Promise<Result> {
  await assertPermission("drips.manage");
  if (!listId) return { ok: false, message: "Choose a list." };
  const members = await db.select({ id: listMembers.contactId }).from(listMembers).where(eq(listMembers.listId, listId));
  const n = await enrollContacts(sequenceId, members.map((m) => m.id));
  revalidatePath(`/drips/${sequenceId}`);
  revalidatePath("/drips");
  return { ok: true, message: n ? `Enrolled ${n} contact${n === 1 ? "" : "s"}.` : "No new contacts to enroll (already enrolled or opted out)." };
}

export async function enrollSelected(sequenceId: string, contactIds: string[]): Promise<Result> {
  await assertPermission("drips.manage");
  const n = await enrollContacts(sequenceId, contactIds.slice(0, 1000));
  revalidatePath(`/drips/${sequenceId}`);
  revalidatePath("/drips");
  return { ok: true, message: n ? `Enrolled ${n} contact${n === 1 ? "" : "s"}.` : "No new contacts to enroll (already enrolled or opted out)." };
}

export async function searchContactsForDrip(q: string) {
  await requireUser();
  const term = q.trim();
  if (!term) return [];
  const digits = term.replace(/\D/g, "");
  const conds = [like(contacts.name, `%${term}%`)];
  if (digits.length >= 3) conds.push(like(contacts.phone, `%${digits}%`));
  return db
    .select({ id: contacts.id, name: contacts.name, phone: contacts.phone, optedOut: contacts.optedOut })
    .from(contacts)
    .where(or(...conds))
    .limit(15);
}

export async function stopEnrollment(sequenceId: string, ids: string[]) {
  await assertPermission("drips.manage");
  await stopEnrollments(ids);
  revalidatePath(`/drips/${sequenceId}`);
  revalidatePath("/drips");
}

export async function removeEnrollment(sequenceId: string, ids: string[]) {
  await assertPermission("drips.manage");
  if (!ids.length) return;
  await db.delete(dripEnrollments).where(and(eq(dripEnrollments.sequenceId, sequenceId), inArray(dripEnrollments.id, ids)));
  revalidatePath(`/drips/${sequenceId}`);
  revalidatePath("/drips");
}

export async function saveWish(kind: "birthday" | "anniversary", payload: string): Promise<Result> {
  await assertPermission("drips.manage");
  if (kind !== "birthday" && kind !== "anniversary") return { ok: false, message: "Unknown wish." };
  let p: any;
  try {
    p = JSON.parse(payload);
  } catch {
    return { ok: false, message: "Invalid data." };
  }
  const templateId = String(p?.templateId ?? "") || null;
  const body = Array.isArray(p?.body) ? p.body.map((b: unknown) => String(b ?? "").slice(0, 1000)) : [];
  const sendHour = Math.min(23, Math.max(0, Math.round(Number(p?.sendHour) || 0)));
  const active = !!p?.active;
  if (active) {
    if (!templateId) return { ok: false, message: "Choose a template before turning wishes on." };
    const vars = (await templateVarsLookup())(templateId);
    if (vars === undefined) return { ok: false, message: "That template is not approved (or has a media header)." };
    if (body.length < vars || body.slice(0, vars).some((b: string) => !b.trim())) return { ok: false, message: "Fill every template parameter." };
  }
  const [existing] = await db.select({ id: dateWishes.id }).from(dateWishes).where(eq(dateWishes.kind, kind)).limit(1);
  if (existing) await db.update(dateWishes).set({ templateId, body, sendHour, active }).where(eq(dateWishes.id, existing.id));
  else await db.insert(dateWishes).values({ id: crypto.randomUUID(), kind, templateId, body, sendHour, active });
  revalidatePath("/drips");
  return { ok: true, message: "Saved." };
}
