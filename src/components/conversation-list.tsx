import Link from "next/link";
import { and, desc, eq, gt, isNotNull, isNull, like, or, sql, type SQL } from "drizzle-orm";
import { IconSearch, IconBolt } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { contacts, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { inboxRestricted } from "@/lib/permissions";
import { Avatar } from "./ui";
import { formatPhone } from "@/lib/phone";
import { cn, timeAgo } from "@/lib/utils";

export const INBOX_FILTERS = ["all", "unread", "mine", "unassigned", "closed"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];
const LABELS: Record<InboxFilter, string> = { all: "All", unread: "Unread", mine: "Mine", unassigned: "Unassigned", closed: "Closed" };

export function parseFilter(f?: string): InboxFilter {
  return (INBOX_FILTERS as readonly string[]).includes(f ?? "") ? (f as InboxFilter) : "all";
}

/** Query string that keeps the inbox filter + search when navigating. */
export function inboxQuery(filter: InboxFilter, q?: string) {
  const p = new URLSearchParams();
  if (filter !== "all") p.set("filter", filter);
  if (q?.trim()) p.set("q", q.trim());
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function ConversationList({ activeId, q, filter: rawFilter }: { activeId?: string; q?: string; filter?: string }) {
  const me = await requireUser();
  const filter = parseFilter(rawFilter);
  const search = q?.trim();

  const isOpen = eq(contacts.chatStatus, "open");
  const filterCond: Record<InboxFilter, SQL | undefined> = {
    all: isOpen,
    unread: and(isOpen, gt(contacts.unreadCount, 0)),
    mine: and(isOpen, eq(contacts.assignedTo, me.id)),
    unassigned: and(isOpen, isNull(contacts.assignedTo)),
    closed: eq(contacts.chatStatus, "closed"),
  };
  const searchCond = search
    ? or(like(contacts.name, `%${search}%`), like(contacts.phone, `%${search.replace(/\D/g, "") || search}%`))
    : undefined;
  // restricted users only see chats assigned to them or unassigned
  const scopeCond = (await inboxRestricted(me)) ? or(eq(contacts.assignedTo, me.id), isNull(contacts.assignedTo)) : undefined;
  const base = and(isNotNull(contacts.lastMessageAt), searchCond, scopeCond);

  const [rows, [counts], team, settings] = await Promise.all([
    db
      .select()
      .from(contacts)
      .where(and(base, filterCond[filter]))
      .orderBy(desc(contacts.lastMessageAt))
      .limit(200),
    db
      .select({
        all: sql<number>`coalesce(sum(case when ${contacts.chatStatus} = 'open' then 1 else 0 end), 0)`,
        unread: sql<number>`coalesce(sum(case when ${contacts.chatStatus} = 'open' and ${contacts.unreadCount} > 0 then 1 else 0 end), 0)`,
        mine: sql<number>`coalesce(sum(case when ${contacts.chatStatus} = 'open' and ${contacts.assignedTo} = ${me.id} then 1 else 0 end), 0)`,
        unassigned: sql<number>`coalesce(sum(case when ${contacts.chatStatus} = 'open' and ${contacts.assignedTo} is null then 1 else 0 end), 0)`,
        closed: sql<number>`coalesce(sum(case when ${contacts.chatStatus} = 'closed' then 1 else 0 end), 0)`,
      })
      .from(contacts)
      .where(base),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users),
    getSettings(),
  ]);
  const userById = new Map(team.map((u) => [u.id, u]));
  const now = Date.now();

  return (
    <div className="flex h-full w-[310px] shrink-0 flex-col border-r border-line">
      <div className="space-y-2 border-b border-line p-2">
        <form className="flex items-center gap-1.5" action="/inbox">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <div className="relative flex-1">
            <IconSearch size={14} className="absolute top-2 left-2 text-ink-3" />
            <input name="q" defaultValue={q} placeholder="Search chats" className="input h-7 pl-7" />
          </div>
          <Link href="/inbox/quick-replies" title="Quick replies" className="btn btn-ghost h-7 px-1.5">
            <IconBolt size={14} />
          </Link>
        </form>
        <nav className="flex gap-0.5 overflow-x-auto rounded-md bg-soft p-0.5 text-xs">
          {INBOX_FILTERS.map((f) => {
            const n = Number(counts?.[f] ?? 0);
            return (
              <Link
                key={f}
                href={`/inbox${inboxQuery(f, q)}`}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded px-1.5 py-1 whitespace-nowrap",
                  filter === f ? "bg-panel font-medium text-ink shadow-sm" : "text-ink-3 hover:bg-hover hover:text-ink-2",
                )}
              >
                {LABELS[f]}
                {n > 0 && f !== "closed" && <span className="text-[10px] text-ink-3 tabular-nums">{n}</span>}
              </Link>
            );
          })}
        </nav>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {rows.map((c) => {
          const assignee = c.assignedTo ? userById.get(c.assignedTo) : undefined;
          const botActive = settings.botEnabled && !c.optedOut && (!c.botPausedUntil || c.botPausedUntil.getTime() <= now);
          const unread = c.unreadCount > 0;
          return (
            <li key={c.id}>
              <Link
                href={`/inbox/${c.id}${inboxQuery(filter, q)}`}
                className={cn("flex gap-2 border-b border-line-light px-3 py-2.5 hover:bg-soft", activeId === c.id && "bg-accent-soft/60 hover:bg-accent-soft/60")}
              >
                <Avatar name={c.name || c.phone} seed={c.id} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className={cn("flex-1 truncate", unread ? "font-semibold text-ink" : "font-medium")}>{c.name || formatPhone(c.phone)}</span>
                    <span className={cn("shrink-0 text-[11px]", unread ? "font-medium text-[#1fa855]" : "text-ink-3")}>{timeAgo(c.lastMessageAt)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("flex-1 truncate text-xs", unread ? "font-medium text-ink-2" : "text-ink-3")}>{c.lastMessagePreview}</span>
                    {botActive && <span title="Bot active" className="shrink-0 text-[11px] leading-none">🤖</span>}
                    {assignee && (
                      <span title={`Assigned to ${assignee.name || assignee.email}`} className="inline-flex shrink-0">
                        <Avatar name={assignee.name || assignee.email} seed={assignee.id} size={16} />
                      </span>
                    )}
                    {unread && <span className="rounded-full bg-[#25d366] px-1.5 text-[11px] font-semibold leading-4 text-white">{c.unreadCount}</span>}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
        {!rows.length && (
          <li className="p-6 text-center text-sm text-ink-3">
            {search || filter !== "all" ? "No chats match this view." : "No conversations yet. Messages people send to your WhatsApp number show up here."}
          </li>
        )}
      </ul>
    </div>
  );
}
