import { IconCreditCard, IconPlugConnected } from "@tabler/icons-react";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { Page, Field, Notice } from "@/components/ui";
import { CopyField } from "@/components/settings-copy";
import { ActionButton } from "@/components/settings-action-button";
import { savePaymentSettings, testRazorpay } from "../actions";
import { can, requirePagePermission } from "@/lib/permissions";

export default async function PaymentSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await requirePagePermission("payments.manage");
  const sp = await searchParams;
  const me = await requireUser();
  const isAdmin = await can(me, "payments.manage");
  const s = await getSettings();
  const base = (process.env.APP_URL || "").replace(/\/+$/, "");
  const webhookUrl = `${base}/api/payments/razorpay`;

  return (
    <Page title="Settings" icon={<IconCreditCard />} crumbs={[{ href: "/payments", label: "Payments" }]}>
      <form action={savePaymentSettings} className="max-w-3xl space-y-4">
        {sp.saved && <Notice tone="success">Saved.</Notice>}
        {!isAdmin && <Notice tone="warn">Only admins can change payment settings.</Notice>}
        <section className="card space-y-4 p-4">
          <div>
            <h2 className="font-semibold">Razorpay</h2>
            <p className="text-sm text-ink-3">
              Create keys in the Razorpay Dashboard → Account &amp; Settings → API Keys. Payment links are created with SMS/email notifications off — we send them on WhatsApp.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Key ID"><input name="razorpayKeyId" defaultValue={s.razorpayKeyId} placeholder="rzp_live_…" autoComplete="off" className="input" disabled={!isAdmin} /></Field>
            <Field label="Key secret" hint={s.razorpayKeySecret ? "Saved — leave blank to keep it." : undefined}>
              <input name="razorpayKeySecret" type="password" autoComplete="off" placeholder={s.razorpayKeySecret ? "••••••••••••" : ""} className="input" disabled={!isAdmin} />
            </Field>
          </div>
          <div className="space-y-2 rounded-md border border-line bg-soft p-3">
            <div className="text-sm font-medium">Webhook</div>
            <p className="text-xs text-ink-3">
              In Razorpay → Webhooks, add this URL, pick a secret, and enable the <span className="font-mono">payment_link.paid</span>, <span className="font-mono">payment_link.expired</span> and{" "}
              <span className="font-mono">payment_link.cancelled</span> events. Paid links are marked automatically and the customer gets a “✅ Payment received” message.
            </p>
            <CopyField value={webhookUrl} />
            {!base.startsWith("https://") && <p className="text-xs text-danger">APP_URL is not an https URL — Razorpay needs a public https endpoint.</p>}
            <Field label="Webhook secret" hint={s.razorpayWebhookSecret ? "Saved — leave blank to keep it." : "The same secret you enter in Razorpay."}>
              <input name="razorpayWebhookSecret" type="password" autoComplete="off" placeholder={s.razorpayWebhookSecret ? "••••••••••••" : ""} className="input" disabled={!isAdmin} />
            </Field>
          </div>
        </section>
        <section className="card space-y-4 p-4">
          <div>
            <h2 className="font-semibold">UPI</h2>
            <p className="text-sm text-ink-3">
              UPI links (<span className="font-mono">upi://pay</span>) open the customer&apos;s UPI app with the amount filled in. They can&apos;t be tracked automatically — mark them paid from the Payments list.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="UPI ID (VPA)"><input name="upiId" defaultValue={s.upiId} placeholder="business@okhdfcbank" className="input" disabled={!isAdmin} /></Field>
            <Field label="Payee name"><input name="upiName" defaultValue={s.upiName} placeholder="Shraddha Consultancy" className="input" disabled={!isAdmin} /></Field>
          </div>
        </section>
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary">Save</button>
            <ActionButton action={testRazorpay} label="Test Razorpay keys" pendingLabel="Testing…" icon={<IconPlugConnected size={14} />} />
          </div>
        )}
      </form>
    </Page>
  );
}
