import { sql, eq } from "drizzle-orm";
import { IconMessageChatbot } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { contacts } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { Page, Notice, Chip, Stat } from "@/components/ui";
import { WidgetSettingsForm } from "@/components/widget-settings-form";
import { WidgetSnippet } from "@/components/widget-snippet";
import { saveWidgetSettings } from "./actions";

export default async function WidgetPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const sp = await searchParams;
  const me = await requireUser();
  const isAdmin = me.role === "admin";
  const [s, [stats]] = await Promise.all([
    getSettings(),
    db
      .select({
        visitors: sql<number>`count(*)`,
        unread: sql<number>`coalesce(sum(${contacts.unreadCount}), 0)`,
      })
      .from(contacts)
      .where(eq(contacts.channel, "web")),
  ]);
  const appUrl = (process.env.APP_URL || "https://your-domain").replace(/\/+$/, "");
  const snippet = `<script src="${appUrl}/widget.js" async></script>`;

  return (
    <Page title="Website chat" icon={<IconMessageChatbot />}>
      <div className="mx-auto max-w-4xl space-y-6">
        {sp.saved && <Notice tone="success">Saved.</Notice>}
        <Notice>
          Add a chat bubble to your website. Visitor messages arrive in the Inbox like WhatsApp chats, and you reply from there. When the AI Assistant is
          enabled it answers website visitors too (the WhatsApp chatbot rules do not run on web chats).
        </Notice>

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Status" value={<Chip color={s.widgetEnabled ? "green" : "gray"}>{s.widgetEnabled ? "Live" : "Off"}</Chip>} />
          <Stat label="Website visitors" value={Number(stats?.visitors ?? 0).toLocaleString("en-IN")} />
          <Stat label="Unread web messages" value={Number(stats?.unread ?? 0).toLocaleString("en-IN")} />
        </div>

        <section className="card space-y-4 p-4">
          <div>
            <h2 className="font-semibold">Appearance</h2>
            <p className="text-sm text-ink-3">Changes show on websites within about a minute.</p>
          </div>
          <WidgetSettingsForm
            action={saveWidgetSettings}
            disabled={!isAdmin}
            initial={{ enabled: s.widgetEnabled, title: s.widgetTitle, greeting: s.widgetGreeting, color: s.widgetColor }}
          />
        </section>

        <section className="card space-y-3 p-4">
          <div>
            <h2 className="font-semibold">Install</h2>
            <p className="text-sm text-ink-3">
              Paste this just before <code>&lt;/body&gt;</code> on every page of your website (WordPress: a header/footer scripts plugin; Shopify: theme.liquid).
            </p>
          </div>
          <WidgetSnippet code={snippet} />
          {!process.env.APP_URL && <Notice tone="warn">Set APP_URL in the server environment so the snippet points at this panel&apos;s public address.</Notice>}
        </section>
      </div>
    </Page>
  );
}
