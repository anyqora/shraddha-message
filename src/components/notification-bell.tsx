"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconBell } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { NotificationList, markNotificationRead, type NotificationItem } from "./notification-list";

const POLL_MS = 20_000;

export function NotificationBell({ collapsed }: { collapsed?: boolean }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("unsupported");
  const lastSeen = useRef<string | null>(null); // newest createdAt we've already considered for desktop alerts
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { items: NotificationItem[]; unread: number };
      setItems(d.items);
      setUnread(d.unread);
      const newest = d.items[0]?.createdAt ?? null;
      if (lastSeen.current !== null && typeof Notification !== "undefined" && Notification.permission === "granted") {
        const fresh = d.items.filter((n) => !n.read && n.createdAt > lastSeen.current!);
        for (const n of fresh.slice(0, 3)) {
          try {
            const dn = new Notification(n.title, { body: n.body, tag: n.id });
            dn.onclick = () => {
              window.focus();
              markNotificationRead(n.id);
              if (n.link) window.location.href = n.link;
            };
          } catch {}
        }
      }
      if (newest && (lastSeen.current === null || newest > lastSeen.current)) lastSeen.current = newest;
      else if (lastSeen.current === null) lastSeen.current = "";
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof Notification !== "undefined") setPerm(Notification.permission);
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible" || (typeof Notification !== "undefined" && Notification.permission === "granted")) load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markAll = async () => {
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    setUnread(0);
    await markNotificationRead();
    load();
  };

  const enableAlerts = async () => {
    if (typeof Notification === "undefined") return;
    setPerm(await Notification.requestPermission());
  };

  const badge = unread > 0 && (
    <span className={cn("rounded-[4px] bg-[#e5484d] px-1.5 text-[11px] font-semibold leading-[18px] text-white", collapsed && "absolute -right-1 -top-1 px-1 text-[10px] leading-[14px]")}>
      {unread > 99 ? "99+" : unread}
    </span>
  );

  return (
    <div ref={box} className="relative">
      {collapsed ? (
        <button onClick={() => setOpen(!open)} className="relative rounded-sm p-1 text-ink-3 hover:bg-black/[0.05]" title="Notifications">
          <IconBell size={16} />
          {badge}
        </button>
      ) : (
        <button onClick={() => setOpen(!open)} className={cn("flex h-7 w-full items-center gap-2 rounded-sm px-1 text-sm text-ink-2 hover:bg-black/[0.04]", open && "bg-black/[0.05]")}>
          <IconBell size={16} className="mx-px text-ink-3" />
          <span className="flex-1 text-left">Notifications</span>
          {badge}
        </button>
      )}
      {open && (
        <div className={cn("absolute z-50 w-80 overflow-hidden rounded-lg border border-line bg-panel shadow-lg", collapsed ? "left-full top-0 ml-2" : "left-0 top-full mt-1")}>
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-sm font-medium text-ink">Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} className="text-xs text-[#1961ed] hover:underline">Mark all read</button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <NotificationList items={items} compact onOpen={() => { setOpen(false); load(); }} />
          </div>
          <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs">
            <Link href="/notifications" onClick={() => setOpen(false)} className="text-ink-2 hover:underline">View all</Link>
            {perm === "default" && (
              <button onClick={enableAlerts} className="text-[#1961ed] hover:underline">Enable desktop alerts</button>
            )}
            {perm === "denied" && <span className="text-ink-4">Desktop alerts blocked</span>}
          </div>
        </div>
      )}
    </div>
  );
}
