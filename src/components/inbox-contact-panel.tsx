import Link from "next/link";
import { eq } from "drizzle-orm";
import { IconExternalLink, IconPhone, IconMail, IconBuilding, IconUserCheck } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { companies, listMembers, lists, type Contact } from "@/db/schema";
import { Avatar, Chip } from "./ui";
import { InboxPanelShell } from "./inbox-panel-shell";
import { formatPhone } from "@/lib/phone";
import { formatDateTime } from "@/lib/utils";

function Row({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5 text-sm">
      <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs text-ink-3 [&>svg]:size-3.5">
        {icon}
        {label}
      </span>
      <span className="min-w-0 flex-1 break-words text-ink-2">{children}</span>
    </div>
  );
}

export async function InboxContactPanel({ contact: c, assignee }: { contact: Contact; assignee?: { id: string; name: string; email: string } }) {
  const [memberLists, company] = await Promise.all([
    db
      .select({ id: lists.id, name: lists.name, color: lists.color })
      .from(listMembers)
      .innerJoin(lists, eq(lists.id, listMembers.listId))
      .where(eq(listMembers.contactId, c.id)),
    c.companyId
      ? db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, c.companyId)).limit(1).then((r) => r[0])
      : Promise.resolve(undefined),
  ]);
  const custom = Object.entries(c.custom ?? {}).filter(([, v]) => String(v ?? "").trim());
  const empty = <span className="text-ink-4">—</span>;

  return (
    <InboxPanelShell>
      <div className="flex flex-col items-center gap-2 border-b border-line px-4 pt-6 pb-4 text-center">
        <Avatar name={c.name || c.phone} seed={c.id} size={48} />
        <div className="min-w-0 max-w-full">
          <div className="truncate font-medium text-ink">{c.name || formatPhone(c.phone)}</div>
          <div className="text-xs text-ink-3">{formatPhone(c.phone)}</div>
        </div>
        <div className="flex flex-wrap justify-center gap-1">
          {c.optedOut ? <Chip color="red">Opted out</Chip> : <Chip color="green">Subscribed</Chip>}
          <Chip color={c.chatStatus === "closed" ? "gray" : "blue"}>{c.chatStatus === "closed" ? "Closed" : "Open"}</Chip>
        </div>
      </div>

      <div className="border-b border-line px-4 py-3">
        <div className="mb-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Details</div>
        <Row icon={<IconPhone />} label="Phone">
          <a href={`tel:+${c.phone}`} className="hover:underline">{formatPhone(c.phone)}</a>
        </Row>
        <Row icon={<IconMail />} label="Email">
          {c.email ? <a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a> : empty}
        </Row>
        <Row icon={<IconBuilding />} label="Company">
          {company ? company.name : empty}
        </Row>
        <Row icon={<IconUserCheck />} label="Assignee">
          {assignee ? (
            <span className="inline-flex items-center gap-1.5">
              <Avatar name={assignee.name || assignee.email} seed={assignee.id} size={16} />
              <span className="truncate">{assignee.name || assignee.email}</span>
            </span>
          ) : (
            <span className="text-ink-3">Unassigned</span>
          )}
        </Row>
        <Row label="Opted out">{c.optedOut ? `Yes${c.optedOutAt ? ` · ${formatDateTime(c.optedOutAt)}` : ""}` : "No"}</Row>
        <Row label="Last inbound">{c.lastInboundAt ? formatDateTime(c.lastInboundAt) : empty}</Row>
      </div>

      <div className="border-b border-line px-4 py-3">
        <div className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Lists</div>
        {memberLists.length ? (
          <div className="flex flex-wrap gap-1">
            {memberLists.map((l) => (
              <Link key={l.id} href={`/lists/${l.id}`}>
                <Chip color={l.color}>{l.name}</Chip>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-sm text-ink-3">Not in any list</div>
        )}
      </div>

      {custom.length > 0 && (
        <div className="border-b border-line px-4 py-3">
          <div className="mb-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Custom fields</div>
          {custom.map(([k, v]) => (
            <Row key={k} label={k}>{String(v)}</Row>
          ))}
        </div>
      )}

      <div className="px-4 py-3">
        <Link href={`/contacts/${c.id}`} className="btn w-full justify-center">
          <IconExternalLink size={14} /> Open contact
        </Link>
      </div>
    </InboxPanelShell>
  );
}
