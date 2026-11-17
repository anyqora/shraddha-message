import Link from "next/link";
import { desc } from "drizzle-orm";
import { IconSpeakerphone, IconPlus } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { campaigns } from "@/db/schema";
import { Page, Empty, StatusChip } from "@/components/ui";
import { campaignStats, summarize } from "@/lib/campaign-runner";
import { formatDateTime } from "@/lib/utils";

export default async function CampaignsPage() {
  const rows = await db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(200);
  const stats = await campaignStats(rows.map((r) => r.id));
  return (
    <Page title="Campaigns" icon={<IconSpeakerphone />} noPad actions={<Link href="/campaigns/new" className="btn btn-primary"><IconPlus size={14} /> New campaign</Link>}>
      {rows.length ? (
        <table className="table-grid w-full">
          <thead>
            <tr><th>Name</th><th>Status</th><th>Template</th><th>Audience</th><th>Scheduled</th><th>Recipients</th><th>Sent</th><th>Delivered</th><th>Read</th><th>Failed</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = summarize(stats.get(r.id));
              return (
                <tr key={r.id}>
                  <td><Link href={`/campaigns/${r.id}`} className="font-medium hover:text-accent">{r.name}</Link></td>
                  <td><StatusChip status={r.status} /></td>
                  <td className="text-ink-2">{r.templateName}</td>
                  <td className="max-w-48 truncate text-ink-2">{r.audience}</td>
                  <td className="text-ink-2">{formatDateTime(r.scheduledAt)}</td>
                  <td>{r.total}</td><td>{s.sent}</td><td>{s.delivered}</td><td>{s.read}</td>
                  <td className={s.failed ? "text-danger" : ""}>{s.failed}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <Empty icon={<IconSpeakerphone />} title="No campaigns yet" hint="Send an approved template to a list or an uploaded file." action={<Link href="/campaigns/new" className="btn btn-primary">New campaign</Link>} />
      )}
    </Page>
  );
}
