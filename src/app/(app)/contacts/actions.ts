"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, listMembers, messages, campaignRecipients } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { getSettings } from "@/lib/settings";

export type ImportRow = { phone: string; name?: string; email?: string; custom?: Record<string, string> };

export async function saveContact(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const { defaultCountryCode } = await getSettings();
  const phone = normalizePhone(String(formData.get("phone") ?? ""), defaultCountryCode);
  if (!phone) redirect(`${id ? `/contacts/${id}` : "/contacts/new"}?error=phone`);
  const custom: Record<string, string> = {};
  const keys = formData.getAll("custom_key").map(String);
  const vals = formData.getAll("custom_value").map(String);
  keys.forEach((k, i) => {
    const key = k.trim();
    if (key) custom[key] = (vals[i] ?? "").trim();
  });
  const data = {
    phone,
    name: String(formData.get("name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    custom,
    ...(formData.has("company_present") ? { companyId: String(formData.get("companyId") ?? "").trim() || null } : {}),
  };
  let cid = id;
  try {
    if (id) await db.update(contacts).set(data).where(eq(contacts.id, id));
    else {
      cid = crypto.randomUUID();
      await db.insert(contacts).values({ id: cid, ...data });
    }
  } catch (e: any) {
    if (e?.code === "ER_DUP_ENTRY") redirect(`${id ? `/contacts/${id}` : "/contacts/new"}?error=duplicate`);
    throw e;
  }
  const listIds = formData.getAll("list").map(String).filter(Boolean);
  if (formData.has("lists_present")) {
    await db.delete(listMembers).where(eq(listMembers.contactId, cid));
    if (listIds.length) await db.insert(listMembers).values(listIds.map((listId) => ({ listId, contactId: cid }))).onDuplicateKeyUpdate({ set: { listId: sql`list_id` } });
  }
  revalidatePath("/contacts");
  revalidatePath("/companies", "layout");
  redirect(`/contacts/${cid}?saved=1`);
}

export async function setOptOut(id: string, optedOut: boolean) {
  await requireUser();
  await db.update(contacts).set({ optedOut, optedOutAt: optedOut ? new Date() : null }).where(eq(contacts.id, id));
  revalidatePath(`/contacts/${id}`);
  revalidatePath("/contacts");
}

export async function deleteContacts(ids: string[]) {
  await requireUser();
  if (!ids.length) return;
  await db.delete(listMembers).where(inArray(listMembers.contactId, ids));
  await db.delete(messages).where(inArray(messages.contactId, ids));
  await db.update(campaignRecipients).set({ contactId: null }).where(inArray(campaignRecipients.contactId, ids));
  await db.delete(contacts).where(inArray(contacts.id, ids));
  revalidatePath("/contacts");
}

export async function addToList(ids: string[], listId: string) {
  await requireUser();
  if (!ids.length || !listId) return;
  await db.insert(listMembers).values(ids.map((contactId) => ({ listId, contactId }))).onDuplicateKeyUpdate({ set: { listId: sql`list_id` } });
  revalidatePath("/contacts");
  revalidatePath(`/lists/${listId}`);
}

export async function removeFromList(ids: string[], listId: string) {
  await requireUser();
  await db.delete(listMembers).where(and(eq(listMembers.listId, listId), inArray(listMembers.contactId, ids)));
  revalidatePath(`/lists/${listId}`);
}

/** Upserts contacts by phone. Returns counts + ids (in input order, "" for invalid rows). */
export async function importContacts(rows: ImportRow[], listId?: string, overwrite = true) {
  await requireUser();
  const { defaultCountryCode } = await getSettings();
  let invalid = 0;
  const clean = new Map<string, ImportRow>();
  for (const r of rows) {
    const phone = normalizePhone(r.phone, defaultCountryCode);
    if (!phone) {
      invalid++;
      continue;
    }
    clean.set(phone, { ...r, phone });
  }
  const list = [...clean.values()];
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    await db
      .insert(contacts)
      .values(chunk.map((r) => ({ id: crypto.randomUUID(), phone: r.phone, name: (r.name ?? "").trim().slice(0, 191), email: (r.email ?? "").trim().slice(0, 191), custom: r.custom ?? {} })))
      .onDuplicateKeyUpdate({
        set: overwrite
          ? {
              name: sql`if(values(${contacts.name}) <> '', values(${contacts.name}), ${contacts.name})`,
              email: sql`if(values(${contacts.email}) <> '', values(${contacts.email}), ${contacts.email})`,
              custom: sql`json_merge_patch(${contacts.custom}, values(${contacts.custom}))`,
            }
          : { phone: sql`${contacts.phone}` },
      });
  }
  const phones = list.map((r) => r.phone);
  const idByPhone = new Map<string, string>();
  for (let i = 0; i < phones.length; i += 1000) {
    const got = await db.select({ id: contacts.id, phone: contacts.phone }).from(contacts).where(inArray(contacts.phone, phones.slice(i, i + 1000)));
    for (const g of got) idByPhone.set(g.phone, g.id);
  }
  if (listId && idByPhone.size) {
    const ids = [...idByPhone.values()];
    for (let i = 0; i < ids.length; i += 1000) {
      await db.insert(listMembers).values(ids.slice(i, i + 1000).map((contactId) => ({ listId, contactId }))).onDuplicateKeyUpdate({ set: { listId: sql`list_id` } });
    }
  }
  revalidatePath("/contacts");
  return { imported: list.length, invalid, duplicates: rows.length - invalid - list.length };
}
