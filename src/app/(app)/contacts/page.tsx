import Link from "next/link";
import { and, asc, eq, like, or, sql, type SQL } from "drizzle-orm";
import { IconUser, IconPlus, IconUpload, IconSearch } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { contacts, lists, segments } from "@/db/schema";
import { getSegment, segmentWhere } from "@/lib/segments";
import { loadContactRows, PAGE } from "@/lib/contacts-query";
import { Page, Empty } from "@/components/ui";
import { ContactsTable } from "@/components/contacts-table";
import { addToList, deleteContacts } from "./actions";
import { can } from "@/lib/permissions";
import { requireUser } from "@/lib/auth";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; list?: string; status?: string; segment?: string; page?: string }>;
}) {
  const canDelete = await can(await requireUser(), "contacts.delete");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const conds: SQL[] = [];
  if (sp.q) {
    const q = `%${sp.q.trim()}%`;
    conds.push(or(like(contacts.name, q), like(contacts.phone, `%${sp.q.replace(/\D/g, "") || sp.q}%`), like(contacts.email, q))!);
  }
  if (sp.list) conds.push(sql`${contacts.id} in (select contact_id from list_members where list_id = ${sp.list})`);
  if (sp.status === "opted_out") conds.push(eq(contacts.optedOut, true));
  if (sp.status === "active") conds.push(eq(contacts.optedOut, false));
  if (sp.segment) {
    const seg = await getSegment(sp.segment);
    if (seg) conds.push(segmentWhere(seg));
  }
  const where = conds.length ? and(...conds) : undefined;
  const [{ rows, total }, allLists, allSegments] = await Promise.all([
    loadContactRows(where, page),
    db.select().from(lists).orderBy(asc(lists.name)),
    db.select({ id: segments.id, name: segments.name }).from(segments).orderBy(asc(segments.name)),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => {
    const u = new URLSearchParams({ ...(sp as Record<string, string>), page: String(p) });
    return `/contacts?${u}`;
  };

  return (
    <Page
      title="Contacts"
      icon={<IconUser />}
      noPad
      actions={
        <>
          <Link href="/contacts/import" className="btn"><IconUpload size={14} /> Import</Link>
          <Link href="/contacts/new" className="btn btn-primary"><IconPlus size={14} /> New contact</Link>
        </>
      }
    >
      <form className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="relative">
          <IconSearch size={14} className="absolute top-2 left-2 text-ink-3" />
          <input name="q" defaultValue={sp.q} placeholder="Search name, phone, email" className="input h-7 w-64 pl-7" />
        </div>
        <select name="list" defaultValue={sp.list ?? ""} className="input h-7 w-auto">
          <option value="">All lists</option>
          {allLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        {allSegments.length > 0 && (
          <select name="segment" defaultValue={sp.segment ?? ""} className="input h-7 w-auto">
            <option value="">Any segment</option>
            {allSegments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <select name="status" defaultValue={sp.status ?? ""} className="input h-7 w-auto">
          <option value="">Any status</option>
          <option value="active">Subscribed</option>
          <option value="opted_out">Opted out</option>
        </select>
        <button className="btn">Filter</button>
        <span className="ml-auto text-sm text-ink-3">{total.toLocaleString("en-IN")} contacts</span>
      </form>
      {rows.length ? (
        <ContactsTable rows={rows} lists={allLists} onDelete={canDelete ? deleteContacts : undefined} onAddToList={addToList} />
      ) : (
        <Empty icon={<IconUser />} title="No contacts found" hint="Add a contact or import a CSV / Excel file." action={<Link href="/contacts/import" className="btn btn-primary"><IconUpload size={14} /> Import contacts</Link>} />
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 px-3 py-2 text-sm text-ink-3">
          {page > 1 && <Link className="btn" href={qs(page - 1)}>Previous</Link>}
          <span>Page {page} of {pages}</span>
          {page < pages && <Link className="btn" href={qs(page + 1)}>Next</Link>}
        </div>
      )}
    </Page>
  );
}
