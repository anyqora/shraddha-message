"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
  IconSearch,
  IconChevronDown,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconRobot,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Avatar } from "./ui";
import { CommandMenu, useCommandMenu } from "./command-menu";

type NavItem = { href: string; label: string; icon: typeof IconUser; tint: string; badge?: "unread" };
const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Workspace",
    items: [
      { href: "/", label: "Dashboard", icon: IconLayoutDashboard, tint: "#1961ed" },
      { href: "/inbox", label: "Inbox", icon: IconMessageCircle, tint: "#2f9e44", badge: "unread" },
      { href: "/contacts", label: "Contacts", icon: IconUser, tint: "#e8590c" },
      { href: "/lists", label: "Lists", icon: IconList, tint: "#7048e8" },
    ],
  },
  {
    title: "Messaging",
    items: [
      { href: "/templates", label: "Templates", icon: IconTemplate, tint: "#0c8599" },
      { href: "/campaigns", label: "Campaigns", icon: IconSpeakerphone, tint: "#d6336c" },
      { href: "/chatbot", label: "Chatbot", icon: IconRobot, tint: "#b08800" },
    ],
  },
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
  const { open, setOpen } = useCommandMenu();
  const [collapsed, setCollapsed] = useState(false);
  const [closedGroups, setClosedGroups] = useState<string[]>([]);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sm.sidebar") === "1");
      setClosedGroups(JSON.parse(localStorage.getItem("sm.groups") ?? "[]"));
    } catch {}
  }, []);
  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
    try { localStorage.setItem("sm.sidebar", collapsed ? "0" : "1"); } catch {}
  };
  const toggleGroup = (t: string) => {
    const n = closedGroups.includes(t) ? closedGroups.filter((x) => x !== t) : [...closedGroups, t];
    setClosedGroups(n);
    try { localStorage.setItem("sm.groups", JSON.stringify(n)); } catch {}
  };
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

  const link = (n: { href: string; label: string; icon: typeof IconUser; tint?: string }, extra?: React.ReactNode) => {
    const on = active(n.href);
    const Icon = n.icon;
    return (
      <Link
        key={n.href}
        href={n.href}
        title={collapsed ? n.label : undefined}
        className={cn(
          "group flex h-7 items-center gap-2 rounded-sm px-1 text-sm transition-colors",
          on ? "bg-black/[0.05] font-medium text-ink" : "text-ink-2 hover:bg-black/[0.04]",
          collapsed && "justify-center",
        )}
      >
        <span className="flex size-[18px] shrink-0 items-center justify-center rounded-[4px] text-white" style={{ background: n.tint ?? "#999" }}>
          <Icon size={12} stroke={2.2} />
        </span>
        {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
        {!collapsed && extra}
      </Link>
    );
  };

  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center gap-3 py-3">
        <button onClick={toggleCollapsed} className="rounded-sm p-1 text-ink-3 hover:bg-black/[0.05]" title="Expand sidebar">
          <IconLayoutSidebarLeftExpand size={18} />
        </button>
        <button onClick={() => setOpen(true)} className="rounded-sm p-1 text-ink-3 hover:bg-black/[0.05]" title="Search (⌘K)">
          <IconSearch size={16} />
        </button>
        <nav className="flex w-full flex-col gap-1 px-2">
          {GROUPS.flatMap((g) => g.items).map((n) => link(n))}
          {link({ href: "/settings", label: "Settings", icon: IconSettings, tint: "#999" })}
        </nav>
        <CommandMenu open={open} onClose={() => setOpen(false)} />
      </aside>
    );
  }

  return (
    <aside className="flex w-[228px] shrink-0 flex-col gap-3 px-2 py-2.5">
      <div className="flex items-center gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-1">
          <span className="flex size-5 items-center justify-center rounded-[5px] bg-[#25d366] text-white">
            <IconBrandWhatsapp size={13} />
          </span>
          <span className="truncate text-sm font-semibold text-ink">{appName}</span>
        </div>
        <button onClick={toggleCollapsed} className="rounded-sm p-1 text-ink-3 hover:bg-black/[0.05]" title="Collapse sidebar">
          <IconLayoutSidebarLeftCollapse size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-px">
        <button onClick={() => setOpen(true)} className="flex h-7 items-center gap-2 rounded-sm px-1 text-sm text-ink-2 hover:bg-black/[0.04]">
          <IconSearch size={16} className="mx-px text-ink-3" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded-[3px] bg-black/[0.05] px-1 font-sans text-[11px] text-ink-3">⌘K</kbd>
        </button>
        {link(
          { href: "/settings", label: "Settings", icon: IconSettings, tint: "#999" },
          !connected ? <span className="size-1.5 rounded-full bg-[#e8590c]" title="WhatsApp not connected" /> : null,
        )}
      </div>

      {GROUPS.map((g) => {
        const closed = closedGroups.includes(g.title);
        return (
          <div key={g.title}>
            <button onClick={() => toggleGroup(g.title)} className="group mb-0.5 flex w-full items-center gap-1 px-1 text-xs font-medium text-ink-4 hover:text-ink-3">
              {g.title}
              <IconChevronDown size={11} className={cn("opacity-0 transition group-hover:opacity-100", closed && "-rotate-90")} />
            </button>
            {!closed && (
              <nav className="flex flex-col gap-px">
                {g.items.map((n) =>
                  link(
                    n,
                    n.badge && unread > 0 ? (
                      <span className="rounded-[4px] bg-black/[0.06] px-1.5 text-[11px] font-semibold leading-[18px] text-ink-2">{unread > 99 ? "99+" : unread}</span>
                    ) : null,
                  ),
                )}
              </nav>
            )}
          </div>
        );
      })}

      <div className="mt-auto flex items-center gap-2 rounded-sm px-1 py-1">
        <Avatar name={user.name || user.email} size={22} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium text-ink">{user.name || user.email}</div>
          <div className="truncate text-xs text-ink-3">{user.role === "admin" ? "Admin" : "Agent"}</div>
        </div>
        <form action={logout}>
          <button className="rounded-sm p-1 text-ink-3 hover:bg-black/[0.06] hover:text-ink" title="Log out">
            <IconLogout size={15} />
          </button>
        </form>
      </div>
      <CommandMenu open={open} onClose={() => setOpen(false)} />
    </aside>
  );
}
