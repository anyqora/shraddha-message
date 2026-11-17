"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { segments, type SegmentRule } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { countSegment } from "@/lib/segments";

function clean(rules: unknown): SegmentRule[] {
  if (!Array.isArray(rules)) return [];
  return rules
    .filter((r) => r && typeof r.field === "string" && typeof r.op === "string")
    .slice(0, 50)
    .map((r) => ({ field: String(r.field).slice(0, 200), op: String(r.op).slice(0, 32), value: r.value == null ? "" : String(r.value).slice(0, 500) }));
}

export async function previewSegmentCount(match: "all" | "any", rules: SegmentRule[]): Promise<number> {
  await requireUser();
  try {
    return await countSegment({ match: match === "any" ? "any" : "all", rules: clean(rules) });
  } catch {
    return -1;
  }
}

export async function saveSegment(_: unknown, fd: FormData): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  let id = String(fd.get("id") ?? "");
  try {
    const name = String(fd.get("name") ?? "").trim().slice(0, 191);
    if (!name) throw new Error("Give the segment a name.");
    const match = fd.get("match") === "any" ? "any" : "all";
    const rules = clean(JSON.parse(String(fd.get("rules") ?? "[]")));
    if (id) await db.update(segments).set({ name, match, rules }).where(eq(segments.id, id));
    else {
      id = crypto.randomUUID();
      await db.insert(segments).values({ id, name, match, rules });
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/segments");
  revalidatePath(`/segments/${id}`);
  redirect(`/segments/${id}?saved=1`);
}

export async function deleteSegment(id: string) {
  await requireUser();
  await db.delete(segments).where(eq(segments.id, id));
  revalidatePath("/segments");
  redirect("/segments");
}
