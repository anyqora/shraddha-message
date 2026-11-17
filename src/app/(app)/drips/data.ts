import "server-only";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { lists, templates, type TemplateComponent } from "@/db/schema";
import { templateShape } from "@/lib/template-utils";

export type DripTemplateOption = { id: string; name: string; language: string; category: string; bodyVars: number; components: TemplateComponent[] };
export type DripListOption = { id: string; name: string };

/** Approved templates without a media header (sendable from drips & wishes) + all lists. */
export async function dripOptions(): Promise<{ templates: DripTemplateOption[]; lists: DripListOption[] }> {
  const [t, l] = await Promise.all([
    db.select().from(templates).orderBy(asc(templates.name)),
    db.select({ id: lists.id, name: lists.name }).from(lists).orderBy(asc(lists.name)),
  ]);
  return {
    templates: t
      .filter((x) => x.status === "APPROVED" && !templateShape(x.components).headerMedia)
      .map((x) => ({ id: x.id, name: x.name, language: x.language, category: x.category, bodyVars: templateShape(x.components).bodyVars, components: x.components })),
    lists: l,
  };
}
