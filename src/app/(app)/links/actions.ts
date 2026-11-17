"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { waLinks } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { assertPermission } from "@/lib/permissions";

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export async function createLink(_: unknown, fd: FormData): Promise<{ ok: boolean; message: string }> {
  await assertPermission("links.manage");
  let id = "";
  try {
    const name = String(fd.get("name") ?? "").trim().slice(0, 191);
    if (!name) throw new Error("Give the link a name.");
    const base = slugify(String(fd.get("slug") ?? "") || name) || "link";
    const message = String(fd.get("message") ?? "").trim().slice(0, 500);
    const listId = String(fd.get("listId") ?? "") || null;
    const taken = new Set((await db.select({ s: waLinks.slug }).from(waLinks).where(like(waLinks.slug, `${base}%`))).map((r) => r.s));
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
    id = crypto.randomUUID();
    await db.insert(waLinks).values({ id, name, slug, message, listId });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/links");
  redirect(`/links/${id}`);
}

export async function updateLink(fd: FormData) {
  await assertPermission("links.manage");
  const id = String(fd.get("id"));
  await db
    .update(waLinks)
    .set({
      name: String(fd.get("name") ?? "").trim().slice(0, 191) || "Untitled",
      message: String(fd.get("message") ?? "").trim().slice(0, 500),
      listId: String(fd.get("listId") ?? "") || null,
    })
    .where(eq(waLinks.id, id));
  revalidatePath("/links");
  revalidatePath(`/links/${id}`);
}

export async function deleteLink(id: string) {
  await assertPermission("links.manage");
  await db.delete(waLinks).where(eq(waLinks.id, id));
  revalidatePath("/links");
  redirect("/links");
}
