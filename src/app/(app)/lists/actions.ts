"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { listMembers, lists } from "@/db/schema";
import { requireUser } from "@/lib/auth";

export async function createList(name: string, description = "", color = "blue"): Promise<string> {
  await requireUser();
  const id = crypto.randomUUID();
  await db.insert(lists).values({ id, name: name.slice(0, 191), description: description.slice(0, 500), color });
  revalidatePath("/lists");
  return id;
}

export async function createListForm(fd: FormData) {
  const name = String(fd.get("name") ?? "").trim();
  if (!name) redirect("/lists");
  const id = await createList(name, String(fd.get("description") ?? ""), String(fd.get("color") ?? "blue"));
  redirect(`/lists/${id}`);
}

export async function updateList(fd: FormData) {
  await requireUser();
  const id = String(fd.get("id"));
  await db
    .update(lists)
    .set({ name: String(fd.get("name") ?? "").trim().slice(0, 191) || "Untitled", description: String(fd.get("description") ?? "").slice(0, 500), color: String(fd.get("color") ?? "blue") })
    .where(eq(lists.id, id));
  revalidatePath(`/lists/${id}`);
  redirect(`/lists/${id}`);
}

export async function deleteList(id: string) {
  await requireUser();
  await db.delete(listMembers).where(eq(listMembers.listId, id));
  await db.delete(lists).where(eq(lists.id, id));
  revalidatePath("/lists");
  redirect("/lists");
}
