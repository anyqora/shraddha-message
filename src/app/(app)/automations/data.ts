import "server-only";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { lists, templates, users } from "@/db/schema";
import { templateShape } from "@/lib/template-utils";
import type { BuilderOption, BuilderTemplate } from "@/components/automation-builder";

/** Options for the builder's selects (lists, approved text-header templates, users). */
export async function builderOptions(): Promise<{ lists: BuilderOption[]; templates: BuilderTemplate[]; users: BuilderOption[] }> {
  const [l, t, u] = await Promise.all([
    db.select({ id: lists.id, name: lists.name }).from(lists).orderBy(asc(lists.name)),
    db.select().from(templates).orderBy(asc(templates.name)),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name)),
  ]);
  return {
    lists: l,
    templates: t
      .filter((x) => x.status === "APPROVED" && !templateShape(x.components).headerMedia)
      .map((x) => {
        const s = templateShape(x.components);
        return { id: x.id, name: x.name, language: x.language, bodyVars: s.bodyVars, body: s.body?.text ?? "" };
      }),
    users: u.map((x) => ({ id: x.id, name: x.name || x.email })),
  };
}
