"use client";

/**
 * Search (⌘K) — the command panel shown in the right side panel.
 *
 * Without a query it lists commands: Create (contact / company / task /
 * broadcast, for roles that can write), Navigate (every section) and
 * Preferences (light/dark). Typing filters the commands by label; from two
 * characters on it also searches contacts (name/phone/email), companies
 * (name/domain), tasks (title) and deals (title), and picking a result opens
 * that record in the side panel.
 */

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import {
  IconBell,
  IconBolt,
  IconBuildingSkyscraper,
  IconCheckbox,
  IconLayoutDashboard,
  IconMessageCircle,
  IconMoon,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSpeakerphone,
  IconSun,
  IconTargetArrow,
  IconUser,
  type IconProps,
} from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import { useTheme } from "@/hooks/use-theme";
import { useCan } from "@/hooks/use-can";
import {
  useWorkspace,
  type WorkspaceObject,
} from "@/components/layout/workspace-provider";
import { cn } from "@/lib/utils";

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ComponentType<IconProps>;
  /** Render a letter avatar instead of the icon. */
  avatar?: "round" | "square";
  run: () => void;
}

/** Escape LIKE wildcards and strip characters that break PostgREST `or()`. */
function sanitizeQuery(q: string) {
  return q
    .replace(/[%_\\]/g, (c) => `\\${c}`)
    .replace(/[,()"]/g, " ")
    .trim();
}

export function SearchPanel() {
  const router = useRouter();
  const { mode, setMode } = useTheme();
  const canWrite = useCan("send-messages");
  const { openRecord, openNewRecord, closePanel } = useWorkspace();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Command[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => {
      router.push(href);
      closePanel();
    };
    return [
      ...(canWrite
        ? [
            {
              id: "new-contact",
              group: "Create",
              label: "Create contact",
              icon: IconPlus,
              run: () => openNewRecord("contacts"),
            },
            {
              id: "new-company",
              group: "Create",
              label: "Create company",
              icon: IconPlus,
              run: () => openNewRecord("companies"),
            },
            {
              id: "new-task",
              group: "Create",
              label: "Create task",
              icon: IconPlus,
              run: () => openNewRecord("tasks"),
            },
            {
              id: "new-broadcast",
              group: "Create",
              label: "New broadcast",
              icon: IconSpeakerphone,
              run: go("/broadcasts/new"),
            },
          ]
        : []),
      { id: "nav-dashboard", group: "Navigate", label: "Go to Dashboard", icon: IconLayoutDashboard, run: go("/dashboard") },
      { id: "nav-inbox", group: "Navigate", label: "Go to Inbox", icon: IconMessageCircle, run: go("/inbox") },
      { id: "nav-contacts", group: "Navigate", label: "Go to Contacts", icon: IconUser, run: go("/contacts") },
      { id: "nav-companies", group: "Navigate", label: "Go to Companies", icon: IconBuildingSkyscraper, run: go("/companies") },
      { id: "nav-tasks", group: "Navigate", label: "Go to Tasks", icon: IconCheckbox, run: go("/tasks") },
      { id: "nav-pipelines", group: "Navigate", label: "Go to Pipelines", icon: IconTargetArrow, run: go("/pipelines") },
      { id: "nav-broadcasts", group: "Navigate", label: "Go to Broadcasts", icon: IconSpeakerphone, run: go("/broadcasts") },
      { id: "nav-automations", group: "Navigate", label: "Go to Automations", icon: IconBolt, run: go("/automations") },
      { id: "nav-notifications", group: "Navigate", label: "Go to Notifications", icon: IconBell, run: go("/notifications") },
      { id: "nav-settings", group: "Navigate", label: "Go to Settings", icon: IconSettings, run: go("/settings") },
      {
        id: "theme",
        group: "Preferences",
        label: mode === "dark" ? "Switch to light mode" : "Switch to dark mode",
        icon: mode === "dark" ? IconSun : IconMoon,
        run: () => setMode(mode === "dark" ? "light" : "dark"),
      },
    ];
  }, [canWrite, mode, setMode, router, closePanel, openNewRecord]);

  // Debounced record search.
  useEffect(() => {
    const q = sanitizeQuery(query);
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        if (q.length < 2) {
          if (!cancelled) setResults([]);
          return;
        }
        const db = createClient();
        const like = `*${q}*`;
        const open = (object: WorkspaceObject, id: string) => () =>
          openRecord(object, id);
        const [contacts, companies, tasks, deals] = await Promise.all([
          db
            .from("contacts")
            .select("id, name, phone, email")
            .or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
            .limit(6),
          db
            .from("companies")
            .select("id, name, domain")
            .or(`name.ilike.${like},domain.ilike.${like}`)
            .limit(5),
          db.from("tasks").select("id, title, status").ilike("title", like).limit(5),
          db
            .from("deals")
            .select("id, title, value, currency")
            .ilike("title", like)
            .limit(5),
        ]);
        if (cancelled) return;
        type ContactRow = { id: string; name: string | null; phone: string; email: string | null };
        type CompanyRow = { id: string; name: string; domain: string | null };
        type TaskRow = { id: string; title: string; status: string };
        type DealRow = { id: string; title: string; value: number | string | null; currency: string | null };
        setResults([
          ...((contacts.data ?? []) as ContactRow[]).map((c) => ({
            id: `c${c.id}`,
            group: "Contacts",
            label: c.name || c.phone,
            hint: c.name ? c.phone : (c.email ?? undefined),
            icon: IconUser,
            avatar: "round" as const,
            run: open("contacts", c.id),
          })),
          ...((companies.data ?? []) as CompanyRow[]).map((c) => ({
            id: `co${c.id}`,
            group: "Companies",
            label: c.name,
            hint: c.domain ?? undefined,
            icon: IconBuildingSkyscraper,
            avatar: "square" as const,
            run: open("companies", c.id),
          })),
          ...((tasks.data ?? []) as TaskRow[]).map((t) => ({
            id: `t${t.id}`,
            group: "Tasks",
            label: t.title,
            hint: t.status.replace("_", " "),
            icon: IconCheckbox,
            run: open("tasks", t.id),
          })),
          ...((deals.data ?? []) as DealRow[]).map((d) => ({
            id: `d${d.id}`,
            group: "Deals",
            label: d.title,
            hint: `${Number(d.value).toLocaleString()} ${d.currency ?? ""}`,
            icon: IconTargetArrow,
            run: open("deals", d.id),
          })),
        ]);
        setActive(0);
      },
      q.length < 2 ? 0 : 180,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, openRecord]);

  const filtered = commands.filter(
    (c) => !query || c.label.toLowerCase().includes(query.toLowerCase()),
  );
  const items = [...results, ...filtered];
  const groups = items.reduce<Array<[string, Command[]]>>((acc, item) => {
    const g = acc.find(([name]) => name === item.group);
    if (g) g[1].push(item);
    else acc.push([item.group, [item]]);
    return acc;
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3">
        <IconSearch size={16} className="text-tertiary-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              items[active]?.run();
            } else if (e.key === "Escape") {
              closePanel();
            }
          }}
          placeholder="Search or type a command…"
          className="h-11 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-light-foreground"
        />
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {query.trim().length >= 2 &&
          results.length === 0 &&
          filtered.length === 0 && (
            <p className="px-2 py-3 text-[13px] text-tertiary-foreground">
              No results for “{query}”.
            </p>
          )}
        {groups.map(([group, groupItems]) => (
          <div key={group} className="mb-2">
            <p className="px-2 pt-1 pb-1 text-[11px] font-semibold text-light-foreground">
              {group}
            </p>
            {groupItems.map((item) => {
              const index = items.indexOf(item);
              const Icon = item.icon;
              const isActive = index === active;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-active={isActive}
                  onMouseMove={() => setActive(index)}
                  onClick={item.run}
                  className={cn(
                    "flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px]",
                    isActive ? "bg-hover text-foreground" : "text-muted-foreground",
                  )}
                >
                  {item.avatar ? (
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center text-[10px] font-semibold",
                        item.avatar === "round"
                          ? "rounded-full bg-primary-soft-2 text-primary"
                          : "rounded-[4px] bg-hover-strong text-muted-foreground",
                      )}
                    >
                      {(item.label.trim()[0] ?? "?").toUpperCase()}
                    </span>
                  ) : (
                    <Icon
                      size={16}
                      stroke={1.6}
                      className="shrink-0 text-tertiary-foreground"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {item.label}
                  </span>
                  {item.hint && (
                    <span className="shrink-0 truncate text-[12px] text-tertiary-foreground">
                      {item.hint}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-border px-3 text-[11px] text-light-foreground">
        <span>↑↓ to navigate</span>
        <span>↵ to open</span>
        <span>esc to close</span>
      </div>
    </div>
  );
}
