"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconBrandWhatsapp, IconCode, IconMail, IconUserCircle, IconUsers } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings", label: "WhatsApp", icon: IconBrandWhatsapp, group: "Workspace" },
  { href: "/settings/team", label: "Team", icon: IconUsers, group: "Workspace" },
  { href: "/settings/email", label: "Email", icon: IconMail, group: "Workspace" },
  { href: "/settings/developers", label: "Developers", icon: IconCode, group: "Workspace" },
  { href: "/settings/account", label: "My account", icon: IconUserCircle, group: "User" },
];

export function SettingsNav() {
  const path = usePathname();
  const groups = ["User", "Workspace"];
  return (
    <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2 md:w-52 md:flex-col md:overflow-visible md:border-r md:border-b-0 md:p-3">
      {groups.map((g) => (
        <div key={g} className="flex gap-1 md:mb-3 md:flex-col">
          <div className="hidden px-2 pb-1 text-xs font-medium text-ink-4 md:block">{g}</div>
          {ITEMS.filter((i) => i.group === g).map((i) => {
            const active = i.href === "/settings" ? path === "/settings" : path.startsWith(i.href);
            const Icon = i.icon;
            return (
              <Link
                key={i.href}
                href={i.href}
                className={cn(
                  "flex h-7 items-center gap-2 rounded-sm px-2 text-sm whitespace-nowrap",
                  active ? "bg-hover font-medium text-ink" : "text-ink-2 hover:bg-hover",
                )}
              >
                <Icon size={16} className="text-ink-3" /> {i.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
