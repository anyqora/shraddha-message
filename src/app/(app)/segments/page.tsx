import Link from "next/link";
import { desc } from "drizzle-orm";
import { IconFilter, IconPlus } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { segments } from "@/db/schema";
import { countSegment } from "@/lib/segments";
import { Page, Empty, Chip } from "@/components/ui";
import { timeAgo } from "@/lib/utils";

export default async function SegmentsPage() {
  const rows = await db.select().from(segments).orderBy(desc(segments.updatedAt));
  const counts = await Promise.all(rows.map((s) => countSegment(s).catch(() => null)));
  return (
    <Page
      title="Segments"
      icon={<IconFilter />}
      noPad
      actions={<Link href="/segments/new" className="btn btn-primary"><IconPlus size={14} /> New segment</Link>}
    >
      {rows.length ? (
        <table className="table-grid w-full">
          <thead><tr><th>Name</th><th>Rules</th><th>Contacts</th><th>Updated</th><th></th></tr></thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.id}>
                <td><Link href={`/segments/${s.id}`} className="font-medium hover:underline">{s.name}</Link></td>
                <td className="text-ink-2"><Chip>{s.match === "any" ? "Any" : "All"}</Chip> {s.rules.length} rule{s.rules.length === 1 ? "" : "s"}</td>
                <td>{counts[i] == null ? "—" : counts[i]!.toLocaleString("en-IN")}</td>
                <td className="text-ink-2">{timeAgo(s.updatedAt)}</td>
                <td className="text-right">
                  <Link href={`/contacts?segment=${s.id}`} className="text-sm text-accent hover:underline">Contacts</Link>
                  <span className="text-ink-4"> · </span>
                  <Link href={`/campaigns/new?segment=${s.id}`} className="text-sm text-accent hover:underline">Send campaign</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty
          icon={<IconFilter />}
          title="No segments yet"
          hint="Segments are saved filters — e.g. everyone who messaged in the last 7 days — that update automatically and can be targeted by campaigns."
          action={<Link href="/segments/new" className="btn btn-primary"><IconPlus size={14} /> New segment</Link>}
        />
      )}
    </Page>
  );
}
