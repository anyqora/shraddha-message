import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { IconList, IconSpeakerphone, IconTrash } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { contacts, lists } from "@/db/schema";
import { Page, Empty, CHIP_COLORS } from "@/components/ui";
import { ContactsTable } from "@/components/contacts-table";
import { loadContactRows } from "@/lib/contacts-query";
import { addToList, deleteContacts, removeFromList } from "../../contacts/actions";
import { deleteList, updateList } from "../actions";

export default async function ListPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const { id } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const [l] = await db.select().from(lists).where(eq(lists.id, id)).limit(1);
  if (!l) notFound();
  const where = sql`${contacts.id} in (select contact_id from list_members where list_id = ${id})`;
  const [{ rows, total }, all] = await Promise.all([loadContactRows(where, page), db.select().from(lists).orderBy(asc(lists.name))]);
  const del = deleteList.bind(null, id);
  return (
    <Page
      title={l.name}
      icon={<IconList />}
      noPad
      crumbs={[{ href: "/lists", label: "Lists" }]}
      actions={
        <>
          <form action={del}><button className="btn btn-danger"><IconTrash size={14} /> Delete list</button></form>
          <Link href={`/campaigns/new?list=${id}`} className="btn btn-primary"><IconSpeakerphone size={14} /> Send campaign</Link>
        </>
      }
    >
      <form action={updateList} className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <input type="hidden" name="id" value={id} />
        <input name="name" defaultValue={l.name} className="input h-7 w-56" />
        <input name="description" defaultValue={l.description} placeholder="Description" className="input h-7 w-72" />
        <select name="color" defaultValue={l.color} className="input h-7 w-auto">{CHIP_COLORS.map((c) => <option key={c}>{c}</option>)}</select>
        <button className="btn">Save</button>
        <span className="ml-auto text-sm text-ink-3">{total.toLocaleString("en-IN")} contacts</span>
      </form>
      {rows.length ? (
        <ContactsTable rows={rows} lists={all} onDelete={deleteContacts} onAddToList={addToList} onRemoveFromList={removeFromList} currentListId={id} />
      ) : (
        <Empty icon={<IconList />} title="This list is empty" hint="Select contacts on the Contacts page and use “Add to list”, or import a file into this list." action={<Link href="/contacts/import" className="btn">Import contacts</Link>} />
      )}
      {total > 50 && (
        <div className="flex justify-end gap-2 px-3 py-2">
          {page > 1 && <Link className="btn" href={`/lists/${id}?page=${page - 1}`}>Previous</Link>}
          {page * 50 < total && <Link className="btn" href={`/lists/${id}?page=${page + 1}`}>Next</Link>}
        </div>
      )}
    </Page>
  );
}
