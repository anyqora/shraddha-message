import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, ne } from "drizzle-orm";
import { IconAddressBook, IconMessage, IconUser } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { deals, leads, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { CONTACT_KEYS, loadLeads } from "@/lib/leads";
import { formatPhone } from "@/lib/phone";
import { formatDateTime } from "@/lib/utils";
import { Avatar, Field, Page } from "@/components/ui";
import { ConvertLeadButton, DeleteLeadButton, LeadAssigneeSelect, LeadStatusSelect, LeadTitleInput } from "@/components/lead-controls";
import { convertLeadToDeal, deleteLead, setLeadAssignee, setLeadStatus, updateLeadTitle } from "../actions";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const [row] = await loadLeads(eq(leads.id, id), 1);
  if (!row) notFound();
  const { lead } = row;
  const d = lead.data ?? {};
  const name = row.contactName || d.name || "Unknown";

  const [team, others, contactDeals] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email }).from(users),
    lead.contactId ? loadLeads(and(eq(leads.contactId, lead.contactId), ne(leads.id, lead.id)), 10) : Promise.resolve([]),
    lead.contactId
      ? db.select({ id: deals.id, title: deals.title }).from(deals).where(eq(deals.contactId, lead.contactId)).orderBy(desc(deals.createdAt)).limit(5)
      : Promise.resolve([]),
  ]);
  const answers = Object.entries(d).filter(([k]) => !CONTACT_KEYS.has(k));

  return (
    <Page
      title={lead.title || "Lead"}
      icon={<IconAddressBook />}
      crumbs={[{ href: "/leads", label: "Leads" }]}
      actions={<DeleteLeadButton action={deleteLead.bind(null, lead.id)} />}
    >
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <div className="card space-y-3 p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_140px_180px]">
              <Field label="Title">
                <LeadTitleInput title={lead.title} action={updateLeadTitle.bind(null, lead.id)} />
              </Field>
              <div>
                <span className="label">Status</span>
                <div className="flex h-8 items-center">
                  <LeadStatusSelect status={lead.status} action={setLeadStatus.bind(null, lead.id)} />
                </div>
              </div>
              <div>
                <span className="label">Assigned to</span>
                <LeadAssigneeSelect
                  value={lead.assignedTo}
                  users={team.map((u) => ({ id: u.id, name: u.name || u.email }))}
                  action={setLeadAssignee.bind(null, lead.id)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-3">
              <span>Source: <span className="text-ink-2">{lead.source}</span></span>
              <span>Created: <span className="text-ink-2">{formatDateTime(lead.createdAt)}</span></span>
              <span>Updated: <span className="text-ink-2">{formatDateTime(lead.updatedAt)}</span></span>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-line px-3 py-2 text-sm font-medium text-ink">Collected data</div>
            <table className="table-grid w-full table-fixed">
              <tbody>
                {[["name", d.name], ["phone", d.phone], ["email", d.email], ...answers]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td className="w-44 text-ink-3">{k}</td>
                      <td className="break-words whitespace-pre-wrap">{k === "phone" ? formatPhone(String(v)) : v}</td>
                    </tr>
                  ))}
                {!Object.keys(d).length && (
                  <tr><td className="text-ink-3">No data was collected.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card flex flex-wrap items-center gap-3 p-3">
            <ConvertLeadButton action={convertLeadToDeal.bind(null, lead.id)} />
            <span className="text-xs text-ink-3">Creates a deal in the first open stage of your first pipeline and marks this lead converted.</span>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="card space-y-2 p-3">
            <div className="flex items-center gap-2">
              <Avatar name={name} seed={lead.contactId ?? lead.id} size={28} />
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">{name}</div>
                <div className="truncate text-xs text-ink-3">{formatPhone(row.contactPhone || d.phone || "")}</div>
              </div>
            </div>
            {lead.contactId ? (
              <div className="grid grid-cols-2 gap-2">
                <Link href={`/inbox/${lead.contactId}`} className="btn justify-center"><IconMessage size={14} /> Chat</Link>
                <Link href={`/contacts/${lead.contactId}`} className="btn justify-center"><IconUser size={14} /> Contact</Link>
              </div>
            ) : (
              <p className="text-xs text-ink-3">The contact for this lead was deleted.</p>
            )}
          </div>

          {contactDeals.length > 0 && (
            <div className="card p-3">
              <div className="label">Deals for this contact</div>
              <ul className="space-y-1 text-sm">
                {contactDeals.map((x) => (
                  <li key={x.id}><Link href={`/deals/${x.id}`} className="text-accent hover:underline">{x.title}</Link></li>
                ))}
              </ul>
            </div>
          )}

          {others.length > 0 && (
            <div className="card p-3">
              <div className="label">Other leads from this contact</div>
              <ul className="space-y-1 text-sm">
                {others.map((o) => (
                  <li key={o.lead.id} className="flex items-center justify-between gap-2">
                    <Link href={`/leads/${o.lead.id}`} className="truncate text-accent hover:underline">{o.lead.title || "Lead"}</Link>
                    <span className="shrink-0 text-xs text-ink-3">{o.lead.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </Page>
  );
}
