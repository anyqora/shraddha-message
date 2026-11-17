import { IconMessageCircle } from "@tabler/icons-react";
import { Page, Empty } from "@/components/ui";
import { ConversationList } from "@/components/conversation-list";
import { AutoRefresh } from "@/components/auto-refresh";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return (
    <Page title="Inbox" icon={<IconMessageCircle />} noPad>
      <AutoRefresh seconds={8} />
      <div className="flex h-full min-h-0">
        <ConversationList q={q} />
        <div className="flex-1"><Empty icon={<IconMessageCircle />} title="Select a conversation" hint="Choose a chat on the left to read and reply." /></div>
      </div>
    </Page>
  );
}
