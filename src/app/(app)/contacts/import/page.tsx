import { asc } from "drizzle-orm";
import { IconUpload } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { lists } from "@/db/schema";
import { Page } from "@/components/ui";
import { ImportWizard } from "@/components/import-wizard";
import { importContacts } from "../actions";
import { createList } from "../../lists/actions";
import { requirePagePermission } from "@/lib/permissions";

export default async function ImportPage() {
  await requirePagePermission("contacts.import");
  const all = await db.select().from(lists).orderBy(asc(lists.name));
  return (
    <Page title="Import contacts" icon={<IconUpload />} crumbs={[{ href: "/contacts", label: "Contacts" }]}>
      <ImportWizard lists={all.map((l) => ({ id: l.id, name: l.name }))} importAction={importContacts} createList={createList} />
    </Page>
  );
}
