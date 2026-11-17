import { asc } from "drizzle-orm";
import { IconBolt } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { quickReplies } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { Page } from "@/components/ui";
import { InboxQuickReplies } from "@/components/inbox-quick-replies";
import { deleteQuickReply, saveQuickReply } from "./actions";

export default async function QuickRepliesPage() {
  await requireUser();
  const rows = await db.select().from(quickReplies).orderBy(asc(quickReplies.shortcut));
  return (
    <Page title="Quick replies" icon={<IconBolt />} crumbs={[{ href: "/inbox", label: "Inbox" }]}>
      <InboxQuickReplies
        rows={rows.map((r) => ({ id: r.id, shortcut: r.shortcut, body: r.body }))}
        save={saveQuickReply}
        remove={deleteQuickReply}
      />
    </Page>
  );
}
