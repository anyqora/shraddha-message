import Link from "next/link";
import { and, asc, desc, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import {
  IconLayoutDashboard,
  IconAlertTriangle,
  IconArrowUpRight,
  IconArrowDownRight,
  IconSpeakerphone,
  IconUpload,
  IconTemplate,
  IconMessageCircle,
  IconPlus,
} from "@tabler/icons-react";
import { db } from "@/lib/db";
import { campaigns, contacts, messages } from "@/db/schema";
import { Page, StatusChip, Notice, Avatar } from "@/components/ui";
import { ActivityChart, type DayPoint } from "@/components/activity-chart";
import { getSettings } from "@/lib/settings";
import { requireUser } from "@/lib/auth";
import { campaignStats, summarize } from "@/lib/campaign-runner";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import { loadDashboardExtras } from "@/lib/dashboard-extra";
import { SetupChecklist, ShareBar, BusyHeatmap } from "@/components/dashboard-cards";
import { IconChecklist, IconTargetArrow, IconRobot, IconFlame, IconSun } from "@tabler/icons-react";

const DAYS = 14;
const IST = sql`interval 330 minute`;

function Kpi({ label, value, prev, sub, href }: { label: string; value: number | string; prev?: number; sub?: React.ReactNode; href?: string }) {
  const n = typeof value === "number" ? value : NaN;
  const delta = prev !== undefined && !Number.isNaN(n) ? (prev === 0 ? (n > 0 ? 100 : 0) : Math.round(((n - prev) / prev) * 100)) : null;
  const body = (
    <div className="card h-full p-3 transition-colors hover:bg-soft">
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight text-ink">{typeof value === "number" ? value.toLocaleString("en-IN") : value}</span>
        {delta !== null && delta !== 0 && (
          <span className={`flex items-center text-xs font-medium ${delta > 0 ? "text-success" : "text-danger"}`}>
            {delta > 0 ? <IconArrowUpRight size={13} /> : <IconArrowDownRight size={13} />}
            {Math.abs(delta)}%
          </span>
        )}
      </div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function Funnel({ sent, delivered, read, failed }: { sent: number; delivered: number; read: number; failed: number }) {
  const rows = [
    { label: "Sent", v: sent, color: "#2a78d6" },
    { label: "Delivered", v: delivered, color: "#1baf7a" },
    { label: "Read", v: read, color: "#6250d6" },
    { label: "Failed", v: failed, color: "#e34948" },
  ];
  const base = Math.max(1, sent + failed);
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-ink-2">{r.label}</span>
            <span className="text-ink">
              <b className="font-semibold">{r.v.toLocaleString("en-IN")}</b>
              <span className="ml-1 text-ink-3">{Math.round((r.v / base) * 100)}%</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#f1f1f1]">
            <div className="h-full rounded-full" style={{ width: `${(r.v / base) * 100}%`, background: r.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function Dashboard() {
  const user = await requireUser();
  const now = Date.now();
  const d7 = new Date(now - 7 * 864e5);
  const d14 = new Date(now - 14 * 864e5);
  const since = new Date(now - DAYS * 864e5);

  const [[c], [win], daily, statusRows, recentChats, upcoming, recent, s] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`,
        new7: sql<number>`coalesce(sum(${contacts.createdAt} >= ${d7}),0)`,
        newPrev: sql<number>`coalesce(sum(${contacts.createdAt} >= ${d14} and ${contacts.createdAt} < ${d7}),0)`,
        optedOut: sql<number>`coalesce(sum(${contacts.optedOut}),0)`,
        unread: sql<number>`coalesce(sum(${contacts.unreadCount}),0)`,
      })
      .from(contacts),
    db
      .select({ open: sql<number>`count(*)` })
      .from(contacts)
      .where(gte(contacts.lastInboundAt, new Date(now - 864e5))),
    db
      .select({
        day: sql<string>`date_format(${messages.createdAt} + ${IST}, '%Y-%m-%d')`,
        direction: messages.direction,
        n: sql<number>`count(*)`,
      })
      .from(messages)
      .where(gte(messages.createdAt, since))
      .groupBy(sql`1`, messages.direction),
    db
      .select({
        period: sql<string>`if(${messages.createdAt} >= ${d7}, 'cur', 'prev')`,
        direction: messages.direction,
        status: messages.status,
        n: sql<number>`count(*)`,
      })
      .from(messages)
      .where(gte(messages.createdAt, d14))
      .groupBy(sql`1`, messages.direction, messages.status),
    db.select().from(contacts).where(isNotNull(contacts.lastMessageAt)).orderBy(desc(contacts.lastMessageAt)).limit(6),
    db
      .select()
      .from(campaigns)
      .where(and(inArray(campaigns.status, ["scheduled", "running", "paused"]), lt(campaigns.scheduledAt, new Date(now + 30 * 864e5))))
      .orderBy(asc(campaigns.scheduledAt))
      .limit(5),
    db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(5),
    getSettings(),
  ]);

  // daily series (IST days)
  const byDay = new Map<string, DayPoint>();
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(now - i * 864e5 + 330 * 60e3);
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, { day: key, label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }), sent: 0, received: 0 });
  }
  for (const r of daily) {
    const p = byDay.get(r.day);
    if (p) p[r.direction === "in" ? "received" : "sent"] += Number(r.n);
  }

  const agg = { cur: {} as Record<string, number>, prev: {} as Record<string, number>, inCur: 0, inPrev: 0 };
  for (const r of statusRows) {
    const p = r.period as "cur" | "prev";
    if (r.direction === "in") p === "cur" ? (agg.inCur += Number(r.n)) : (agg.inPrev += Number(r.n));
    else agg[p][r.status] = (agg[p][r.status] ?? 0) + Number(r.n);
  }
  const cur = summarize(agg.cur);
  const prev = summarize(agg.prev);
  const [stats, x] = await Promise.all([campaignStats(recent.map((r) => r.id)), loadDashboardExtras(s, user.id)]);
  const inr = (v: number) => `₹${v.toLocaleString("en-IN")}`;
  const hour = Number(new Date(now + 330 * 60e3).toISOString().slice(11, 13));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const connected = Boolean(s.waAccessToken && s.waPhoneNumberId);

  return (
    <Page title="Dashboard" icon={<IconLayoutDashboard />}>
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{greet}{user.name ? `, ${user.name.split(" ")[0]}` : ""} 👋</h2>
            <p className="text-sm text-ink-3">
              {connected ? <>WhatsApp connected{s.waDisplayPhone && <> · {s.waDisplayPhone}</>} · last 7 days compared with the 7 days before</> : "Connect WhatsApp to start messaging"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/campaigns/new" className="btn btn-primary"><IconSpeakerphone size={14} /> New campaign</Link>
            <Link href="/contacts/import" className="btn"><IconUpload size={14} /> Import contacts</Link>
            <Link href="/templates/new" className="btn"><IconTemplate size={14} /> New template</Link>
          </div>
        </div>

        <SetupChecklist steps={x.setup} />

        {!connected && (
          <Notice tone="warn">
            <span className="inline-flex items-center gap-1.5">
              <IconAlertTriangle size={15} /> WhatsApp is not connected yet. <Link href="/settings" className="font-medium underline">Open Settings</Link>
            </span>
          </Notice>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Messages sent · 7d" value={cur.sent} prev={prev.sent} sub={`${cur.failed} failed`} />
          <Kpi label="Messages received · 7d" value={agg.inCur} prev={agg.inPrev} sub={`${Number(c.unread)} unread`} href="/inbox" />
          <Kpi label="New contacts · 7d" value={Number(c.new7)} prev={Number(c.newPrev)} sub={`${Number(c.total).toLocaleString("en-IN")} total · ${Number(c.optedOut)} opted out`} href="/contacts" />
          <Kpi label="Open chats (24h window)" value={Number(win.open)} sub="Free-form replies allowed" href="/inbox" />
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
          <div className="card p-4">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="font-medium">Message activity</h3>
              <span className="text-xs text-ink-3">Last {DAYS} days</span>
            </div>
            <ActivityChart data={[...byDay.values()]} />
          </div>
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-medium">Delivery · 7d</h3>
              <span className="text-xs text-ink-3">outgoing</span>
            </div>
            <Funnel sent={cur.sent} delivered={cur.delivered} read={cur.read} failed={cur.failed} />
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3 text-center">
              <div>
                <div className="text-lg font-semibold">{cur.sent ? Math.round((cur.delivered / cur.sent) * 100) : 0}%</div>
                <div className="text-xs text-ink-3">Delivery rate</div>
              </div>
              <div>
                <div className="text-lg font-semibold">{cur.sent ? Math.round((cur.read / cur.sent) * 100) : 0}%</div>
                <div className="text-xs text-ink-3">Read rate</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 font-medium"><IconSun size={15} className="text-ink-3" /> Today</h3>
              <Link href="/tasks" className="text-xs text-accent">All tasks</Link>
            </div>
            <div className="mb-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md bg-soft py-2"><div className="text-lg font-semibold">{x.today.inbound}</div><div className="text-[11px] text-ink-3">Received</div></div>
              <div className="rounded-md bg-soft py-2"><div className="text-lg font-semibold">{x.today.outbound}</div><div className="text-[11px] text-ink-3">Sent</div></div>
              <div className="rounded-md bg-soft py-2"><div className="text-lg font-semibold">{x.today.newContacts}</div><div className="text-[11px] text-ink-3">New contacts</div></div>
            </div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-3"><IconChecklist size={13} /> Tasks due</div>
            <ul className="space-y-1">
              {x.dueTasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm">
                  <span className={`size-1.5 shrink-0 rounded-full ${t.overdue ? "bg-danger" : "bg-[#eda100]"}`} />
                  <span className="flex-1 truncate">{t.title}</span>
                  {t.contactId && <Link href={`/contacts/${t.contactId}`} className="max-w-24 truncate text-xs text-ink-3 hover:text-accent">{t.contactName || formatPhone(t.contactPhone)}</Link>}
                  <span className={`text-[11px] ${t.overdue ? "text-danger" : "text-ink-3"}`}>{t.overdue ? "Overdue" : "Today"}</span>
                </li>
              ))}
              {!x.dueTasks.length && <li className="text-sm text-ink-3">Nothing due — nice work 🎉</li>}
            </ul>
          </div>
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 font-medium"><IconTargetArrow size={15} className="text-ink-3" /> Sales pipeline</h3>
              <Link href="/deals" className="text-xs text-accent">Open deals</Link>
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-ink-3">Open pipeline · {x.pipeline.openCount} deals</div>
                <div className="text-2xl font-semibold tracking-tight">{inr(x.pipeline.openValue)}</div>
              </div>
              <div className="border-t border-line pt-3">
                <div className="text-xs text-ink-3">Won this month</div>
                <div className="text-xl font-semibold text-success">{inr(x.pipeline.wonMonth)}</div>
              </div>
              <Link href="/deals/new" className="btn w-full justify-center"><IconPlus size={14} /> New deal</Link>
            </div>
          </div>
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 font-medium"><IconRobot size={15} className="text-ink-3" /> Who replied · 7d</h3>
              <Link href="/chatbot" className="text-xs text-accent">Chatbot</Link>
            </div>
            <ShareBar rows={x.share} />
          </div>
        </div>

        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 font-medium"><IconFlame size={15} className="text-ink-3" /> When customers message you</h3>
            <span className="text-xs text-ink-3">Last 30 days · IST</span>
          </div>
          <BusyHeatmap grid={x.heat} />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="flex items-center gap-1.5 font-medium"><IconMessageCircle size={15} className="text-ink-3" /> Recent conversations</span>
              <Link href="/inbox" className="text-sm text-accent">Open inbox</Link>
            </div>
            <ul className="divide-y divide-line-light">
              {recentChats.map((r) => (
                <li key={r.id}>
                  <Link href={`/inbox/${r.id}`} className="flex items-center gap-2.5 px-3 py-2 hover:bg-soft">
                    <Avatar name={r.name || r.phone} seed={r.id} size={26} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className={`flex-1 truncate ${r.unreadCount ? "font-semibold" : "font-medium"}`}>{r.name || formatPhone(r.phone)}</span>
                        <span className="text-[11px] text-ink-3">{timeAgo(r.lastMessageAt)}</span>
                      </div>
                      <div className="truncate text-xs text-ink-3">{r.lastMessagePreview}</div>
                    </div>
                    {r.unreadCount > 0 && <span className="rounded-full bg-[#25d366] px-1.5 text-[11px] font-semibold leading-4 text-white">{r.unreadCount}</span>}
                  </Link>
                </li>
              ))}
              {!recentChats.length && <li className="px-3 py-6 text-center text-sm text-ink-3">No conversations yet</li>}
            </ul>
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="flex items-center gap-1.5 font-medium"><IconSpeakerphone size={15} className="text-ink-3" /> Campaigns</span>
              <Link href="/campaigns/new" className="flex items-center gap-1 text-sm text-accent"><IconPlus size={13} /> New</Link>
            </div>
            {upcoming.length > 0 && (
              <div className="border-b border-line bg-soft px-3 py-2">
                <div className="mb-1 text-xs font-medium text-ink-3">Upcoming & active</div>
                {upcoming.map((u) => (
                  <Link key={u.id} href={`/campaigns/${u.id}`} className="flex items-center gap-2 py-1 text-sm hover:text-accent">
                    <StatusChip status={u.status} />
                    <span className="flex-1 truncate">{u.name}</span>
                    <span className="text-xs text-ink-3">{formatDateTime(u.scheduledAt)}</span>
                  </Link>
                ))}
              </div>
            )}
            <table className="table-grid w-full">
              <thead><tr><th>Name</th><th>Status</th><th>Sent</th><th>Read</th><th>Failed</th></tr></thead>
              <tbody>
                {recent.map((r) => {
                  const x = summarize(stats.get(r.id));
                  return (
                    <tr key={r.id}>
                      <td className="max-w-40 truncate"><Link href={`/campaigns/${r.id}`} className="font-medium hover:text-accent">{r.name}</Link></td>
                      <td><StatusChip status={r.status} /></td>
                      <td>{x.sent}</td>
                      <td>{x.sent ? `${Math.round((x.read / x.sent) * 100)}%` : "—"}</td>
                      <td className={x.failed ? "text-danger" : ""}>{x.failed}</td>
                    </tr>
                  );
                })}
                {!recent.length && <tr><td colSpan={5} className="text-center text-ink-3">No campaigns yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Page>
  );
}
