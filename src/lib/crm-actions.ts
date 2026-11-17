"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { notes, tasks } from "@/db/schema";
import { requireUser } from "./auth";
import { parseIstDate, type CrmTarget } from "./crm-utils";

const clean = (v: string | null | undefined) => (v && String(v).trim()) || null;

function revalidateTarget(t: { contactId?: string | null; companyId?: string | null; dealId?: string | null }) {
  revalidatePath("/tasks");
  if (t.contactId) revalidatePath(`/contacts/${t.contactId}`);
  if (t.companyId) revalidatePath(`/companies/${t.companyId}`);
  if (t.dealId) revalidatePath(`/deals/${t.dealId}`);
}

export async function addNote(target: CrmTarget, body: string) {
  const u = await requireUser();
  const text = String(body ?? "").trim();
  if (!text) return;
  const row = {
    id: crypto.randomUUID(),
    body: text,
    contactId: clean(target.contactId),
    companyId: clean(target.companyId),
    dealId: clean(target.dealId),
    authorId: u.id,
  };
  await db.insert(notes).values(row);
  revalidateTarget(row);
}

export async function deleteNote(id: string) {
  await requireUser();
  const [n] = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
  if (!n) return;
  await db.delete(notes).where(eq(notes.id, id));
  revalidateTarget(n);
}

export async function addTask(input: CrmTarget & { title: string; dueAt?: string; assigneeId?: string; body?: string }) {
  const u = await requireUser();
  const title = String(input.title ?? "").trim().slice(0, 255);
  if (!title) return;
  const row = {
    id: crypto.randomUUID(),
    title,
    body: String(input.body ?? ""),
    dueAt: parseIstDate(input.dueAt),
    assigneeId: clean(input.assigneeId),
    contactId: clean(input.contactId),
    companyId: clean(input.companyId),
    dealId: clean(input.dealId),
    createdBy: u.id,
  };
  await db.insert(tasks).values(row);
  revalidateTarget(row);
}

export async function toggleTask(id: string, done: boolean) {
  await requireUser();
  await db
    .update(tasks)
    .set({ status: done ? "done" : "todo", completedAt: done ? new Date() : null })
    .where(eq(tasks.id, id));
  const [t] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (t) revalidateTarget(t);
}

export async function deleteTask(id: string) {
  await requireUser();
  const [t] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!t) return;
  await db.delete(tasks).where(eq(tasks.id, id));
  revalidateTarget(t);
}
