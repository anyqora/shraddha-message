"use client";

/**
 * Page chrome — the slim top bar above the content card, and the slot pages
 * use to put their own actions into it.
 *
 * ── API for pages ────────────────────────────────────────────────────────
 *
 *   import { PageActions } from "@/components/layout/page-chrome";
 *
 *   <PageActions title={optionalSubtitle}>
 *     <Button variant="ghost" size="sm">Import</Button>
 *     <Button variant="outline" size="sm"><IconPlus /> New contact</Button>
 *   </PageActions>
 *
 * Render <PageActions> anywhere inside the page (it renders nothing in
 * place). Its `children` appear at the right end of the top bar, on the same
 * line as the breadcrumb; `title` (optional, string or node) appears after the
 * page name as "Contacts / <title>", e.g. a record name on a detail page.
 * The slot is cleared when the component unmounts or the route changes, so
 * there is nothing to clean up.
 *
 * The breadcrumb itself (page icon + page name) comes from the route via
 * BREADCRUMBS below; add a row there when a new top-level section is added.
 *
 * ── Shell wiring ─────────────────────────────────────────────────────────
 * <PageChromeProvider> wraps the dashboard (inside WorkspaceProvider) and
 * <TopBar /> renders above <main> (see dashboard-shell.tsx).
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  IconBell,
  IconBolt,
  IconBuildingSkyscraper,
  IconCheckbox,
  IconLayoutDashboard,
  IconMenu2,
  IconMessageCircle,
  IconRobot,
  IconSearch,
  IconSettings,
  IconSitemap,
  IconSpeakerphone,
  IconTargetArrow,
  IconUser,
  type IconProps,
} from "@tabler/icons-react";
import { useWorkspace } from "@/components/layout/workspace-provider";

interface Breadcrumb {
  prefix: string;
  /** Key in the `Sidebar` i18n namespace. */
  key: string;
  icon: ComponentType<IconProps>;
}

const BREADCRUMBS: Breadcrumb[] = [
  { prefix: "/dashboard", key: "dashboard", icon: IconLayoutDashboard },
  { prefix: "/inbox", key: "inbox", icon: IconMessageCircle },
  { prefix: "/notifications", key: "notifications", icon: IconBell },
  { prefix: "/contacts", key: "contacts", icon: IconUser },
  { prefix: "/companies", key: "companies", icon: IconBuildingSkyscraper },
  { prefix: "/pipelines", key: "pipelines", icon: IconTargetArrow },
  { prefix: "/tasks", key: "tasks", icon: IconCheckbox },
  { prefix: "/broadcasts", key: "broadcasts", icon: IconSpeakerphone },
  { prefix: "/automations", key: "automations", icon: IconBolt },
  { prefix: "/flows", key: "flows", icon: IconSitemap },
  { prefix: "/agents", key: "aiAgents", icon: IconRobot },
  { prefix: "/settings", key: "settings", icon: IconSettings },
];

interface SlotState {
  actions: ReactNode;
  title: ReactNode;
}

interface StoredSlot extends SlotState {
  path: string;
}

type SetSlot = (next: Partial<SlotState>) => void;

const EMPTY: SlotState = { actions: null, title: null };

// Two contexts so pages that only *write* the slot (PageActions) don't
// re-render whenever the slot content changes.
const SlotContext = createContext<SlotState>(EMPTY);
const SetSlotContext = createContext<SetSlot | null>(null);

/**
 * Puts `children` (actions) and an optional `title` into the top bar for as
 * long as this component is mounted. Renders nothing in place.
 */
export function PageActions({
  children,
  title,
}: {
  children?: ReactNode;
  title?: ReactNode;
}) {
  const set = useContext(SetSlotContext);
  useEffect(() => {
    set?.({ actions: children ?? null, title: title ?? null });
    return () => set?.({ actions: null, title: null });
  }, [set, children, title]);
  return null;
}

export function PageChromeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [stored, setStored] = useState<StoredSlot>({ ...EMPTY, path: "" });

  // Content registered for a previous route is ignored, so a page that is
  // still unmounting can't leak its actions onto the next page.
  const slot = useMemo<SlotState>(
    () =>
      stored.path === pathname
        ? { actions: stored.actions, title: stored.title }
        : EMPTY,
    [stored, pathname],
  );

  const set = useMemo<SetSlot>(
    () => (next) =>
      setStored((prev) => ({
        ...(prev.path === pathname ? prev : { ...EMPTY }),
        ...next,
        path: pathname,
      })),
    [pathname],
  );

  return (
    <SetSlotContext.Provider value={set}>
      <SlotContext.Provider value={slot}>{children}</SlotContext.Provider>
    </SetSlotContext.Provider>
  );
}

function findBreadcrumb(pathname: string) {
  return BREADCRUMBS.find(
    (b) => pathname === b.prefix || pathname.startsWith(`${b.prefix}/`),
  );
}

/** Breadcrumb line (page icon + name [/ title]) with the page's actions. */
export function TopBar() {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const slot = useContext(SlotContext);
  const { setMobileNavOpen, openSearch } = useWorkspace();
  const crumb = findBreadcrumb(pathname);
  const Icon = crumb?.icon;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-2 lg:pl-0">
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        aria-label={t("openMenu")}
        className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover lg:hidden"
      >
        <IconMenu2 size={18} />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
        {Icon ? (
          <Icon
            size={16}
            stroke={1.6}
            className="shrink-0 text-tertiary-foreground"
          />
        ) : null}
        <span className="truncate font-medium text-foreground">
          {crumb ? t(crumb.key) : ""}
        </span>
        {slot.title ? (
          <>
            <span className="text-light-foreground">/</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {slot.title}
            </span>
          </>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {slot.actions}
        <button
          type="button"
          onClick={openSearch}
          aria-label={t("search")}
          className="flex size-8 items-center justify-center rounded-sm text-tertiary-foreground transition-colors hover:bg-hover hover:text-foreground lg:hidden"
        >
          <IconSearch size={16} />
        </button>
      </div>
    </header>
  );
}
