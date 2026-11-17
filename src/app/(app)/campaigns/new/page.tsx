import { and, asc, eq, sql } from "drizzle-orm";
import { IconSpeakerphone } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { contacts, listMembers, lists, segments, templates } from "@/db/schema";
import { segmentWhere } from "@/lib/segments";
import { Page } from "@/components/ui";
import { CampaignWizard } from "@/components/campaign-wizard";
import { createCampaign } from "../actions";

export default async function NewCampaign({ searchParams }: { searchParams: Promise<{ list?: string; segment?: string }> }) {
  const { list, segment } = await searchParams;
  const [tpls, ls, keys] = await Promise.all([
    db.select().from(templates).where(eq(templates.status, "APPROVED")).orderBy(asc(templates.name)),
    db
      .select({ id: lists.id, name: lists.name, n: sql<number>`count(${listMembers.contactId})` })
      .from(lists)
      .leftJoin(listMembers, eq(listMembers.listId, lists.id))
      .groupBy(lists.id)
      .orderBy(asc(lists.name)),
    db.execute(sql`select distinct jt.k from contacts, json_table(json_keys(contacts.custom), '$[*]' columns (k varchar(191) path '$')) jt limit 200`).catch(() => [[]]),
  ]);
  const segRows = await db.select().from(segments).orderBy(asc(segments.name));
  const segs = await Promise.all(
    segRows.map(async (s) => {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)` })
        .from(contacts)
        .where(and(segmentWhere(s), eq(contacts.optedOut, false), eq(contacts.channel, "whatsapp")))
        .catch(() => [{ n: 0 }]);
      return { id: s.id, name: s.name, count: Number(n) };
    }),
  );
  const customKeys = ((keys as any)[0] as { k: string }[]).map((r) => r.k).filter(Boolean);
  return (
    <Page title="New campaign" icon={<IconSpeakerphone />} crumbs={[{ href: "/campaigns", label: "Campaigns" }]}>
      <CampaignWizard
        templates={tpls.map((t) => ({ id: t.id, name: t.name, language: t.language, components: t.components }))}
        lists={ls.map((l) => ({ id: l.id, name: l.name, count: Number(l.n) }))}
        customKeys={customKeys}
        segments={segs}
        defaultList={list}
        defaultSegment={segment}
        action={createCampaign}
      />
    </Page>
  );
}
