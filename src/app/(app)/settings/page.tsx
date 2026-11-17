import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { Notice, Field } from "@/components/ui";
import { TestConnection } from "@/components/test-connection";
import { saveWhatsApp, testWhatsApp } from "./actions";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const me = await requireUser();
  const s = await getSettings();
  const appUrl = process.env.APP_URL || "https://your-domain";
  const isAdmin = me.role === "admin";

  return (
    <>
      {sp.saved && <Notice tone="success">Saved.</Notice>}
      {sp.error && <Notice tone="error">Something went wrong.</Notice>}

      <section className="card space-y-4 p-4">
        <div>
          <h2 className="font-semibold">WhatsApp Cloud API</h2>
          <p className="text-sm text-ink-3">From Meta Developers → your app → WhatsApp → API Setup.</p>
        </div>
        <form action={saveWhatsApp} className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone number ID"><input name="waPhoneNumberId" defaultValue={s.waPhoneNumberId} className="input" disabled={!isAdmin} /></Field>
          <Field label="WhatsApp Business Account ID"><input name="waBusinessAccountId" defaultValue={s.waBusinessAccountId} className="input" disabled={!isAdmin} /></Field>
          <Field label="Permanent access token" hint={s.waAccessToken ? "Saved — leave blank to keep it." : "System user token with whatsapp_business_messaging + management."}>
            <input name="waAccessToken" type="password" autoComplete="off" placeholder={s.waAccessToken ? "••••••••••••" : ""} className="input" disabled={!isAdmin} />
          </Field>
          <Field label="App secret" hint={s.waAppSecret ? "Saved — leave blank to keep it." : "Used to verify webhook signatures."}>
            <input name="waAppSecret" type="password" autoComplete="off" placeholder={s.waAppSecret ? "••••••••••••" : ""} className="input" disabled={!isAdmin} />
          </Field>
          <Field label="Meta App ID" hint="Needed only for image/video/document template headers."><input name="waAppId" defaultValue={s.waAppId} className="input" disabled={!isAdmin} /></Field>
          <Field label="Graph API version"><input name="waApiVersion" defaultValue={s.waApiVersion} className="input" disabled={!isAdmin} /></Field>
          <Field label="Default country code" hint="Added to 10-digit numbers."><input name="defaultCountryCode" defaultValue={s.defaultCountryCode} className="input" disabled={!isAdmin} /></Field>
          <Field label="Campaign speed (messages / minute)"><input name="throttlePerMinute" type="number" min={1} max={1000} defaultValue={s.throttlePerMinute} className="input" disabled={!isAdmin} /></Field>
          <Field label="Webhook verify token" hint="Leave blank to generate one."><input name="waVerifyToken" defaultValue={s.waVerifyToken} className="input" disabled={!isAdmin} /></Field>
          <div className="flex items-end gap-2 sm:col-span-2">
            {isAdmin && <button className="btn btn-primary">Save</button>}
            <TestConnection action={testWhatsApp} />
          </div>
        </form>
        <div className="space-y-1 rounded-md bg-soft p-3 text-sm">
          <div className="font-medium">Webhook (Meta → WhatsApp → Configuration)</div>
          <div>Callback URL: <code className="rounded bg-hover px-1">{appUrl}/api/webhook/whatsapp</code></div>
          <div>Verify token: <code className="rounded bg-hover px-1">{s.waVerifyToken || "save settings first"}</code></div>
          <div className="text-ink-3">Subscribe to the <b>messages</b> field.</div>
        </div>
      </section>
    </>
  );
}
