import { asc } from "drizzle-orm";
import { IconUser } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { lists } from "@/db/schema";
import { Page, Notice } from "@/components/ui";
import { ContactForm } from "@/components/contact-form";
import { saveContact } from "../actions";

export default async function NewContact({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const all = await db.select().from(lists).orderBy(asc(lists.name));
  return (
    <Page title="New contact" icon={<IconUser />} crumbs={[{ href: "/contacts", label: "Contacts" }]}>
      <div className="mx-auto max-w-xl space-y-4">
        {error === "phone" && <Notice tone="error">Enter a valid phone number with country code.</Notice>}
        {error === "duplicate" && <Notice tone="error">A contact with this phone number already exists.</Notice>}
        <ContactForm lists={all} memberOf={[]} action={saveContact} />
      </div>
    </Page>
  );
}
