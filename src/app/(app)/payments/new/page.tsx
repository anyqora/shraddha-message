import { eq } from "drizzle-orm";
import { IconCreditCard } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { contacts } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { Page } from "@/components/ui";
import { PaymentLinkForm } from "@/components/payment-actions";
import { createPaymentLinkAction, getPaymentConfig, searchPaymentContacts } from "../actions";
import { requirePagePermission } from "@/lib/permissions";

export default async function NewPaymentLinkPage({ searchParams }: { searchParams: Promise<{ contact?: string }> }) {
  await requirePagePermission("payments.manage");
  await requireUser();
  const sp = await searchParams;
  const [config, initial] = await Promise.all([
    getPaymentConfig(),
    sp.contact ? db.select({ id: contacts.id, name: contacts.name, phone: contacts.phone }).from(contacts).where(eq(contacts.id, sp.contact)).limit(1) : Promise.resolve([]),
  ]);
  return (
    <Page title="New payment link" icon={<IconCreditCard />} crumbs={[{ href: "/payments", label: "Payments" }]}>
      <PaymentLinkForm create={createPaymentLinkAction} search={searchPaymentContacts} config={config} initialContact={initial[0] ?? null} />
    </Page>
  );
}
