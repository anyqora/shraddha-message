import Link from "next/link";
import { desc, gte, sql } from "drizzle-orm";
import { IconLayoutDashboard, IconAlertTriangle } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { campaigns, contacts, messages } from "@/db/schema";
import { Page, Stat, StatusChip, Notice } from "@/components/ui";
import { getSettings } from "@/lib/settings";
import { campaignStats, summarize } from "@/lib/campaign-runner";
import { formatDateTime } from "@/lib/utils";

export default async function Dashboard() {
  const since = new Date(Date.now() - 30 * 864e5);
  const [[c], msgRows, recent, s] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`,
        optedOut: sql<number>`coalesce(sum(${contacts.optedOut}),0)`,
        unread: sql<number>`coalesce(sum(${contacts.unreadCount}),0)`,
      })
      .from(contacts),
    db
      .select({ direction: messages.direction, status: messages.status, n: sql<number>`count(*)` })
      .from(messages)
      .where(gte(messages.createdAt, since))
      .groupBy(messages.direction, messages.status),
    db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(6),
    getSettings(),
  ]);
  const out: Record<string, number> = {};
  let inbound = 0;
  for (const r of msgRows) {
    if (r.direction === "in") inbound += Number(r.n);
    else out[r.status] = (out[r.status] ?? 0) + Number(r.n);
  }
  const o = summarize(out);
  const stats = await campaignStats(recent.map((r) => r.id));
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  return (
    <Page title="Dashboard" icon={<IconLayoutDashboard />}>
      <div className="mx-auto max-w-5xl space-y-5">
        {!(s.waAccessToken && s.waPhoneNumberId) && (
          <Notice tone="warn">
            <span className="inline-flex items-center gap-1.5">
              <IconAlertTriangle size={15} /> WhatsApp is not connected yet.{" "}
              <Link href="/settings" className="font-medium underline">
                Open Settings
              </Link>
            </span>
          </Notice>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Contacts" value={Number(c.total).toLocaleString("en-IN")} sub={`${Number(c.optedOut)} opted out`} />
          <Stat label="Unread chats" value={Number(c.unread)} sub={<Link href="/inbox" className="text-accent">Open inbox →</Link>} />
          <Stat label="Sent (30 days)" value={o.sent.toLocaleString("en-IN")} sub={`${o.failed} failed`} />
          <Stat label="Received (30 days)" value={inbound.toLocaleString("en-IN")} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Delivered" value={pct(o.delivered, o.sent)} sub={`${o.delivered} of ${o.sent}`} />
          <Stat label="Read" value={pct(o.read, o.sent)} sub={`${o.read} of ${o.sent}`} />
          <Stat label="Failed" value={pct(o.failed, o.sent + o.failed)} sub={`${o.failed} messages`} />
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-medium">Recent campaigns</span>
            <Link href="/campaigns" className="text-sm text-accent">View all</Link>
          </div>
          <table className="table-grid w-full">
            <thead>
              <tr>
                <th>Name</th><th>Status</th><th>Scheduled</th><th>Sent</th><th>Delivered</th><th>Read</th><th>Failed</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => {
                const x = summarize(stats.get(r.id));
                return (
                  <tr key={r.id}>
                    <td><Link href={`/campaigns/${r.id}`} className="font-medium hover:text-accent">{r.name}</Link></td>
                    <td><StatusChip status={r.status} /></td>
                    <td className="text-ink-2">{formatDateTime(r.scheduledAt)}</td>
                    <td>{x.sent}</td><td>{x.delivered}</td><td>{x.read}</td><td>{x.failed}</td>
                  </tr>
                );
              })}
              {!recent.length && (
                <tr><td colSpan={7} className="text-center text-ink-3">No campaigns yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  );
}
