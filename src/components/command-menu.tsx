"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconSearch,
  IconUser,
  IconTemplate,
  IconSpeakerphone,
  IconList,
  IconArrowRight,
  IconPlus,
  IconUpload,
  IconLayoutDashboard,
  IconMessageCircle,
  IconSettings,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

type Item = { key: string; group: string; label: string; hint?: string; href: string; icon: React.ReactNode };

const STATIC: Item[] = [
  { key: "go-dash", group: "Navigate", label: "Go to Dashboard", href: "/", icon: <IconLayoutDashboard size={16} /> },
  { key: "go-inbox", group: "Navigate", label: "Go to Inbox", href: "/inbox", icon: <IconMessageCircle size={16} /> },
  { key: "go-contacts", group: "Navigate", label: "Go to Contacts", href: "/contacts", icon: <IconUser size={16} /> },
  { key: "go-lists", group: "Navigate", label: "Go to Lists", href: "/lists", icon: <IconList size={16} /> },
  { key: "go-templates", group: "Navigate", label: "Go to Templates", href: "/templates", icon: <IconTemplate size={16} /> },
  { key: "go-campaigns", group: "Navigate", label: "Go to Campaigns", href: "/campaigns", icon: <IconSpeakerphone size={16} /> },
  { key: "go-companies", group: "Navigate", label: "Go to Companies", href: "/companies", icon: <IconList size={16} /> },
  { key: "go-deals", group: "Navigate", label: "Go to Deals", href: "/deals", icon: <IconList size={16} /> },
  { key: "go-tasks", group: "Navigate", label: "Go to Tasks", href: "/tasks", icon: <IconList size={16} /> },
  { key: "go-chatbot", group: "Navigate", label: "Go to Chatbot", href: "/chatbot", icon: <IconMessageCircle size={16} /> },
  { key: "go-ai", group: "Navigate", label: "Go to AI Assistant", href: "/ai", icon: <IconMessageCircle size={16} /> },
  { key: "go-settings", group: "Navigate", label: "Go to Settings", href: "/settings", icon: <IconSettings size={16} /> },
  { key: "new-contact", group: "Create", label: "New contact", href: "/contacts/new", icon: <IconPlus size={16} /> },
  { key: "import", group: "Create", label: "Import contacts", href: "/contacts/import", icon: <IconUpload size={16} /> },
  { key: "new-campaign", group: "Create", label: "New campaign", href: "/campaigns/new", icon: <IconPlus size={16} /> },
  { key: "new-template", group: "Create", label: "New template", href: "/templates/new", icon: <IconPlus size={16} /> },
];

export function useCommandMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

export function CommandMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Item[]>([]);
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setRemote([]);
      setIdx(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    if (!q.trim()) return setRemote([]);
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        const d = await r.json();
        setRemote([
          ...(d.contacts ?? []).map((c: any) => ({ key: "c" + c.id, group: "Contacts", label: c.name || `+${c.phone}`, hint: c.name ? `+${c.phone}` : "", href: `/contacts/${c.id}`, icon: <IconUser size={16} /> })),
          ...(d.lists ?? []).map((l: any) => ({ key: "l" + l.id, group: "Lists", label: l.name, href: `/lists/${l.id}`, icon: <IconList size={16} /> })),
          ...(d.campaigns ?? []).map((c: any) => ({ key: "k" + c.id, group: "Campaigns", label: c.name, hint: c.status, href: `/campaigns/${c.id}`, icon: <IconSpeakerphone size={16} /> })),
          ...(d.templates ?? []).map((t: any) => ({ key: "t" + t.id, group: "Templates", label: t.name, hint: t.status.toLowerCase(), href: `/templates`, icon: <IconTemplate size={16} /> })),
        ]);
        setIdx(0);
      } catch {}
    }, 150);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    const local = STATIC.filter((i) => !s || i.label.toLowerCase().includes(s));
    return [...remote, ...local];
  }, [q, remote]);

  if (!open) return null;
  const go = (i: Item) => {
    onClose();
    router.push(i.href);
  };
  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[12vh]" onMouseDown={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-line bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-3">
          <IconSearch size={16} className="text-ink-3" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter" && items[idx]) go(items[idx]);
            }}
            placeholder="Search contacts, campaigns, templates… or type a command"
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-4"
          />
          <kbd className="rounded-sm border border-line px-1 text-[11px] text-ink-3">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-auto p-1">
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            return (
              <li key={it.key}>
                {head && <div className="px-2 pt-2 pb-1 text-xs font-medium text-ink-3">{head}</div>}
                <button
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => go(it)}
                  className={cn("flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm", i === idx ? "bg-hover text-ink" : "text-ink-2")}
                >
                  <span className="text-ink-3">{it.icon}</span>
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="text-xs text-ink-3">{it.hint}</span>}
                  {i === idx && <IconArrowRight size={14} className="text-ink-3" />}
                </button>
              </li>
            );
          })}
          {!items.length && <li className="px-3 py-6 text-center text-sm text-ink-3">No results</li>}
        </ul>
      </div>
    </div>
  );
}
