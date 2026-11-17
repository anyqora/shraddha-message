import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { IconUser, IconMessageCircle } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { contacts, listMembers, lists, messages } from "@/db/schema";
import { Page, Notice, Avatar, Chip, StatusChip } from "@/components/ui";
import { ContactForm } from "@/components/contact-form";
import { saveContact, setOptOut } from "../actions";
import { formatPhone } from "@/lib/phone";
import { formatDateTime } from "@/lib/utils";

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  if (!c) notFound();
  const [all, mem, recent] = await Promise.all([
    db.select().from(lists).orderBy(asc(lists.name)),
    db.select({ listId: listMembers.listId }).from(listMembers).where(eq(listMembers.contactId, id)),
    db.select().from(messages).where(eq(messages.contactId, id)).orderBy(desc(messages.createdAt)).limit(8),
  ]);
  const toggle = setOptOut.bind(null, c.id, !c.optedOut);

  return (
    <Page
      title={c.name || formatPhone(c.phone)}
      icon={<IconUser />}
      crumbs={[{ href: "/contacts", label: "Contacts" }]}
      actions={<Link href={`/inbox/${c.id}`} className="btn btn-primary"><IconMessageCircle size={14} /> Open chat</Link>}
    >
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {sp.saved && <Notice tone="success">Saved.</Notice>}
          {sp.error === "phone" && <Notice tone="error">Enter a valid phone number with country code.</Notice>}
          {sp.error === "duplicate" && <Notice tone="error">Another contact already uses this phone number.</Notice>}
          <div className="card p-4">
            <ContactForm contact={c} lists={all} memberOf={mem.map((m) => m.listId)} action={saveContact} />
          </div>
        </div>
        <div className="space-y-4">
          <div className="card space-y-3 p-4">
            <div className="flex items-center gap-2">
              <Avatar name={c.name || c.phone} seed={c.id} size={32} />
              <div>
                <div className="font-medium">{c.name || "Unnamed"}</div>
                <div className="text-ink-3">{formatPhone(c.phone)}</div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-line pt-3">
              <div>
                <div className="font-medium">Broadcasts</div>
                <div className="text-xs text-ink-3">
                  {c.optedOut ? `Opted out ${formatDateTime(c.optedOutAt)}` : "Subscribed to campaigns"}
                </div>
              </div>
              <form action={toggle}>
                <button className={c.optedOut ? "btn" : "btn btn-danger"}>{c.optedOut ? "Re-subscribe" : "Opt out"}</button>
              </form>
            </div>
          </div>
          <div className="card">
            <div className="border-b border-line px-3 py-2 font-medium">Recent messages</div>
            <ul className="divide-y divide-line-light">
              {recent.map((m) => (
                <li key={m.id} className="space-y-1 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs text-ink-3">
                    <Chip color={m.direction === "in" ? "gray" : "blue"}>{m.direction === "in" ? "Received" : "Sent"}</Chip>
                    {m.direction === "out" && <StatusChip status={m.status} />}
                    <span className="ml-auto">{formatDateTime(m.createdAt)}</span>
                  </div>
                  <div className="line-clamp-2 text-sm whitespace-pre-wrap">{m.body || `[${m.type}]`}</div>
                </li>
              ))}
              {!recent.length && <li className="px-3 py-4 text-center text-ink-3">No messages yet</li>}
            </ul>
          </div>
        </div>
      </div>
    </Page>
  );
}
