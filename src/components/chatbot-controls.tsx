"use client";

import { useActionState, useState, useTransition } from "react";
import { IconCalendarPlus, IconForms, IconLoader2, IconSparkles, IconTrash } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Notice } from "./ui";

type Result = { ok: boolean; message: string } | null;

export function ChatbotSwitch({ checked, onChange, disabled, name, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; name?: string; label?: string }) {
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
      {name && checked && <input type="hidden" name={name} value="on" />}
      <span className={cn("inline-block size-3 rounded-full bg-white shadow transition-transform", checked ? "translate-x-3.5" : "translate-x-0.5")} />
    </button>
  );
}

export function BotSettingsForm({
  action,
  enabled,
  pauseHours,
}: {
  action: (s: unknown, fd: FormData) => Promise<Result>;
  enabled: boolean;
  pauseHours: number;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [on, setOn] = useState(enabled);
  return (
    <form action={formAction} className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          <ChatbotSwitch checked={on} onChange={setOn} name="botEnabled" label="Bot enabled" />
          <span className="font-medium text-ink">Bot is {on ? "ON" : "OFF"}</span>
          <span className="text-ink-3">{on ? "— auto-replies to incoming messages" : "— no automatic replies"}</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          Pause bot for
          <input name="botPauseHours" type="number" min={1} max={720} defaultValue={pauseHours} className="input h-7 w-16" />
          hours after an agent replies / after handoff
        </label>
        <button className="btn btn-primary ml-auto" disabled={pending}>
          {pending && <IconLoader2 size={14} className="animate-spin" />} Save
        </button>
      </div>
      {state && <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice>}
    </form>
  );
}

export function RuleActiveToggle({ active, action }: { active: boolean; action: (active: boolean) => Promise<void> }) {
  const [on, setOn] = useState(active);
  const [pending, start] = useTransition();
  return (
    <ChatbotSwitch
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

export function DeleteRuleButton({ name, action }: { name: string; action: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      title="Delete rule"
      className="btn btn-ghost h-6 px-1 text-ink-3 hover:text-[#e5484d]"
      disabled={pending}
      onClick={() => {
        if (confirm(`Delete rule “${name}”? Options that lead to it will be unlinked.`)) start(() => action());
      }}
    >
      {pending ? <IconLoader2 size={14} className="animate-spin" /> : <IconTrash size={14} />}
    </button>
  );
}

export function StarterBotButton({ action }: { action: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn btn-primary" disabled={pending} onClick={() => start(() => action())}>
      {pending ? <IconLoader2 size={14} className="animate-spin" /> : <IconSparkles size={14} />} Create starter bot
    </button>
  );
}

/** Adds a ready-made group of steps (lead form / booking) to the bot. */
export function RecipeButton({ action, label, kind }: { action: () => Promise<void>; label: string; kind: "lead" | "book" }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      disabled={pending}
      title={kind === "lead" ? "Adds: ask name → requirement → city → save lead" : "Adds: ask name → offer appointment slots"}
      onClick={() => {
        if (!confirm(`Add the “${label}” recipe? It creates new steps you can edit afterwards.`)) return;
        start(async () => {
          await action();
          setDone(true);
        });
      }}
    >
      {pending ? <IconLoader2 size={14} className="animate-spin" /> : kind === "lead" ? <IconForms size={14} /> : <IconCalendarPlus size={14} />}
      {done ? `${label} added` : `+ ${label}`}
    </button>
  );
}
