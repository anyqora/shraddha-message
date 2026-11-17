import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import {
  IconBuilding,
  IconBuildingFactory2,
  IconCalendar,
  IconCheckbox,
  IconEdit,
  IconLink,
  IconLinkOff,
  IconMapPin,
  IconNotes,
  IconPhone,
  IconPlus,
  IconTargetArrow,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import { db } from "@/lib/db";
import { companies, contacts, deals, notes, tasks } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { loadCrmOptions, loadDeals, loadLinkableContacts, loadNotes, loadTasks } from "@/lib/crm-queries";
import { inr } from "@/lib/crm-utils";
import { formatPhone } from "@/lib/phone";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { Avatar, Chip, Empty, Notice, Page } from "@/components/ui";
import { FieldList, FieldRow, Muted, RecordLayout, RecordTabs, SummaryHeader } from "@/components/crm-record";
import { CompanyForm } from "@/components/crm-company-form";
import { CrmNotes } from "@/components/crm-notes";
import { CrmTasks } from "@/components/crm-tasks";
import { CrmDealList } from "@/components/crm-deal-list";
import { deleteCompany, linkContact, saveCompany, unlinkContact } from "../actions";

const TABS = ["contacts", "deals", "notes", "tasks"] as const;

export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; edit?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const [c] = await db.select().from(companies).where(eq(companies.id, id)).limit(1);
  if (!c) notFound();
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "contacts";
  const [people, dealRows, noteRows, taskRows, opts, linkable] = await Promise.all([
    db.select().from(contacts).where(eq(contacts.companyId, id)).orderBy(desc(contacts.lastMessageAt)),
    loadDeals(eq(deals.companyId, id)),
    loadNotes(eq(notes.companyId, id)),
    loadTasks(eq(tasks.companyId, id)),
    loadCrmOptions(),
    tab === "contacts" ? loadLinkableContacts(id) : Promise.resolve([]),
  ]);
  const openValue = dealRows.filter((d) => d.stageKind === "open").reduce((a, d) => a + d.amount, 0);
  const base = `/companies/${id}`;
  const del = deleteCompany.bind(null, id);
  const link = linkContact.bind(null, id);

  return (
    <Page
      title={c.name}
      icon={<IconBuilding />}
      noPad
      crumbs={[{ href: "/companies", label: "Companies" }]}
      actions={
        <form action={del}>
          <button className="btn btn-danger" title="Contacts and deals are unlinked; notes and tasks are deleted"><IconTrash size={14} /> Delete</button>
        </form>
      }
    >
      <RecordLayout
        summary={
          <>
            <SummaryHeader
              avatar={<Avatar name={c.name} seed={c.id} size={48} />}
              title={c.name}
              subtitle={c.domain || undefined}
              actions={
                sp.edit ? (
                  <Link href={base} className="btn">Cancel</Link>
                ) : (
                  <Link href={`${base}?edit=1&tab=${tab}`} className="btn"><IconEdit size={14} /> Edit</Link>
                )
              }
            />
            {sp.error && <div className="px-3 pt-3"><Notice tone="error">Company name is required.</Notice></div>}
            {sp.edit ? (
              <div className="p-3"><CompanyForm action={saveCompany} company={c} /></div>
            ) : (
              <FieldList>
                <FieldRow icon={<IconLink />} label="Domain">
                  {c.domain ? <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">{c.domain}</a> : <Muted />}
                </FieldRow>
                <FieldRow icon={<IconBuildingFactory2 />} label="Industry">{c.industry || <Muted />}</FieldRow>
                <FieldRow icon={<IconMapPin />} label="City">{c.city || <Muted />}</FieldRow>
                <FieldRow icon={<IconPhone />} label="Phone">{c.phone || <Muted />}</FieldRow>
                <FieldRow icon={<IconUsers />} label="Contacts">{people.length}</FieldRow>
                <FieldRow icon={<IconTargetArrow />} label="Open deals">{inr(openValue)}</FieldRow>
                <FieldRow icon={<IconCalendar />} label="Created">{formatDateTime(c.createdAt)}</FieldRow>
              </FieldList>
            )}
          </>
        }
      >
        <RecordTabs
          base={base}
          current={tab}
          tabs={[
            { key: "contacts", label: "Contacts", icon: <IconUsers />, count: people.length },
            { key: "deals", label: "Deals", icon: <IconTargetArrow />, count: dealRows.length },
            { key: "notes", label: "Notes", icon: <IconNotes />, count: noteRows.length },
            { key: "tasks", label: "Tasks", icon: <IconCheckbox />, count: taskRows.filter((t) => t.status !== "done").length },
          ]}
        />
        <div className="mx-auto max-w-3xl space-y-3 p-4">
          {tab === "contacts" && (
            <>
              <form action={link} className="flex items-center gap-2">
                <select name="contactId" required defaultValue="" className="input h-7 flex-1">
                  <option value="" disabled>Link an existing contact…</option>
                  {linkable.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <button className="btn"><IconLink size={14} /> Link</button>
              </form>
              {people.length ? (
                <div className="card overflow-hidden">
                  <ul>
                    {people.map((p) => (
                      <li key={p.id} className="group flex h-10 items-center gap-2 border-b border-line-light px-3 last:border-b-0 hover:bg-soft">
                        <Avatar name={p.name || p.phone} seed={p.id} size={20} />
                        <Link href={`/contacts/${p.id}`} className="min-w-0 truncate font-medium hover:underline">{p.name || formatPhone(p.phone)}</Link>
                        <span className="text-ink-3">{formatPhone(p.phone)}</span>
                        {p.email && <span className="truncate text-ink-3">{p.email}</span>}
                        {p.optedOut && <Chip color="red">Opted out</Chip>}
                        <span className="ml-auto text-xs text-ink-3">{p.lastMessageAt ? timeAgo(p.lastMessageAt) : ""}</span>
                        <form action={unlinkContact.bind(null, id, p.id)}>
                          <button className="btn btn-ghost h-6 px-1 text-ink-3 opacity-0 group-hover:opacity-100" title="Unlink from company"><IconLinkOff size={13} /></button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <Empty icon={<IconUsers />} title="No contacts linked" hint="Link an existing contact above, or set the company on a contact." />
              )}
            </>
          )}
          {tab === "deals" && (
            <CrmDealList
              deals={dealRows}
              hide="company"
              action={<Link href={`/deals/new?companyId=${id}&return=${encodeURIComponent(`${base}?tab=deals`)}`} className="btn btn-primary"><IconPlus size={14} /> New deal</Link>}
            />
          )}
          {tab === "notes" && <CrmNotes notes={noteRows} target={{ companyId: id }} />}
          {tab === "tasks" && <CrmTasks tasks={taskRows} target={{ companyId: id }} users={opts.users} defaultAssignee={user.id} />}
        </div>
      </RecordLayout>
    </Page>
  );
}
