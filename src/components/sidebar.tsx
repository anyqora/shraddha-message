"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconLayoutDashboard,
  IconMessageCircle,
  IconUser,
  IconList,
  IconTemplate,
  IconSpeakerphone,
  IconSettings,
  IconLogout,
  IconBrandWhatsapp,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Avatar } from "./ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: IconLayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: IconMessageCircle, badge: "unread" as const },
  { href: "/contacts", label: "Contacts", icon: IconUser },
  { href: "/lists", label: "Lists", icon: IconList },
  { href: "/templates", label: "Templates", icon: IconTemplate },
  { href: "/campaigns", label: "Campaigns", icon: IconSpeakerphone },
];

export function Sidebar({
  appName,
  user,
  unread,
  connected,
  logout,
}: {
  appName: string;
  user: { name: string; email: string; role: string };
  unread: number;
  connected: boolean;
  logout: () => Promise<void>;
}) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

  const item = (href: string, label: string, Icon: typeof IconUser, extra?: React.ReactNode) => (
    <Link
      key={href}
      href={href}
      className={cn(
        "flex h-7 items-center gap-2 rounded-sm px-1.5 text-sm transition-colors",
        active(href) ? "bg-[#e3e3e3]/70 font-medium text-ink" : "text-ink-2 hover:bg-[#e8e8e8]/70",
      )}
    >
      <Icon size={16} stroke={1.8} className={active(href) ? "text-ink" : "text-ink-3"} />
      <span className="flex-1 truncate">{label}</span>
      {extra}
    </Link>
  );

  return (
    <aside className="flex w-[220px] shrink-0 flex-col gap-4 px-2 py-3">
      <div className="flex items-center gap-2 px-1.5">
        <span className="flex size-6 items-center justify-center rounded-md bg-accent text-white">
          <IconBrandWhatsapp size={15} />
        </span>
        <span className="truncate text-sm font-semibold text-ink">{appName}</span>
      </div>

      <nav className="flex flex-col gap-px">
        {NAV.map((n) =>
          item(
            n.href,
            n.label,
            n.icon,
            n.badge && unread > 0 ? (
              <span className="rounded-sm bg-accent px-1 text-[11px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>
            ) : null,
          ),
        )}
      </nav>

      <div>
        <div className="mb-1 px-1.5 text-xs font-medium text-ink-3">Workspace</div>
        {item(
          "/settings",
          "Settings",
          IconSettings,
          !connected ? <span className="size-1.5 rounded-full bg-[#e8590c]" title="WhatsApp not connected" /> : null,
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 rounded-sm px-1.5 py-1">
        <Avatar name={user.name || user.email} size={22} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium text-ink">{user.name || user.email}</div>
          <div className="truncate text-xs text-ink-3">{user.role === "admin" ? "Admin" : "Agent"}</div>
        </div>
        <form action={logout}>
          <button className="rounded-sm p-1 text-ink-3 hover:bg-[#e8e8e8] hover:text-ink" title="Log out">
            <IconLogout size={15} />
          </button>
        </form>
      </div>
    </aside>
  );
}
