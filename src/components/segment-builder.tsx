"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IconPlus, IconTrash, IconUsers } from "@tabler/icons-react";
import type { SegmentRule } from "@/db/schema";
import { BASE_FIELDS, MONTHS, OPS, defaultRule, fieldKind, opNeedsValue } from "./segment-fields";
import { Notice } from "./ui";

type Opt = { id: string; name: string };

export function SegmentBuilder({
  segment,
  lists,
  users,
  customKeys,
  saved,
  action,
  preview,
}: {
  segment: { id: string; name: string; match: "all" | "any"; rules: SegmentRule[] } | null;
  lists: Opt[];
  users: Opt[];
  customKeys: string[];
  saved?: boolean;
  action: (s: unknown, fd: FormData) => Promise<{ ok: boolean; message: string }>;
  preview: (match: "all" | "any", rules: SegmentRule[]) => Promise<number>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [name, setName] = useState(segment?.name ?? "");
  const [match, setMatch] = useState<"all" | "any">(segment?.match ?? "all");
  const [rules, setRules] = useState<SegmentRule[]>(segment?.rules?.length ? segment.rules : [defaultRule("last_inbound")]);
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);

  const key = useMemo(() => JSON.stringify({ match, rules }), [match, rules]);
  useEffect(() => {
    let live = true;
    setCounting(true);
    const t = setTimeout(async () => {
      const n = await preview(match, rules).catch(() => -1);
      if (live) {
        setCount(n);
        setCounting(false);
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const fieldOptions: [string, string][] = [
    ...BASE_FIELDS.map((f) => [f.field, f.label] as [string, string]),
    ...customKeys.map((k) => [`custom.${k}`, `Field: ${k}`] as [string, string]),
  ];
  // keep a custom field that's no longer present in any contact selectable
  for (const r of rules) if (r.field.startsWith("custom.") && !fieldOptions.some(([f]) => f === r.field)) fieldOptions.push([r.field, `Field: ${r.field.slice(7)}`]);

  const update = (i: number, patch: Partial<SegmentRule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const valueInput = (r: SegmentRule, i: number) => {
    if (!opNeedsValue(r.field, r.op)) return null;
    const kind = fieldKind(r.field);
    const v = r.value ?? "";
    const set = (value: string) => update(i, { value });
    if (kind === "list")
      return (
        <select className="input" value={v} onChange={(e) => set(e.target.value)}>
          <option value="">Choose list…</option>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      );
    if (kind === "user")
      return (
        <select className="input" value={v} onChange={(e) => set(e.target.value)}>
          <option value="">Choose user…</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      );
    if (kind === "enum")
      return (
        <select className="input" value={v} onChange={(e) => set(e.target.value)}>
          {(BASE_FIELDS.find((f) => f.field === r.field)?.options ?? []).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      );
    if (kind === "month")
      return (
        <select className="input" value={v} onChange={(e) => set(e.target.value)}>
          {MONTHS.map((m, k) => <option key={m} value={String(k + 1)}>{m}</option>)}
        </select>
      );
    if ((kind === "date" || kind === "activity") && (r.op === "before" || r.op === "after"))
      return <input type="date" className="input" value={v} onChange={(e) => set(e.target.value)} />;
    if (kind === "date" || kind === "activity")
      return (
        <span className="flex items-center gap-1.5">
          <input type="number" min={0} className="input w-24" value={v} onChange={(e) => set(e.target.value)} />
          <span className="text-sm text-ink-3">days</span>
        </span>
      );
    return <input className="input" value={v} placeholder="Value" onChange={(e) => set(e.target.value)} />;
  };

  return (
    <form action={formAction} className="mx-auto max-w-3xl space-y-5">
      <input type="hidden" name="id" value={segment?.id ?? ""} />
      <input type="hidden" name="match" value={match} />
      <input type="hidden" name="rules" value={JSON.stringify(rules)} />
      {state && !state.ok && <Notice tone="error">{state.message}</Notice>}
      {saved && !state && <Notice tone="success">Segment saved.</Notice>}

      <label className="block">
        <span className="label">Segment name</span>
        <input name="name" className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Active in last 30 days" />
      </label>

      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Contacts matching</span>
          <select className="input h-7 w-auto" value={match} onChange={(e) => setMatch(e.target.value === "any" ? "any" : "all")}>
            <option value="all">all</option>
            <option value="any">any</option>
          </select>
          <span>of these rules</span>
        </div>

        {rules.map((r, i) => {
          const kind = fieldKind(r.field);
          return (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-10 shrink-0 text-xs text-ink-3">{i === 0 ? "Where" : match === "all" ? "and" : "or"}</span>
              <select className="input w-52" value={r.field} onChange={(e) => setRules(rules.map((x, j) => (j === i ? defaultRule(e.target.value) : x)))}>
                {fieldOptions.map(([f, l]) => <option key={f} value={f}>{l}</option>)}
              </select>
              <select className="input w-48" value={r.op} onChange={(e) => update(i, { op: e.target.value })}>
                {OPS[kind].map(([o, l]) => <option key={o} value={o}>{l}</option>)}
              </select>
              <div className="min-w-40 flex-1">{valueInput(r, i)}</div>
              <button type="button" className="btn btn-ghost" aria-label="Remove rule" onClick={() => setRules(rules.filter((_, j) => j !== i))}>
                <IconTrash size={14} />
              </button>
            </div>
          );
        })}
        {!rules.length && <p className="text-sm text-ink-3">No rules — the segment includes every contact.</p>}
        <button type="button" className="btn" onClick={() => setRules([...rules, defaultRule()])}>
          <IconPlus size={14} /> Add rule
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary h-8" disabled={pending}>{pending ? "Saving…" : "Save segment"}</button>
        <span className="flex items-center gap-1.5 text-sm text-ink-2">
          <IconUsers size={14} className="text-ink-3" />
          {count === null || counting ? "Counting…" : count < 0 ? "Couldn't count — check the rules" : `${count.toLocaleString("en-IN")} matching contacts`}
        </span>
        {segment?.id && (
          <Link href={`/contacts?segment=${segment.id}`} className="ml-auto text-sm text-accent hover:underline">View contacts</Link>
        )}
      </div>
    </form>
  );
}
