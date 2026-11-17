import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { IconList } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { listMembers, lists } from "@/db/schema";
import { Page, Chip, CHIP_COLORS } from "@/components/ui";
import { createListForm } from "./actions";
import { timeAgo } from "@/lib/utils";

export default async function ListsPage() {
  const rows = await db
    .select({ l: lists, n: sql<number>`count(${listMembers.contactId})` })
    .from(lists)
    .leftJoin(listMembers, eq(listMembers.listId, lists.id))
    .groupBy(lists.id)
    .orderBy(asc(lists.name));
  return (
    <Page title="Lists" icon={<IconList />} noPad>
      <form action={createListForm} className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <input name="name" required placeholder="New list name" className="input h-7 w-56" />
        <input name="description" placeholder="Description (optional)" className="input h-7 w-72" />
        <select name="color" className="input h-7 w-auto">{CHIP_COLORS.map((c) => <option key={c}>{c}</option>)}</select>
        <button className="btn btn-primary">Create list</button>
      </form>
      <table className="table-grid w-full">
        <thead><tr><th>Name</th><th>Description</th><th>Contacts</th><th>Created</th></tr></thead>
        <tbody>
          {rows.map(({ l, n }) => (
            <tr key={l.id}>
              <td><Link href={`/lists/${l.id}`}><Chip color={l.color}>{l.name}</Chip></Link></td>
              <td className="text-ink-2">{l.description}</td>
              <td>{Number(n).toLocaleString("en-IN")}</td>
              <td className="text-ink-2">{timeAgo(l.createdAt)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4} className="text-center text-ink-3">No lists yet. Lists are used to target campaigns.</td></tr>}
        </tbody>
      </table>
    </Page>
  );
}
