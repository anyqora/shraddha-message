import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { IconMessageCircle, IconUser, IconCheck, IconChecks, IconClock, IconAlertCircle } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { contacts, messages, quickReplies, templates, users } from "@/db/schema";
import { Page, Avatar, Chip } from "@/components/ui";
import { ConversationList } from "@/components/conversation-list";
import { AutoRefresh } from "@/components/auto-refresh";
import { Composer } from "@/components/composer";
import { WaBubble } from "@/components/wa-bubble";
import { ScrollToBottom } from "@/components/scroll-bottom";
import { markRead } from "@/lib/messaging";
import { formatPhone } from "@/lib/phone";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { InboxContactPanel } from "@/components/inbox-contact-panel";
import { InboxAssign, InboxBotToggle, InboxStatusButton } from "@/components/inbox-chat-actions";
import { assignChat, sendChatMessage, sendChatTemplate, setChatStatus, toggleBot } from "../actions";

function Tick({ status, error }: { status: string; error: string }) {
  if (status === "failed") return <span title={error} className="text-danger"><IconAlertCircle size={13} /></span>;
  if (status === "pending") return <IconClock size={12} />;
  if (status === "sent") return <IconCheck size={13} />;
  return <IconChecks size={13} className={status === "read" ? "text-[#53bdeb]" : ""} />;
}

function dayLabel(d: Date) {
  const s = d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
  const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
  return s === today ? "Today" : s;
}

export default async function ChatPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; filter?: string }> }) {
  const { id } = await params;
  const { q, filter } = await searchParams;
  const me = await requireUser();
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  if (!c) notFound();
  if (c.unreadCount) await markRead(id);
  const [msgs, tpls, team, qrs, settings] = await Promise.all([
    db.select().from(messages).where(eq(messages.contactId, id)).orderBy(desc(messages.createdAt)).limit(300),
    db.select().from(templates).where(eq(templates.status, "APPROVED")).orderBy(asc(templates.name)),
    db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(asc(users.name)),
    db.select({ id: quickReplies.id, shortcut: quickReplies.shortcut, body: quickReplies.body }).from(quickReplies).orderBy(asc(quickReplies.shortcut)),
    getSettings(),
  ]);
  const userById = new Map(team.map((u) => [u.id, u]));
  const assignee = c.assignedTo ? userById.get(c.assignedTo) : undefined;
  const firstName = (u: { name: string; email: string }) => (u.name.trim().split(/\s+/)[0] || u.email.split("@")[0]);
  msgs.reverse();
  const windowOpen = !!c.lastInboundAt && Date.now() - c.lastInboundAt.getTime() < 24 * 3600 * 1000;
  let lastDay = "";

  return (
    <Page title="Inbox" icon={<IconMessageCircle />} noPad>
      <AutoRefresh seconds={4} />
      <div className="flex h-full min-h-0">
        <ConversationList activeId={id} q={q} filter={filter} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
            <Avatar name={c.name || c.phone} seed={c.id} size={28} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate font-medium">{c.name || formatPhone(c.phone)}</div>
              <div className="text-xs text-ink-3">{formatPhone(c.phone)}</div>
            </div>
            {c.optedOut && <Chip color="red">Opted out</Chip>}
            {c.chatStatus === "closed" && <Chip color="gray">Closed</Chip>}
            <Chip color={windowOpen ? "green" : "gray"}>{windowOpen ? "24h window open" : "Template only"}</Chip>
            <InboxBotToggle botEnabled={settings.botEnabled} pausedUntil={c.botPausedUntil?.toISOString() ?? null} toggle={toggleBot.bind(null, id)} />
            <InboxAssign assignedTo={c.assignedTo} users={team} meId={me.id} assign={assignChat.bind(null, id)} />
            <InboxStatusButton status={c.chatStatus} setStatus={setChatStatus.bind(null, id)} />
            <Link href={`/contacts/${c.id}`} className="btn" title="Open contact"><IconUser size={14} /><span className="hidden 2xl:inline">Contact</span></Link>
          </div>
          <ScrollToBottom className="min-h-0 flex-1 space-y-1.5 overflow-auto bg-[#efeae2] px-6 py-4" depKey={msgs.length + (msgs.at(-1)?.status ?? "")}>
            {msgs.map((m) => {
              const day = dayLabel(m.createdAt);
              const showDay = day !== lastDay;
              lastDay = day;
              const time = m.createdAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
              const media = m.media?.id ? `/api/media/${m.media.id}` : null;
              return (
                <div key={m.id}>
                  {showDay && <div className="my-2 text-center"><span className="rounded-md bg-white/90 px-2 py-0.5 text-[11px] text-[#54656f] shadow-sm">{day}</span></div>}
                  <WaBubble out={m.direction === "out"} body={m.body} meta={<>{m.direction === "out" && m.sentBy === "bot" && <span className="rounded bg-[#f1ebff] px-1 font-medium text-[#7048e8]">🤖 Bot</span>}{m.direction === "out" && m.sentBy && m.sentBy !== "bot" && userById.has(m.sentBy) && <span className="font-medium">{firstName(userById.get(m.sentBy)!)}</span>}{m.templateName && <span>template</span>}<span>{time}</span>{m.direction === "out" && <Tick status={m.status} error={m.error} />}</>}>
                    {media && (m.type === "image" || m.type === "sticker") && (
                      <a href={media} target="_blank" rel="noreferrer"><img src={media} alt="" className="mb-1 max-h-72 rounded-md" /></a>
                    )}
                    {media && m.type === "video" && <video src={media} controls className="mb-1 max-h-72 rounded-md" />}
                    {media && m.type === "audio" && <audio src={media} controls className="mb-1" />}
                    {media && m.type === "document" && (
                      <a href={media} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-2 rounded-md bg-black/5 px-2 py-1.5 text-[#027eb5]">📎 {m.media?.filename || "Document"}</a>
                    )}
                    {m.status === "failed" && m.error && <div className="mb-1 text-xs text-danger">Not sent: {m.error}</div>}
                  </WaBubble>
                </div>
              );
            })}
            {!msgs.length && <div className="pt-10 text-center text-sm text-[#54656f]">No messages yet. Start with a template.</div>}
          </ScrollToBottom>
          <Composer
            key={id}
            windowOpen={windowOpen}
            templates={tpls.map((t) => ({ id: t.id, name: t.name, language: t.language, components: t.components }))}
            contactName={c.name}
            sendText={sendChatMessage.bind(null, id)}
            sendTemplate={sendChatTemplate.bind(null, id)}
            quickReplies={qrs}
          />
        </div>
        <InboxContactPanel contact={c} assignee={assignee} />
      </div>
    </Page>
  );
}
