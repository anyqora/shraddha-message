"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { IconCake, IconHeart, IconLoader2, IconPlayerStop, IconSearch, IconTrash, IconUserPlus, IconUsers, IconX } from "@tabler/icons-react";
import type { DripListOption, DripTemplateOption } from "@/app/(app)/drips/data";
import { Notice } from "./ui";
import { AutomationSwitch } from "./automation-controls";
import { DripTemplateFields } from "./drip-template-fields";

type Result = { ok: boolean; message: string };

export function DeleteSequenceButton({ name, action }: { name: string; action: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      title="Delete sequence"
      className="btn btn-ghost h-6 px-1 text-ink-3 hover:text-danger"
      disabled={pending}
      onClick={() => {
        if (confirm(`Delete sequence “${name}” and all its enrollments?`)) start(() => action());
      }}
    >
      {pending ? <IconLoader2 size={14} className="animate-spin" /> : <IconTrash size={14} />}
    </button>
  );
}

/* ------------------------------------------------------------- wishes */

export type WishValue = { templateId: string; body: string[]; sendHour: number; active: boolean; lastRunDate: string | null };

const hourLabel = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? "AM" : "PM"}`;

export function DripWishCard({
  kind,
  value,
  templates,
  contactsWithDate,
  action,
}: {
  kind: "birthday" | "anniversary";
  value: WishValue;
  templates: DripTemplateOption[];
  contactsWithDate: number;
  action: (payload: string) => Promise<Result>;
}) {
  const [v, setV] = useState(value);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const title = kind === "birthday" ? "Birthday wishes" : "Anniversary wishes";
  const save = (next = v) =>
    start(async () => {
      const r = await action(JSON.stringify(next));
      setResult(r);
      if (!r.ok && next.active !== value.active) setV({ ...next, active: value.active });
    });

  return (
    <div className="card p-3">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-ink-3">{kind === "birthday" ? <IconCake size={16} /> : <IconHeart size={16} />}</span>
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="text-xs text-ink-3">· {contactsWithDate} contact{contactsWithDate === 1 ? "" : "s"} with a date</span>
        <label className="ml-auto flex items-center gap-2 text-sm text-ink-2">
          Active
          <AutomationSwitch
            checked={v.active}
            disabled={pending}
            label="Active"
            onChange={(active) => {
              const next = { ...v, active };
              setV(next);
              save(next);
            }}
          />
        </label>
      </div>
      <div className="space-y-3">
        <DripTemplateFields templates={templates} templateId={v.templateId} body={v.body} onChange={(t) => setV({ ...v, ...t })} />
        <label className="block">
          <span className="label">Send at (IST)</span>
          <select className="input w-40" value={v.sendHour} onChange={(e) => setV({ ...v, sendHour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
        </label>
        {v.lastRunDate && <div className="text-xs text-ink-3">Last sent for {v.lastRunDate}.</div>}
        {result && <Notice tone={result.ok ? "success" : "error"}>{result.message}</Notice>}
        <div className="flex justify-end">
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => save()}>
            {pending && <IconLoader2 size={14} className="animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- enrolling */

type Found = { id: string; name: string; phone: string; optedOut: boolean };

export function DripEnrollPanel({
  lists,
  enrollList,
  enrollSelected,
  search,
}: {
  lists: DripListOption[];
  enrollList: (listId: string) => Promise<Result>;
  enrollSelected: (ids: string[]) => Promise<Result>;
  search: (q: string) => Promise<Found[]>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "list" | "contacts">("");
  const [listId, setListId] = useState("");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [picked, setPicked] = useState<Found[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (mode !== "contacts" || !q.trim()) {
      setFound([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => search(q).then((r) => live && setFound(r)).catch(() => {}), 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, mode, search]);

  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) {
        setPicked([]);
        router.refresh();
      }
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" onClick={() => setMode(mode === "list" ? "" : "list")}><IconUsers size={14} /> Enroll list…</button>
        <button type="button" className="btn" onClick={() => setMode(mode === "contacts" ? "" : "contacts")}><IconUserPlus size={14} /> Enroll contacts…</button>
      </div>
      {mode === "list" && (
        <div className="card flex flex-wrap items-center gap-2 p-3">
          <select className="input w-64" value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">Choose a list…</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <button type="button" className="btn btn-primary" disabled={!listId || pending} onClick={() => run(() => enrollList(listId))}>
            {pending && <IconLoader2 size={14} className="animate-spin" />} Enroll
          </button>
          <span className="text-xs text-ink-3">Already-enrolled and opted-out contacts are skipped.</span>
        </div>
      )}
      {mode === "contacts" && (
        <div className="card space-y-2 p-3">
          <div className="relative">
            <IconSearch size={14} className="absolute top-2 left-2 text-ink-4" />
            <input className="input pl-7" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone…" />
          </div>
          {found.length > 0 && (
            <div className="max-h-48 overflow-auto rounded-sm border border-line">
              {found.map((c) => {
                const on = picked.some((p) => p.id === c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={c.optedOut}
                    className="flex w-full items-center justify-between px-2 py-1 text-left text-sm hover:bg-hover disabled:opacity-50"
                    onClick={() => setPicked(on ? picked.filter((p) => p.id !== c.id) : [...picked, c])}
                  >
                    <span className="truncate">{c.name || `+${c.phone}`} <span className="text-ink-3">+{c.phone}</span></span>
                    <span className="text-xs text-ink-3">{c.optedOut ? "Opted out" : on ? "Selected" : "Add"}</span>
                  </button>
                );
              })}
            </div>
          )}
          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {picked.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 rounded-sm bg-hover px-1.5 py-0.5 text-xs">
                  {p.name || `+${p.phone}`}
                  <button type="button" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}><IconX size={12} /></button>
                </span>
              ))}
            </div>
          )}
          <button type="button" className="btn btn-primary" disabled={!picked.length || pending} onClick={() => run(() => enrollSelected(picked.map((p) => p.id)))}>
            {pending && <IconLoader2 size={14} className="animate-spin" />} Enroll {picked.length || ""} selected
          </button>
        </div>
      )}
      {result && <Notice tone={result.ok ? "success" : "error"}>{result.message}</Notice>}
    </div>
  );
}

export function DripEnrollmentActions({ canStop, stop, remove }: { canStop: boolean; stop: () => Promise<void>; remove: () => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-0.5">
      {canStop && (
        <button type="button" title="Stop" className="btn btn-ghost h-6 px-1 text-ink-3" disabled={pending} onClick={() => start(() => stop())}>
          <IconPlayerStop size={14} />
        </button>
      )}
      <button
        type="button"
        title="Remove (lets the contact be enrolled again)"
        className="btn btn-ghost h-6 px-1 text-ink-3 hover:text-danger"
        disabled={pending}
        onClick={() => {
          if (confirm("Remove this enrollment? The contact can then be enrolled again from the start.")) start(() => remove());
        }}
      >
        {pending ? <IconLoader2 size={14} className="animate-spin" /> : <IconTrash size={14} />}
      </button>
    </div>
  );
}
