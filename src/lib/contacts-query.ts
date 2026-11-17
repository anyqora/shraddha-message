import "server-only";
import { desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { contacts, listMembers, lists } from "@/db/schema";

export const PAGE = 50;

export async function loadContactRows(where: SQL | undefined, page: number) {
  const [rows, [{ n }]] = await Promise.all([
    db.select().from(contacts).where(where).orderBy(desc(contacts.createdAt)).limit(PAGE).offset((page - 1) * PAGE),
    db.select({ n: sql<number>`count(*)` }).from(contacts).where(where),
  ]);
  const ids = rows.map((r) => r.id);
  const mem = ids.length
    ? await db
        .select({ contactId: listMembers.contactId, id: lists.id, name: lists.name, color: lists.color })
        .from(listMembers)
        .innerJoin(lists, eq(lists.id, listMembers.listId))
        .where(inArray(listMembers.contactId, ids))
    : [];
  return {
    total: Number(n),
    rows: rows.map((r) => ({ ...r, lists: mem.filter((m) => m.contactId === r.id) })),
  };
}

