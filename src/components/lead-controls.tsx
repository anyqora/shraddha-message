"use client";

import { useState, useTransition } from "react";
import { IconArrowRight, IconLoader2, IconTrash } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export { LEAD_STATUS_META } from "@/lib/lead-status";
import { LEAD_STATUS_META } from "@/lib/lead-status";

type Res = { ok: boolean; message?: string };

/** Status chip that is also a select. */
export function LeadStatusSelect({ status, action }: { status: string; action: (status: string) => Promise<Res> }) {
  const [v, setV] = useState(status);
  const [pending, start] = useTransition();
  const meta = LEAD_STATUS_META[v] ?? LEAD_STATUS_META.new;
  return (
    <select
      value={v}
      disabled={pending}
      aria-label="Lead status"
      onChange={(e) => {
        const next = e.target.value;
        const prev = v;
        setV(next);
        start(async () => {
          const r = await action(next).catch(() => ({ ok: false, message: "Couldn’t update." }));
          if (!r.ok) {
            setV(prev);
            alert(r.message ?? "Couldn’t update.");
          }
        });
      }}
      className={cn("h-5 cursor-pointer appearance-none rounded-sm border-0 px-1.5 text-xs font-medium outline-none disabled:opacity-60", meta.cls)}
    >
      {Object.entries(LEAD_STATUS_META).map(([k, m]) => (
        <option key={k} value={k} className="bg-white text-ink">{m.label}</option>
      ))}
    </select>
  );
}

export function LeadAssigneeSelect({
  value,
  users,
  action,
}: {
  value: string | null;
  users: { id: string; name: string }[];
  action: (userId: string | null) => Promise<Res>;
}) {
  const [v, setV] = useState(value ?? "");
  const [pending, start] = useTransition();
  return (
    <select
      value={v}
      disabled={pending}
      aria-label="Assigned to"
      className="h-6 w-full max-w-40 truncate rounded-sm border border-transparent bg-transparent px-1 text-sm text-ink-2 hover:border-line focus:border-line"
      onChange={(e) => {
        const next = e.target.value;
        const prev = v;
        setV(next);
        start(async () => {
          const r = await action(next || null).catch(() => ({ ok: false, message: "Couldn’t update." }));
          if (!r.ok) {
            setV(prev);
            alert(r.message ?? "Couldn’t update.");
          }
        });
      }}
    >
      <option value="">Unassigned</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>{u.name}</option>
      ))}
    </select>
  );
}

export function LeadTitleInput({ title, action }: { title: string; action: (t: string) => Promise<Res> }) {
  const [v, setV] = useState(title);
  const [pending, start] = useTransition();
  return (
    <input
      className="input"
      value={v}
      maxLength={191}
      disabled={pending}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v.trim() === title) return;
        start(async () => {
          const r = await action(v);
          if (!r.ok) {
            setV(title);
            alert(r.message ?? "Couldn’t update.");
          }
        });
      }}
    />
  );
}

export function ConvertLeadButton({ action, disabled }: { action: () => Promise<{ ok: false; message: string } | void>; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            const r = await action();
            if (r && !r.ok) setErr(r.message);
          })
        }
      >
        {pending ? <IconLoader2 size={14} className="animate-spin" /> : <IconArrowRight size={14} />} Convert to deal
      </button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}

export function DeleteLeadButton({ action }: { action: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-ghost text-danger"
      disabled={pending}
      onClick={() => {
        if (confirm("Delete this lead? This can’t be undone.")) start(() => action());
      }}
    >
      {pending ? <IconLoader2 size={14} className="animate-spin" /> : <IconTrash size={14} />} Delete
    </button>
  );
}
