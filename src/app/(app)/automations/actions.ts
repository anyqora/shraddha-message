"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { automationRuns, automations, lists, templates, users, type AutomationStep, type AutomationTrigger } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { templateShape } from "@/lib/template-utils";
import { normalizeAutomation, validateAutomation } from "./validate";

type Result = { ok: boolean; message: string };

export async function saveAutomation(id: string | null, payload: string): Promise<Result> {
  await requireUser();
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { ok: false, message: "Invalid data." };
  }
  const a = normalizeAutomation(raw);

  // referenced records must exist
  const listIds = new Set<string>();
  const tplIds = new Set<string>();
  const userIds = new Set<string>();
  if (a.trigger.type === "contact.list_added" && a.trigger.listId) listIds.add(a.trigger.listId);
  for (const s of a.steps) {
    if ((s.type === "add_to_list" || s.type === "remove_from_list") && s.listId) listIds.add(s.listId);
    if (s.type === "send_template" && s.templateId) tplIds.add(s.templateId);
    if (s.type === "assign" && s.userId) userIds.add(s.userId);
  }
  const [lr, tr, ur] = await Promise.all([
    listIds.size ? db.select({ id: lists.id }).from(lists).where(inArray(lists.id, [...listIds])) : [],
    tplIds.size ? db.select().from(templates).where(inArray(templates.id, [...tplIds])) : [],
    userIds.size ? db.select({ id: users.id }).from(users).where(inArray(users.id, [...userIds])) : [],
  ]);
  const tplMap = new Map(tr.map((t) => [t.id, t]));
  const errors = validateAutomation(a, { templateVars: (tid) => (tplMap.has(tid) ? templateShape(tplMap.get(tid)!.components).bodyVars : undefined) });
  if (lr.length < listIds.size) errors.push("A selected list no longer exists.");
  if (tr.length < tplIds.size) errors.push("A selected template no longer exists.");
  if (ur.length < userIds.size) errors.push("A selected user no longer exists.");
  for (const t of tr) {
    if (templateShape(t.components).headerMedia) errors.push(`Template “${t.name}” has a media header, which automations can’t send.`);
  }
  if (errors.length) return { ok: false, message: errors.join(" ") };

  const values = { name: a.name, active: a.active, trigger: a.trigger, steps: a.steps };
  let savedId = id;
  try {
    if (id) await db.update(automations).set(values).where(eq(automations.id, id));
    else {
      savedId = crypto.randomUUID();
      await db.insert(automations).values({ id: savedId, ...values });
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save the automation." };
  }
  revalidatePath("/automations");
  if (savedId) revalidatePath(`/automations/${savedId}`);
  redirect("/automations");
}

export async function toggleAutomation(id: string, active: boolean) {
  await requireUser();
  await db.update(automations).set({ active }).where(eq(automations.id, id));
  revalidatePath("/automations");
}

export async function deleteAutomation(id: string) {
  await requireUser();
  await db.delete(automationRuns).where(eq(automationRuns.automationId, id));
  await db.delete(automations).where(eq(automations.id, id));
  revalidatePath("/automations");
}

export type RecipeKey = "welcome" | "interested" | "followup";

async function listByName(name: string, color: string): Promise<string> {
  const [found] = await db.select({ id: lists.id }).from(lists).where(eq(lists.name, name)).limit(1);
  if (found) return found.id;
  const id = crypto.randomUUID();
  await db.insert(lists).values({ id, name, color, description: "Created by an automation recipe" });
  return id;
}

export async function createRecipe(key: RecipeKey): Promise<void> {
  await requireUser();
  let name: string;
  let trigger: AutomationTrigger;
  let steps: AutomationStep[];
  if (key === "welcome") {
    name = "Welcome new contacts";
    trigger = { type: "contact.created" };
    steps = [{ type: "send_text", text: "Hi {{name}} 👋 Thanks for reaching out! Our team will get back to you shortly." }];
  } else if (key === "interested") {
    const listId = await listByName("Interested", "green");
    name = "Tag interested leads";
    trigger = { type: "message.received", keywords: "price,interested", matchType: "contains" };
    steps = [
      { type: "add_to_list", listId },
      { type: "create_task", title: "Call {{name}}", dueInHours: 24 },
    ];
  } else {
    const listId = await listByName("Interested", "green");
    name = "Follow-up after 1 day";
    trigger = { type: "contact.list_added", listId };
    steps = [
      { type: "wait", minutes: 1440 },
      { type: "send_text", text: "Hi {{name}}, just following up — do you have any questions we can help with?" },
    ];
  }
  const id = crypto.randomUUID();
  // recipes start paused so the user can review before anything is sent
  await db.insert(automations).values({ id, name, trigger, steps, active: false });
  revalidatePath("/automations");
  redirect(`/automations/${id}`);
}
