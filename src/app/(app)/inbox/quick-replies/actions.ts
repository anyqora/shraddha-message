"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { quickReplies } from "@/db/schema";
import { requireUser } from "@/lib/auth";

type Result = { ok: boolean; message: string };

export async function saveQuickReply(id: string | null, shortcutRaw: string, bodyRaw: string): Promise<Result> {
  await requireUser();
  const shortcut = shortcutRaw.trim().replace(/^\/+/, "").replace(/\s+/g, "-").toLowerCase();
  const body = bodyRaw.trim();
  if (!shortcut) return { ok: false, message: "Shortcut is required." };
  if (shortcut.length > 63) return { ok: false, message: "Shortcut is too long." };
  if (!body) return { ok: false, message: "Message text is required." };
  const dupe = await db
    .select({ id: quickReplies.id })
    .from(quickReplies)
    .where(id ? and(eq(quickReplies.shortcut, shortcut), ne(quickReplies.id, id)) : eq(quickReplies.shortcut, shortcut))
    .limit(1);
  if (dupe.length) return { ok: false, message: `/${shortcut} already exists.` };
  if (id) await db.update(quickReplies).set({ shortcut, body }).where(eq(quickReplies.id, id));
  else await db.insert(quickReplies).values({ shortcut, body });
  revalidatePath("/inbox/quick-replies");
  revalidatePath("/inbox", "layout");
  return { ok: true, message: "" };
}

export async function deleteQuickReply(id: string) {
  await requireUser();
  await db.delete(quickReplies).where(eq(quickReplies.id, id));
  revalidatePath("/inbox/quick-replies");
  revalidatePath("/inbox", "layout");
}
