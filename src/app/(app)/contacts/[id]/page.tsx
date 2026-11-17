import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import {
  IconArrowDownLeft,
  IconArrowUpRight,
  IconBell,
  IconBellOff,
  IconBuilding,
  IconCalendar,
  IconCheckbox,
  IconClock,
  IconEdit,
  IconMail,
  IconMessageCircle,
  IconNotes,
  IconPhone,
  IconPlus,
  IconTag,
  IconTargetArrow,
  IconTimeline,
  IconUser,
  IconVariable,
} from "@tabler/icons-react";
import { db } from "@/lib/db";
import { companies, contacts, deals, listMembers, lists, messages, notes, tasks, type Message } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { loadCrmOptions, loadDeals, loadNotes, loadTasks } from "@/lib/crm-queries";
import { istDay, formatDay } from "@/lib/crm-utils";
import { Avatar, Chip, Empty, Notice, Page, StatusChip } from "@/components/ui";
import { ContactForm } from "@/components/contact-form";
import { FieldList, FieldRow, Muted, RecordLayout, RecordTabs, SummaryHeader } from "@/components/crm-record";
import { CrmNotes } from "@/components/crm-notes";
import { CrmTasks } from "@/components/crm-tasks";
import { CrmDealList } from "@/components/crm-deal-list";
import { saveContact, setOptOut } from "../actions";
import { formatPhone } from "@/lib/phone";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";

const TABS = ["timeline", "notes", "tasks", "deals"] as const;

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; tab?: string; edit?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  if (!c) notFound();
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "timeline";
  const editing = Boolean(sp.edit) || sp.error === "phone" || sp.error === "duplicate";
  const [all, mem, company, timeline, noteRows, taskRows, dealRows, opts] = await Promise.all([
    db.select().from(lists).orderBy(asc(lists.name)),
    db.select({ listId: listMembers.listId }).from(listMembers).where(eq(listMembers.contactId, id)),
    c.companyId ? db.select().from(companies).where(eq(companies.id, c.companyId)).limit(1).then((r) => r[0] ?? null) : Promise.resolve(null),
    tab === "timeline" ? db.select().from(messages).where(eq(messages.contactId, id)).orderBy(desc(messages.createdAt)).limit(200) : Promise.resolve([] as Message[]),
    loadNotes(eq(notes.contactId, id)),
    loadTasks(eq(tasks.contactId, id)),
    loadDeals(eq(deals.contactId, id)),
    loadCrmOptions(),
  ]);
  const memberIds = mem.map((m) => m.listId);
  const memberLists = all.filter((l) => memberIds.includes(l.id));
  const toggle = setOptOut.bind(null, c.id, !c.optedOut);
  const base = `/contacts/${id}`;
  const display = c.name || formatPhone(c.phone);
  const custom = Object.entries(c.custom ?? {}).filter(([k]) => k);

  // Group timeline by IST day
  const days: { day: string; items: typeof timeline }[] = [];
  for (const m of timeline) {
    const d = istDay(m.createdAt);
    const last = days[days.length - 1];
    if (last?.day === d) last.items.push(m);
    else days.push({ day: d, items: [m] });
  }

  return (
    <Page
      title={display}
      icon={<IconUser />}
      noPad
      crumbs={[{ href: "/contacts", label: "Contacts" }]}
      actions={<Link href={`/inbox/${c.id}`} className="btn btn-primary"><IconMessageCircle size={14} /> Open chat</Link>}
    >
      <RecordLayout
        summary={
          <>
            <SummaryHeader
              avatar={<Avatar name={c.name || c.phone} seed={c.id} size={48} />}
              title={c.name || "Unnamed"}
              subtitle={formatPhone(c.phone)}
              actions={
                editing ? (
                  <Link href={`${base}?tab=${tab}`} className="btn">Cancel</Link>
                ) : (
                  <Link href={`${base}?edit=1&tab=${tab}`} className="btn"><IconEdit size={14} /> Edit</Link>
                )
              }
            />
            <FieldList>
              <FieldRow icon={<IconPhone />} label="Phone">{formatPhone(c.phone)}</FieldRow>
              <FieldRow icon={<IconMail />} label="Email">
                {c.email ? <a href={`mailto:${c.email}`} className="text-accent hover:underline">{c.email}</a> : <Muted />}
              </FieldRow>
              <FieldRow icon={<IconBuilding />} label="Company">
                {company ? (
                  <Link href={`/companies/${company.id}`}>
                    <Chip><Avatar name={company.name} seed={company.id} size={12} />{company.name}</Chip>
                  </Link>
                ) : <Muted />}
              </FieldRow>
              <FieldRow icon={<IconTag />} label="Lists">
                {memberLists.length ? (
                  <span className="flex flex-wrap gap-1">
                    {memberLists.map((l) => (
                      <Link key={l.id} href={`/lists/${l.id}`}><Chip color={l.color}>{l.name}</Chip></Link>
                    ))}
                  </span>
                ) : <Muted />}
              </FieldRow>
              <FieldRow icon={c.optedOut ? <IconBellOff /> : <IconBell />} label="Broadcasts">
                <span className="flex flex-wrap items-center gap-2">
                  {c.optedOut ? <Chip color="red">Opted out</Chip> : <Chip color="green">Subscribed</Chip>}
                  <form action={toggle}>
                    <button className={cn("btn h-6 px-1.5 text-xs", !c.optedOut && "btn-danger")}>{c.optedOut ? "Re-subscribe" : "Opt out"}</button>
                  </form>
                </span>
                {c.optedOut && c.optedOutAt && <span className="mt-0.5 block text-xs text-ink-3">since {formatDateTime(c.optedOutAt)}</span>}
              </FieldRow>
              <FieldRow icon={<IconClock />} label="Last message">{c.lastMessageAt ? timeAgo(c.lastMessageAt) : <Muted>Never</Muted>}</FieldRow>
              <FieldRow icon={<IconCalendar />} label="Created">{formatDateTime(c.createdAt)}</FieldRow>
            </FieldList>
            {custom.length > 0 && (
              <div className="border-t border-line-light">
                <FieldList title="Custom fields">
                  {custom.map(([k, v]) => (
                    <FieldRow key={k} icon={<IconVariable />} label={k}>{v || <Muted />}</FieldRow>
                  ))}
                </FieldList>
              </div>
            )}
          </>
        }
      >
        {editing ? (
          <div className="mx-auto max-w-2xl space-y-3 p-4">
            {sp.error === "phone" && <Notice tone="error">Enter a valid phone number with country code.</Notice>}
            {sp.error === "duplicate" && <Notice tone="error">Another contact already uses this phone number.</Notice>}
            <div className="card p-4">
              <ContactForm contact={c} lists={all} memberOf={memberIds} action={saveContact} companies={opts.companies} />
            </div>
          </div>
        ) : (
          <>
            <RecordTabs
              base={base}
              current={tab}
              tabs={[
                { key: "timeline", label: "Timeline", icon: <IconTimeline /> },
                { key: "notes", label: "Notes", icon: <IconNotes />, count: noteRows.length },
                { key: "tasks", label: "Tasks", icon: <IconCheckbox />, count: taskRows.filter((t) => t.status !== "done").length },
                { key: "deals", label: "Deals", icon: <IconTargetArrow />, count: dealRows.length },
              ]}
            />
            <div className="mx-auto max-w-3xl space-y-3 p-4">
              {sp.saved && <Notice tone="success">Saved.</Notice>}
              {tab === "timeline" &&
                (days.length ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-ink-3">{timeline.length >= 200 ? "Latest 200 messages" : `${timeline.length} messages`}</span>
                      <Link href={`/inbox/${c.id}`} className="btn"><IconMessageCircle size={14} /> Open chat</Link>
                    </div>
                    {days.map((g) => (
                      <div key={g.day} className="card overflow-hidden">
                        <div className="border-b border-line-light bg-soft px-3 py-1.5 text-xs font-medium text-ink-3">{formatDay(g.items[0].createdAt)}</div>
                        <ul>
                          {g.items.map((m) => (
                            <li key={m.id} className="flex items-start gap-2 border-b border-line-light px-3 py-1.5 last:border-b-0">
                              <span
                                className={cn(
                                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                                  m.direction === "in" ? "bg-hover text-ink-2" : "bg-[#e3f5e8] text-[#2f9e44]",
                                )}
                                title={m.direction === "in" ? "Received" : "Sent"}
                              >
                                {m.direction === "in" ? <IconArrowDownLeft size={12} /> : <IconArrowUpRight size={12} />}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="line-clamp-3 text-sm whitespace-pre-wrap text-ink">
                                  {m.body || <span className="text-ink-3">[{m.type}]</span>}
                                </div>
                                {m.templateName && <div className="mt-0.5 text-xs text-ink-3">Template · {m.templateName}</div>}
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5 text-xs text-ink-3">
                                {m.direction === "out" && <StatusChip status={m.status} />}
                                <span className="tabular-nums">
                                  {new Date(m.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                                </span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </>
                ) : (
                  <Empty
                    icon={<IconTimeline />}
                    title="No messages yet"
                    action={<Link href={`/inbox/${c.id}`} className="btn btn-primary"><IconMessageCircle size={14} /> Open chat</Link>}
                  />
                ))}
              {tab === "notes" && <CrmNotes notes={noteRows} target={{ contactId: id }} />}
              {tab === "tasks" && (
                <CrmTasks tasks={taskRows} target={{ contactId: id, companyId: c.companyId ?? undefined }} users={opts.users} defaultAssignee={user.id} />
              )}
              {tab === "deals" && (
                <CrmDealList
                  deals={dealRows}
                  hide="contact"
                  action={
                    <Link
                      href={`/deals/new?contactId=${id}${c.companyId ? `&companyId=${c.companyId}` : ""}&return=${encodeURIComponent(`${base}?tab=deals`)}`}
                      className="btn btn-primary"
                    >
                      <IconPlus size={14} /> New deal
                    </Link>
                  }
                />
              )}
            </div>
          </>
        )}
      </RecordLayout>
    </Page>
  );
}
