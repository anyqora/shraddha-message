"use client";

import { useRouter } from "next/navigation";
import { IconBell, IconMessageCircle, IconSpeakerphone, IconUserCheck } from "@tabler/icons-react";
import { cn, timeAgo } from "@/lib/utils";

export type NotificationItem = { id: string; type: string; title: string; body: string; link: string; read: boolean; createdAt: string };

const ICON: Record<string, { icon: typeof IconBell; tint: string }> = {
  message: { icon: IconMessageCircle, tint: "#2f9e44" },
  assigned: { icon: IconUserCheck, tint: "#1961ed" },
  campaign: { icon: IconSpeakerphone, tint: "#d6336c" },
};

export async function markNotificationRead(id?: string) {
  await fetch("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(id ? { action: "read", id } : { action: "read" }),
  }).catch(() => {});
}

export function NotificationList({
  items,
  onOpen,
  compact,
}: {
  items: NotificationItem[];
  /** called after an item is marked read, before navigating */
  onOpen?: (n: NotificationItem) => void;
  compact?: boolean;
}) {
  const router = useRouter();
  const open = async (n: NotificationItem) => {
    if (!n.read) await markNotificationRead(n.id);
    onOpen?.(n);
    if (n.link) router.push(n.link);
    router.refresh();
  };
  if (!items.length) {
    return <div className="px-3 py-8 text-center text-sm text-ink-3">You&apos;re all caught up.</div>;
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((n) => {
        const meta = ICON[n.type] ?? { icon: IconBell, tint: "#999" };
        const Icon = meta.icon;
        return (
          <li key={n.id}>
            <button
              onClick={() => open(n)}
              className={cn("flex w-full items-start gap-2.5 px-3 text-left hover:bg-black/[0.03]", compact ? "py-2" : "py-3", !n.read && "bg-[#f5f8ff]")}
            >
              <span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[4px] text-white" style={{ background: meta.tint }}>
                <Icon size={12} stroke={2.2} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-sm", n.read ? "text-ink-2" : "font-medium text-ink")}>{n.title}</span>
                {n.body && <span className={cn("block text-xs text-ink-3", compact ? "truncate" : "line-clamp-2")}>{n.body}</span>}
                <span className="block text-[11px] text-ink-4">{timeAgo(n.createdAt)}</span>
              </span>
              {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[#1961ed]" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
