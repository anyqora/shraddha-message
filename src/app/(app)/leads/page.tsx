import Link from "next/link";
import { and, eq, like, or, sql } from "drizzle-orm";
import { IconAddressBook, IconDownload, IconSearch } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { contacts, leads, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { CONTACT_KEYS, LEAD_STATUSES, loadLeads, type LeadStatus } from "@/lib/leads";
import { formatPhone } from "@/lib/phone";
import { cn, timeAgo } from "@/lib/utils";
import { Avatar, Empty, Page } from "@/components/ui";
import { LeadAssigneeSelect, LeadStatusSelect } from "@/components/lead-controls";
import { LEAD_STATUS_META } from "@/lib/lead-status";
import { setLeadAssignee, setLeadStatus } from "./actions";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const status = LEAD_STATUSES.includes(sp.status as LeadStatus) ? (sp.status as LeadStatus) : null;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const search = q
    ? or(like(leads.title, `%${q}%`), like(contacts.name, `%${q}%`), like(contacts.phone, `%${q.replace(/\D/g, "") || q}%`))
    : undefined;

  const [rows, counts, team] = await Promise.all([
    loadLeads(and(status ? eq(leads.status, status) : undefined, search)),
    db.select({ status: leads.status, n: sql<number>`count(*)` }).from(leads).groupBy(leads.status),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users),
  ]);
  const count = new Map(counts.map((c) => [c.status, Number(c.n)]));
  const total = counts.reduce((a, c) => a + Number(c.n), 0);
  const userOpts = team.map((u) => ({ id: u.id, name: u.name || u.email }));
  const qs = (st: string | null) => {
    const p = new URLSearchParams();
    if (st) p.set("status", st);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <Page
      title="Leads"
      icon={<IconAddressBook />}
      noPad
      actions={
        <a href={`/leads/export${qs(status)}`} className="btn">
          <IconDownload size={14} /> Export CSV
        </a>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="flex flex-wrap rounded-sm border border-line p-0.5">
          {[null, ...LEAD_STATUSES].map((st) => (
            <Link
              key={st ?? "all"}
              href={`/leads${qs(st)}`}
              className={cn(
                "rounded-[3px] px-2 py-0.5 text-sm font-medium",
                status === st ? "bg-hover text-ink" : "text-ink-3 hover:text-ink-2",
              )}
            >
              {st ? LEAD_STATUS_META[st].label : "All"} <span className="font-normal text-ink-4">{st ? count.get(st) ?? 0 : total}</span>
            </Link>
          ))}
        </div>
        <form className="ml-auto flex items-center gap-1" action="/leads">
          {status && <input type="hidden" name="status" value={status} />}
          <div className="relative">
            <IconSearch size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-3" />
            <input name="q" defaultValue={q} placeholder="Search name, phone, title" className="input h-7 w-56 pl-7" />
          </div>
        </form>
      </div>

      {rows.length === 0 ? (
        <Empty
          icon={<IconAddressBook />}
          title={total ? "No leads match" : "No leads yet"}
          hint={total ? "Try another filter." : "Leads are saved by the chatbot’s “Save lead” step. Add the Lead form recipe on the Chatbot page to start collecting them."}
          action={!total ? <Link href="/chatbot" className="btn">Open chatbot</Link> : undefined}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-grid w-full min-w-[960px] table-fixed">
            <thead>
              <tr>
                <th className="w-56">Contact</th>
                <th className="w-48">Title</th>
                <th>Answers</th>
                <th className="w-24">Source</th>
                <th className="w-28">Status</th>
                <th className="w-40">Assigned</th>
                <th className="w-24">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ lead, contactName, contactPhone }) => {
                const d = lead.data ?? {};
                const name = contactName || d.name || "Unknown";
                const answers = Object.entries(d).filter(([k, v]) => !CONTACT_KEYS.has(k) && v);
                return (
                  <tr key={lead.id}>
                    <td>
                      <Link href={`/leads/${lead.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                        <Avatar name={name} seed={lead.contactId ?? lead.id} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{name}</span>
                          <span className="block truncate text-xs text-ink-3">{formatPhone(contactPhone || d.phone || "")}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="truncate">
                      <Link href={`/leads/${lead.id}`} className="hover:underline">{lead.title || "—"}</Link>
                    </td>
                    <td className="truncate text-ink-2" title={answers.map(([k, v]) => `${k}: ${v}`).join("\n")}>
                      {answers.length ? (
                        answers.slice(0, 3).map(([k, v], i) => (
                          <span key={k}>
                            {i > 0 && <span className="text-ink-4"> · </span>}
                            <span className="text-ink-3">{k}:</span> {v}
                          </span>
                        ))
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </td>
                    <td className="truncate text-ink-2">{lead.source}</td>
                    <td><LeadStatusSelect status={lead.status} action={setLeadStatus.bind(null, lead.id)} /></td>
                    <td>
                      <LeadAssigneeSelect value={lead.assignedTo} users={userOpts} action={setLeadAssignee.bind(null, lead.id)} />
                    </td>
                    <td className="text-ink-3" title={lead.createdAt.toISOString()}>{timeAgo(lead.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length >= 500 && <div className="px-3 py-2 text-xs text-ink-3">Showing the latest 500 leads. Use filters or the CSV export for more.</div>}
        </div>
      )}
    </Page>
  );
}
