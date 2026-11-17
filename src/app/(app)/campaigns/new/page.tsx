import { asc, eq, sql } from "drizzle-orm";
import { IconSpeakerphone } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { listMembers, lists, templates } from "@/db/schema";
import { Page } from "@/components/ui";
import { CampaignWizard } from "@/components/campaign-wizard";
import { createCampaign } from "../actions";

export default async function NewCampaign({ searchParams }: { searchParams: Promise<{ list?: string }> }) {
  const { list } = await searchParams;
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
  const customKeys = ((keys as any)[0] as { k: string }[]).map((r) => r.k).filter(Boolean);
  return (
    <Page title="New campaign" icon={<IconSpeakerphone />} crumbs={[{ href: "/campaigns", label: "Campaigns" }]}>
      <CampaignWizard
        templates={tpls.map((t) => ({ id: t.id, name: t.name, language: t.language, components: t.components }))}
        lists={ls.map((l) => ({ id: l.id, name: l.name, count: Number(l.n) }))}
        customKeys={customKeys}
        defaultList={list}
        action={createCampaign}
      />
    </Page>
  );
}
