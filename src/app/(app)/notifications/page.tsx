import { revalidatePath } from "next/cache";
import { IconBell } from "@tabler/icons-react";
import { Page } from "@/components/ui";
import { NotificationList } from "@/components/notification-list";
import { requireUser } from "@/lib/auth";
import { listNotifications, markNotificationsRead } from "@/lib/notifications";

async function markAllRead() {
  "use server";
  const me = await requireUser();
  await markNotificationsRead(me.id);
  revalidatePath("/notifications");
}

export default async function NotificationsPage() {
  const me = await requireUser();
  const { items, unread } = await listNotifications(me.id, 100);
  return (
    <Page
      title="Notifications"
      icon={<IconBell />}
      actions={
        unread > 0 ? (
          <form action={markAllRead}>
            <button className="btn">Mark all read ({unread})</button>
          </form>
        ) : null
      }
    >
      <div className="mx-auto max-w-2xl overflow-hidden rounded-lg border border-line">
        <NotificationList items={items} />
      </div>
    </Page>
  );
}
