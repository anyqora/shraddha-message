"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { companies, contacts, deals, notes, tasks } from "@/db/schema";
import { requireUser } from "@/lib/auth";

const str = (fd: FormData, k: string, max = 191) => String(fd.get(k) ?? "").trim().slice(0, max);

export async function saveCompany(fd: FormData) {
  await requireUser();
  const id = str(fd, "id");
  const data = {
    name: str(fd, "name"),
    domain: str(fd, "domain").replace(/^https?:\/\//i, "").replace(/\/.*$/, ""),
    industry: str(fd, "industry"),
    city: str(fd, "city"),
    phone: str(fd, "phone", 32),
  };
  if (!data.name) redirect(id ? `/companies/${id}?edit=1&error=name` : "/companies/new?error=name");
  let cid = id;
  if (id) await db.update(companies).set(data).where(eq(companies.id, id));
  else {
    cid = crypto.randomUUID();
    await db.insert(companies).values({ id: cid, ...data });
  }
  revalidatePath("/companies");
  revalidatePath(`/companies/${cid}`);
  redirect(`/companies/${cid}`);
}

export async function deleteCompany(id: string) {
  await requireUser();
  await db.update(contacts).set({ companyId: null }).where(eq(contacts.companyId, id));
  await db.update(deals).set({ companyId: null }).where(eq(deals.companyId, id));
  await db.delete(notes).where(eq(notes.companyId, id));
  await db.delete(tasks).where(eq(tasks.companyId, id));
  await db.delete(companies).where(eq(companies.id, id));
  revalidatePath("/companies");
  revalidatePath("/deals");
  revalidatePath("/tasks");
  redirect("/companies");
}

export async function linkContact(companyId: string, fd: FormData) {
  await requireUser();
  const contactId = String(fd.get("contactId") ?? "");
  if (!contactId) return;
  await db.update(contacts).set({ companyId }).where(eq(contacts.id, contactId));
  revalidatePath(`/companies/${companyId}`);
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/companies");
}

export async function unlinkContact(companyId: string, contactId: string) {
  await requireUser();
  await db.update(contacts).set({ companyId: null }).where(and(eq(contacts.id, contactId), eq(contacts.companyId, companyId)));
  revalidatePath(`/companies/${companyId}`);
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/companies");
}
