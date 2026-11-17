import Link from "next/link";
import { desc, isNotNull, like, or, and } from "drizzle-orm";
import { IconSearch } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { contacts } from "@/db/schema";
import { Avatar } from "./ui";
import { formatPhone } from "@/lib/phone";
import { cn, timeAgo } from "@/lib/utils";

export async function ConversationList({ activeId, q }: { activeId?: string; q?: string }) {
  const search = q?.trim();
  const rows = await db
    .select()
    .from(contacts)
    .where(
      search
        ? and(isNotNull(contacts.lastMessageAt), or(like(contacts.name, `%${search}%`), like(contacts.phone, `%${search.replace(/\D/g, "") || search}%`)))
        : isNotNull(contacts.lastMessageAt),
    )
    .orderBy(desc(contacts.lastMessageAt))
    .limit(200);
  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col border-r border-line">
      <form className="border-b border-line p-2" action="/inbox">
        <div className="relative">
          <IconSearch size={14} className="absolute top-2 left-2 text-ink-3" />
          <input name="q" defaultValue={q} placeholder="Search chats" className="input h-7 pl-7" />
        </div>
      </form>
      <ul className="min-h-0 flex-1 overflow-auto">
        {rows.map((c) => (
          <li key={c.id}>
            <Link
              href={`/inbox/${c.id}`}
              className={cn("flex gap-2 border-b border-line-light px-3 py-2.5 hover:bg-soft", activeId === c.id && "bg-accent-soft/60 hover:bg-accent-soft/60")}
            >
              <Avatar name={c.name || c.phone} seed={c.id} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={cn("flex-1 truncate", c.unreadCount ? "font-semibold" : "font-medium")}>{c.name || formatPhone(c.phone)}</span>
                  <span className="shrink-0 text-[11px] text-ink-3">{timeAgo(c.lastMessageAt)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-xs text-ink-3">{c.lastMessagePreview}</span>
                  {c.unreadCount > 0 && <span className="rounded-full bg-[#25d366] px-1.5 text-[11px] font-semibold leading-4 text-white">{c.unreadCount}</span>}
                </div>
              </div>
            </Link>
          </li>
        ))}
        {!rows.length && <li className="p-6 text-center text-sm text-ink-3">No conversations yet. Messages people send to your WhatsApp number show up here.</li>}
      </ul>
    </div>
  );
}
