import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { IconSpeakerphone, IconPlayerPause, IconPlayerPlay, IconRefresh, IconTrash } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { campaignRecipients, campaigns } from "@/db/schema";
import { Page, Stat, StatusChip, Notice } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { campaignStats, summarize } from "@/lib/campaign-runner";
import { formatPhone } from "@/lib/phone";
import { formatDateTime } from "@/lib/utils";
import { deleteCampaign, retryFailed, setCampaignStatus } from "../actions";

const STATUSES = ["pending", "sent", "delivered", "read", "failed", "skipped"] as const;

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const { id } = await params;
  const { status } = await searchParams;
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!c) notFound();
  const filter = STATUSES.find((s) => s === status);
  const [stats, recips] = await Promise.all([
    campaignStats([id]),
    db
      .select()
      .from(campaignRecipients)
      .where(filter ? and(eq(campaignRecipients.campaignId, id), eq(campaignRecipients.status, filter)) : eq(campaignRecipients.campaignId, id))
      .orderBy(desc(campaignRecipients.updatedAt))
      .limit(300),
  ]);
  const s = summarize(stats.get(id));
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  const active = c.status === "running" || c.status === "scheduled";

  return (
    <Page
      title={c.name}
      icon={<IconSpeakerphone />}
      crumbs={[{ href: "/campaigns", label: "Campaigns" }]}
      actions={
        <>
          {active && <form action={setCampaignStatus.bind(null, id, "paused")}><button className="btn"><IconPlayerPause size={14} /> Pause</button></form>}
          {c.status === "paused" && <form action={setCampaignStatus.bind(null, id, "running")}><button className="btn btn-primary"><IconPlayerPlay size={14} /> Resume</button></form>}
          {s.failed > 0 && !active && <form action={retryFailed.bind(null, id)}><button className="btn"><IconRefresh size={14} /> Retry failed</button></form>}
          {!active && <form action={deleteCampaign.bind(null, id)}><button className="btn btn-danger"><IconTrash size={14} /> Delete</button></form>}
        </>
      }
    >
      {active && <AutoRefresh seconds={5} />}
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-ink-2">
          <span className="flex items-center gap-1.5">Status <StatusChip status={c.status} /></span>
          <span>Template <b className="font-medium text-ink">{c.templateName}</b></span>
          <span>{c.audience}</span>
          <span>Scheduled {formatDateTime(c.scheduledAt)}</span>
          {c.completedAt && <span>Completed {formatDateTime(c.completedAt)}</span>}
        </div>
        {c.lastError && <Notice tone="error">{c.lastError}</Notice>}
        {c.status === "scheduled" && c.scheduledAt.getTime() > Date.now() && <Notice tone="info">Will start automatically at {formatDateTime(c.scheduledAt)}.</Notice>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <Stat label="Recipients" value={c.total} sub={c.skipped ? `${c.skipped} opted out skipped` : undefined} />
          <Stat label="Pending" value={s.pending} />
          <Stat label="Sent" value={s.sent} sub={pct(s.sent, c.total)} />
          <Stat label="Delivered" value={s.delivered} sub={pct(s.delivered, s.sent)} />
          <Stat label="Read" value={s.read} sub={pct(s.read, s.sent)} />
          <Stat label="Failed" value={s.failed} sub={pct(s.failed, c.total)} />
        </div>
        <div className="card overflow-hidden">
          <div className="flex flex-wrap gap-1 border-b border-line px-2 py-1.5">
            <Link href={`/campaigns/${id}`} className={!filter ? "btn border-accent text-accent" : "btn btn-ghost"}>All</Link>
            {STATUSES.map((st) => (
              <Link key={st} href={`/campaigns/${id}?status=${st}`} className={filter === st ? "btn border-accent text-accent" : "btn btn-ghost"}>
                {st[0].toUpperCase() + st.slice(1)}
              </Link>
            ))}
          </div>
          <table className="table-grid w-full table-fixed">
            <thead><tr><th className="w-48">Name</th><th className="w-40">Phone</th><th className="w-28">Status</th><th className="w-44">Sent at</th><th>Error</th></tr></thead>
            <tbody>
              {recips.map((r) => (
                <tr key={r.id}>
                  <td className="truncate">{r.contactId ? <Link href={`/inbox/${r.contactId}`} className="hover:text-accent">{r.name || "—"}</Link> : r.name || "—"}</td>
                  <td className="text-ink-2">{formatPhone(r.phone)}</td>
                  <td><StatusChip status={r.status} /></td>
                  <td className="text-ink-2">{r.sentAt ? formatDateTime(r.sentAt) : "—"}</td>
                  <td className="truncate text-danger" title={r.error}>{r.error}</td>
                </tr>
              ))}
              {!recips.length && <tr><td colSpan={5} className="text-center text-ink-3">Nothing here</td></tr>}
            </tbody>
          </table>
          {recips.length === 300 && <div className="px-3 py-2 text-xs text-ink-3">Showing the latest 300 rows.</div>}
        </div>
      </div>
    </Page>
  );
}
