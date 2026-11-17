import { IconMailForward } from "@tabler/icons-react";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { Notice, Field } from "@/components/ui";
import { ActionButton } from "@/components/settings-action-button";
import { saveEmail, testEmail } from "../actions";

export default async function EmailSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const sp = await searchParams;
  const me = await requireUser();
  const s = await getSettings();
  const isAdmin = me.role === "admin";
  return (
    <>
      {sp.saved && <Notice tone="success">Saved.</Notice>}
      <section className="card space-y-4 p-4">
        <div>
          <h2 className="font-semibold">Email (SMTP)</h2>
          <p className="text-sm text-ink-3">Used for password-reset and invite emails. Any SMTP provider works (Gmail, Zoho, Hostinger, SES, Brevo…).</p>
        </div>
        <form action={saveEmail} className="grid gap-3 sm:grid-cols-2">
          <Field label="SMTP host"><input name="smtpHost" defaultValue={s.smtpHost} placeholder="smtp.example.com" className="input" disabled={!isAdmin} /></Field>
          <Field label="Port" hint="465 = SSL, 587 = STARTTLS."><input name="smtpPort" type="number" min={1} max={65535} defaultValue={s.smtpPort} className="input" disabled={!isAdmin} /></Field>
          <Field label="Username"><input name="smtpUser" defaultValue={s.smtpUser} autoComplete="off" className="input" disabled={!isAdmin} /></Field>
          <Field label="Password" hint={s.smtpPass ? "Saved — leave blank to keep it." : undefined}>
            <input name="smtpPass" type="password" autoComplete="off" placeholder={s.smtpPass ? "••••••••••••" : ""} className="input" disabled={!isAdmin} />
          </Field>
          <Field label="From address" hint='e.g. "Shraddha Message <no-reply@example.com>"'>
            <input name="smtpFrom" defaultValue={s.smtpFrom} className="input" disabled={!isAdmin} />
          </Field>
          <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
            {isAdmin && <button className="btn btn-primary">Save</button>}
            {isAdmin && <ActionButton action={testEmail} label={`Send test email to ${me.email}`} pendingLabel="Sending…" icon={<IconMailForward size={14} />} />}
          </div>
        </form>
      </section>
    </>
  );
}
