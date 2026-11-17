import { desc, inArray } from "drizzle-orm";
import { IconSend, IconTrash } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { apiKeys, users, webhookEndpoints } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { EVENT_NAMES } from "@/lib/events";
import { appUrl } from "@/lib/mailer";
import { Notice, Chip, Empty } from "@/components/ui";
import { ApiKeyForm } from "@/components/settings-api-key-form";
import { ActionButton } from "@/components/settings-action-button";
import { CopyField } from "@/components/settings-copy";
import { timeAgo, formatDateTime } from "@/lib/utils";
import { createApiKey, createWebhook, deleteWebhook, revokeApiKey, rotateWebhookSecret, testWebhook, updateWebhook } from "./actions";

const ERR: Record<string, string> = {
  url: "Enter a valid http(s) URL.",
  events: "Pick at least one event.",
};

function EventBoxes({ selected }: { selected: string[] }) {
  return (
    <div className="grid gap-1 sm:grid-cols-3">
      {EVENT_NAMES.map((e) => (
        <label key={e} className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="events" value={e} defaultChecked={selected.includes(e)} />
          <code className="text-xs">{e}</code>
        </label>
      ))}
    </div>
  );
}

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-md bg-soft p-3 font-mono text-xs leading-5 text-ink-2">{children}</pre>;
}

export default async function DevelopersSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const me = await requireUser();
  if (me.role !== "admin") return <Notice tone="warn">Only admins can manage API keys and webhooks.</Notice>;

  const [keys, hooks] = await Promise.all([
    db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt)),
    db.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.createdAt)),
  ]);
  const creatorIds = [...new Set(keys.map((k) => k.createdBy).filter((x): x is string => !!x))];
  const creators = creatorIds.length ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, creatorIds)) : [];
  const who = new Map(creators.map((u) => [u.id, u.name || u.email]));
  const base = `${appUrl()}/api/v1`;

  return (
    <>
      {sp.saved && <Notice tone="success">Saved.</Notice>}
      {sp.error && <Notice tone="error">{ERR[sp.error] ?? "Something went wrong."}</Notice>}

      {/* ------------------------------------------------ API keys */}
      <section className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <div className="font-semibold">API keys</div>
          <div className="text-sm text-ink-3">Use these to call the REST API from your own systems, Zapier, Make, n8n…</div>
        </div>
        {keys.length ? (
          <div className="overflow-x-auto">
            <table className="table-grid w-full">
              <thead><tr><th>Name</th><th>Key</th><th>Last used</th><th>Created</th><th className="w-10"></th></tr></thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td><code className="text-xs text-ink-2">{k.prefix}…</code></td>
                    <td className="text-ink-2">{timeAgo(k.lastUsedAt) || "never"}</td>
                    <td className="text-ink-2" title={formatDateTime(k.createdAt)}>{timeAgo(k.createdAt)}{k.createdBy && who.get(k.createdBy) ? ` · ${who.get(k.createdBy)}` : ""}</td>
                    <td>
                      <form action={revokeApiKey.bind(null, k.id)}>
                        <button className="rounded-sm p-1 text-ink-3 hover:text-danger" title="Revoke"><IconTrash size={14} /></button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-3 text-sm text-ink-3">No API keys yet.</div>
        )}
        <ApiKeyForm action={createApiKey} />
      </section>

      {/* ------------------------------------------------ Webhooks */}
      <section className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <div className="font-semibold">Outgoing webhooks</div>
          <div className="text-sm text-ink-3">
            We POST <code>{"{ event, data, timestamp }"}</code> as JSON to your URL. Verify the <code>X-Signature-256</code> header (HMAC-SHA256 of the raw body with the endpoint secret). 8 s timeout.
          </div>
        </div>
        {hooks.length === 0 && <Empty title="No webhook endpoints" hint="Add one below to get notified about new messages, contacts and more." />}
        {hooks.map((h) => (
          <div key={h.id} className="space-y-3 border-b border-line p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Chip color={h.active ? "green" : "gray"}>{h.active ? "Active" : "Paused"}</Chip>
              {h.lastAt ? (
                <Chip color={h.lastError ? "red" : "green"}>{h.lastStatus ?? "ERR"}</Chip>
              ) : (
                <span className="text-ink-3">Never called</span>
              )}
              {h.lastAt && <span className="text-ink-3">{timeAgo(h.lastAt)}</span>}
              {h.lastError && <span className="truncate text-danger" title={h.lastError}>{h.lastError}</span>}
            </div>
            <form action={updateWebhook.bind(null, h.id)} className="space-y-2">
              <input name="url" type="url" required defaultValue={h.url} className="input" />
              <EventBoxes selected={h.events ?? []} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={h.active} /> Active
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn btn-primary">Save</button>
                <ActionButton action={testWebhook.bind(null, h.id)} label="Send test" pendingLabel="Sending…" icon={<IconSend size={14} />} />
              </div>
            </form>
            <div className="flex flex-wrap items-center gap-2">
              <span className="label mb-0">Signing secret</span>
              <span className="min-w-64 flex-1"><CopyField value={h.secret} /></span>
              <form action={rotateWebhookSecret.bind(null, h.id)}><button className="btn">Rotate</button></form>
              <form action={deleteWebhook.bind(null, h.id)}><button className="btn btn-danger"><IconTrash size={14} /> Delete</button></form>
            </div>
          </div>
        ))}
        <form action={createWebhook} className="space-y-2 bg-soft/50 p-4">
          <div className="text-sm font-medium">Add endpoint</div>
          <input name="url" type="url" required placeholder="https://example.com/hooks/whatsapp" className="input" />
          <EventBoxes selected={["message.received"]} />
          <input type="hidden" name="active" value="on" />
          <button className="btn btn-primary">Add endpoint</button>
        </form>
      </section>

      {/* ------------------------------------------------ Docs */}
      <section className="card space-y-3 p-4 text-sm">
        <div>
          <h2 className="font-semibold">REST API v1</h2>
          <p className="text-ink-3">
            Base URL <code>{base}</code>. Send <code>Authorization: Bearer sm_live_…</code>. Responses are JSON; errors look like <code>{'{"error":{"message":"…"}}'}</code>.
          </p>
        </div>
        <div className="font-medium">List / search contacts</div>
        <Code>{`curl "${base}/contacts?q=ravi&page=1" \\
  -H "Authorization: Bearer $API_KEY"`}</Code>
        <div className="font-medium">Create or update a contact (upsert by phone)</div>
        <Code>{`curl -X POST "${base}/contacts" \\
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '{"phone":"9876543210","name":"Ravi","email":"ravi@example.com","custom":{"city":"Pune"}}'`}</Code>
        <div className="font-medium">Send a text message (only within 24 h of the customer&apos;s last message)</div>
        <Code>{`curl -X POST "${base}/messages" \\
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '{"to":"919876543210","text":"Your order has shipped!"}'`}</Code>
        <div className="font-medium">Send an approved template</div>
        <Code>{`curl -X POST "${base}/messages" \\
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '{"to":"919876543210","template":{"name":"order_update","language":"en","body":["Ravi","#1234"]}}'`}</Code>
        <div className="font-medium">Message history for a contact</div>
        <Code>{`curl "${base}/messages?contact=919876543210&page=1" \\
  -H "Authorization: Bearer $API_KEY"`}</Code>
        <div className="font-medium">Verify a webhook (Node.js)</div>
        <Code>{`const crypto = require("crypto");
const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-signature-256"]));`}</Code>
      </section>
    </>
  );
}
