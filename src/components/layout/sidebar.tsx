"use client";

/**
 * Primary navigation (Twenty-CRM style): sits directly on the grey app
 * frame, no card or border.
 *
 *   [A] Workspace name ⌄          [collapse]
 *   Search ⌘K · Inbox · Notifications
 *   Workspace ▸ Dashboard … AI Agents
 *   ─ bottom ─ Settings · current user
 *
 * Collapsible to an icon rail and drag-resizable on desktop (state lives in
 * WorkspaceProvider); a slide-in drawer on mobile.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  IconBell,
  IconBolt,
  IconBuildingSkyscraper,
  IconCheckbox,
  IconChevronDown,
  IconLayoutDashboard,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconMessageCircle,
  IconMoon,
  IconRobot,
  IconSearch,
  IconSettings,
  IconSitemap,
  IconSpeakerphone,
  IconSun,
  IconTargetArrow,
  IconUser,
  IconX,
  type IconProps,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import {
  NAV_CONSTRAINTS,
  useWorkspace,
} from "@/components/layout/workspace-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NavIcon = ComponentType<IconProps>;

interface NavItem {
  href: string;
  labelKey: string;
  icon: NavIcon;
  /** Shows a small "Beta" chip after the label. Informational only. */
  beta?: boolean;
}

export const workspaceNavItems: NavItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: IconLayoutDashboard },
  { href: "/contacts", labelKey: "contacts", icon: IconUser },
  { href: "/companies", labelKey: "companies", icon: IconBuildingSkyscraper },
  { href: "/pipelines", labelKey: "pipelines", icon: IconTargetArrow },
  { href: "/tasks", labelKey: "tasks", icon: IconCheckbox },
  { href: "/broadcasts", labelKey: "broadcasts", icon: IconSpeakerphone },
  { href: "/automations", labelKey: "automations", icon: IconBolt },
  { href: "/flows", labelKey: "flows", icon: IconSitemap, beta: true },
  { href: "/agents", labelKey: "aiAgents", icon: IconRobot },
];

export function isNavActive(pathname: string, href: string) {
  return (
    pathname === href ||
    (href !== "/dashboard" && pathname.startsWith(`${href}/`))
  );
}

function NavRow({
  href,
  label,
  icon: Icon,
  active = false,
  collapsed = false,
  onClick,
  trailing,
}: {
  href?: string;
  label: string;
  icon: NavIcon;
  active?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
  trailing?: ReactNode;
}) {
  const className = cn(
    "group/nav flex h-7 w-full items-center gap-2 rounded-sm px-1.5 text-[13px] transition-colors duration-75",
    active
      ? "bg-hover font-medium text-foreground"
      : "text-muted-foreground hover:bg-hover hover:text-foreground",
    collapsed && "justify-center px-0",
  );
  const content = (
    <>
      <Icon size={16} stroke={active ? 2 : 1.6} className="shrink-0" />
      {!collapsed && (
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      )}
      {!collapsed && trailing}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className={className}
        title={collapsed ? label : undefined}
        aria-current={active ? "page" : undefined}
        onClick={onClick}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      title={collapsed ? label : undefined}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

export function Sidebar() {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const { profile, account, accountRole, signOut } = useAuth();
  const { mode, setMode } = useTheme();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  const {
    navCollapsed,
    toggleNav,
    navWidth,
    setNavWidth,
    mobileNavOpen,
    setMobileNavOpen,
    openSearch,
  } = useWorkspace();
  const [sectionOpen, setSectionOpen] = useState(true);
  const [resizing, setResizing] = useState(false);
  const dragStart = useRef<{ x: number; w: number } | null>(null);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (navCollapsed) return;
      dragStart.current = { x: e.clientX, w: navWidth };
      setResizing(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [navCollapsed, navWidth],
  );
  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (dragStart.current) {
        setNavWidth(dragStart.current.w + (e.clientX - dragStart.current.x));
      }
    },
    [setNavWidth],
  );
  const onPointerUp = useCallback(() => {
    dragStart.current = null;
    setResizing(false);
  }, []);

  // The mobile drawer always shows labels, even if desktop is collapsed.
  const collapsed = navCollapsed && !mobileNavOpen;
  const workspaceName = account?.name || profile?.full_name || "Workspace";
  const workspaceInitial = (workspaceName.trim()[0] ?? "W").toUpperCase();
  const roleLabel = accountRole
    ? t(`role${accountRole[0].toUpperCase()}${accountRole.slice(1)}`)
    : "";

  return (
    <>
      {/* Mobile backdrop */}
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={() => setMobileNavOpen(false)}
        className={cn(
          "fixed inset-0 z-30 bg-black/30 transition-opacity duration-300 lg:hidden",
          mobileNavOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        aria-label={t("primaryNav")}
        style={{ width: collapsed ? NAV_CONSTRAINTS.collapsed : navWidth }}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col bg-frame lg:relative lg:z-0",
          "transition-[transform] duration-300 ease-in-out lg:translate-x-0",
          !resizing && "lg:transition-[width]",
          mobileNavOpen ? "translate-x-0 shadow-strong" : "-translate-x-full",
        )}
      >
        {/* Workspace switcher + collapse */}
        <div
          className={cn(
            "flex h-12 shrink-0 items-center gap-1 px-2",
            collapsed && "justify-center px-0",
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("openAccountMenu")}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1.5 py-1 text-left transition-colors hover:bg-hover focus:outline-none data-popup-open:bg-hover",
                collapsed && "flex-none justify-center px-1",
              )}
            >
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[4px] bg-foreground text-[11px] font-semibold text-background">
                {workspaceInitial}
              </span>
              {!collapsed && (
                <>
                  <span
                    className="min-w-0 truncate text-[13px] font-medium text-foreground"
                    title={workspaceName}
                  >
                    {workspaceName}
                  </span>
                  <IconChevronDown
                    size={14}
                    className="shrink-0 text-tertiary-foreground"
                  />
                </>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={6} className="min-w-60">
              <div className="px-2 py-1.5">
                <p className="truncate text-[13px] font-medium text-foreground">
                  {profile?.full_name ?? t("defaultUser")}
                </p>
                <p className="truncate text-xs text-tertiary-foreground">
                  {profile?.email ?? ""}
                  {roleLabel ? ` · ${roleLabel}` : ""}
                </p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/settings?tab=profile" />}>
                <IconUser size={16} />
                {t("menuProfile")}
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/settings" />}>
                <IconSettings size={16} />
                {t("menuSettings")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setMode(mode === "dark" ? "light" : "dark")}
              >
                {mode === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
                {mode === "dark" ? t("lightMode") : t("darkMode")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}>
                <IconLogout size={16} />
                {t("menuSignOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {!collapsed && (
            <button
              type="button"
              onClick={mobileNavOpen ? () => setMobileNavOpen(false) : toggleNav}
              aria-label={mobileNavOpen ? t("closeMenu") : t("collapse")}
              title={t("collapse")}
              className="flex size-7 shrink-0 items-center justify-center rounded-sm text-tertiary-foreground transition-colors hover:bg-hover hover:text-foreground"
            >
              {mobileNavOpen ? (
                <IconX size={16} />
              ) : (
                <IconLayoutSidebarLeftCollapse size={16} stroke={1.6} />
              )}
            </button>
          )}
        </div>

        <nav
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2",
            collapsed && "items-center px-1.5",
          )}
        >
          {collapsed && (
            <NavRow
              label={t("expand")}
              icon={IconLayoutSidebarLeftExpand}
              collapsed
              onClick={toggleNav}
            />
          )}
          <NavRow
            label={t("search")}
            icon={IconSearch}
            collapsed={collapsed}
            onClick={openSearch}
            trailing={
              <kbd className="rounded-[4px] border border-border px-1 text-[10px] text-tertiary-foreground">
                ⌘K
              </kbd>
            }
          />
          <NavRow
            href="/inbox"
            label={t("inbox")}
            icon={IconMessageCircle}
            active={isNavActive(pathname, "/inbox")}
            collapsed={collapsed}
            trailing={
              totalUnread > 0 ? (
                <span
                  aria-label={t("unreadConversations", { count: totalUnread })}
                  className="rounded-[4px] bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground"
                >
                  {totalUnread > 99 ? "99+" : totalUnread}
                </span>
              ) : null
            }
          />
          <NavRow
            href="/notifications"
            label={t("notifications")}
            icon={IconBell}
            active={isNavActive(pathname, "/notifications")}
            collapsed={collapsed}
            trailing={
              unreadNotifications > 0 ? (
                <span
                  aria-label={t("unreadNotifications", {
                    count: unreadNotifications,
                  })}
                  className="rounded-[4px] bg-hover-strong px-1 text-[10px] leading-4 font-semibold text-foreground"
                >
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              ) : null
            }
          />

          <div className="mt-3">
            {!collapsed && (
              <button
                type="button"
                onClick={() => setSectionOpen((v) => !v)}
                aria-expanded={sectionOpen}
                className="group/section flex h-6 w-full items-center gap-1 rounded-sm px-1.5 text-[11px] font-semibold text-light-foreground transition-colors hover:text-tertiary-foreground"
              >
                {t("workspaceSection")}
                <IconChevronDown
                  size={12}
                  className={cn(
                    "opacity-0 transition-transform duration-150 group-hover/section:opacity-100",
                    !sectionOpen && "-rotate-90",
                  )}
                />
              </button>
            )}
            <div
              className={cn(
                "grid transition-[grid-template-rows] duration-300 ease-in-out",
                sectionOpen || collapsed ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
              )}
            >
              <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden">
                {workspaceNavItems.map((item) => (
                  <NavRow
                    key={item.href}
                    href={item.href}
                    label={t(item.labelKey)}
                    icon={item.icon}
                    active={isNavActive(pathname, item.href)}
                    collapsed={collapsed}
                    trailing={
                      item.beta ? (
                        <span className="rounded-[4px] bg-hover px-1 text-[10px] leading-4 font-medium text-tertiary-foreground">
                          {t("beta")}
                        </span>
                      ) : null
                    }
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="mt-auto pt-3">
            <NavRow
              href="/settings"
              label={t("settings")}
              icon={IconSettings}
              active={isNavActive(pathname, "/settings")}
              collapsed={collapsed}
            />
            <div
              className={cn(
                "mt-1 flex items-center gap-2 px-1.5 py-1",
                collapsed && "justify-center px-0",
              )}
            >
              <Avatar className="size-5 shrink-0 rounded-[4px] after:rounded-[4px]">
                {profile?.avatar_url ? (
                  <AvatarImage src={profile.avatar_url} alt="" />
                ) : null}
                <AvatarFallback className="rounded-[4px] bg-hover-strong text-[10px] font-medium text-foreground">
                  {(profile?.full_name ?? profile?.email ?? "U")
                    .charAt(0)
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <span className="min-w-0 truncate text-[13px] text-muted-foreground">
                  {profile?.full_name ?? t("defaultUser")}
                </span>
              )}
            </div>
          </div>
        </nav>

        {!collapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("resize")}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => setNavWidth(NAV_CONSTRAINTS.default)}
            className="absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize lg:block"
          >
            <div
              className={cn(
                "mx-auto h-full w-px transition-colors",
                resizing
                  ? "bg-border-strong"
                  : "bg-transparent hover:bg-border-strong",
              )}
            />
          </div>
        )}
      </aside>
    </>
  );
}
