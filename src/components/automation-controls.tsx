"use client";

import { useState, useTransition } from "react";
import { IconClock, IconLoader2, IconMessage, IconPlaylistAdd, IconTrash } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export function AutomationSwitch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", checked ? "bg-accent" : "bg-line-strong")}
    >
      <span className={cn("inline-block size-3 rounded-full bg-white shadow transition-transform", checked ? "translate-x-3.5" : "translate-x-0.5")} />
    </button>
  );
}

export function AutomationActiveToggle({ active, action }: { active: boolean; action: (active: boolean) => Promise<void> }) {
  const [on, setOn] = useState(active);
  const [pending, start] = useTransition();
  return (
    <AutomationSwitch
      checked={on}
      disabled={pending}
      label="Active"
      onChange={(v) => {
        setOn(v);
        start(async () => {
          try {
            await action(v);
          } catch {
            setOn(!v);
          }
        });
      }}
    />
  );
}

export function DeleteAutomationButton({ name, action }: { name: string; action: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      title="Delete automation"
      className="btn btn-ghost h-6 px-1 text-ink-3 hover:text-danger"
      disabled={pending}
      onClick={() => {
        if (confirm(`Delete automation “${name}” and its run history?`)) start(() => action());
      }}
    >
      {pending ? <IconLoader2 size={14} className="animate-spin" /> : <IconTrash size={14} />}
    </button>
  );
}

type RecipeKey = "welcome" | "interested" | "followup";
const RECIPES: { key: RecipeKey; title: string; flow: string; icon: React.ReactNode }[] = [
  { key: "welcome", title: "Welcome new contacts", flow: "New contact → send a welcome text", icon: <IconMessage size={16} /> },
  { key: "interested", title: "Tag interested leads", flow: "Message has “price” / “interested” → add to Interested list → task “Call {{name}}”", icon: <IconPlaylistAdd size={16} /> },
  { key: "followup", title: "Follow-up after 1 day", flow: "Added to Interested → wait 1 day → send a follow-up text", icon: <IconClock size={16} /> },
];

export function AutomationRecipes({ action }: { action: (key: RecipeKey) => Promise<void> }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<RecipeKey | null>(null);
  return (
    <div className="grid w-full max-w-3xl gap-2 text-left sm:grid-cols-3">
      {RECIPES.map((r) => (
        <button
          key={r.key}
          type="button"
          disabled={pending}
          onClick={() => {
            setBusy(r.key);
            start(() => action(r.key));
          }}
          className="card flex flex-col gap-1.5 p-3 text-left transition-colors hover:border-accent hover:bg-accent-soft/40 disabled:opacity-60"
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <span className="text-accent">{pending && busy === r.key ? <IconLoader2 size={16} className="animate-spin" /> : r.icon}</span>
            {r.title}
          </span>
          <span className="text-xs leading-4 text-ink-3">{r.flow}</span>
        </button>
      ))}
    </div>
  );
}
