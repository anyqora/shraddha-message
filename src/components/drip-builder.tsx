"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IconArrowDown, IconArrowUp, IconClock, IconLoader2, IconMessage, IconPlus, IconTemplate, IconTrash } from "@tabler/icons-react";
import type { DripStep } from "@/db/schema";
import type { DripListOption, DripTemplateOption } from "@/app/(app)/drips/data";
import { SAMPLE_CONTACT, cumulativeHours, dayLabel, fillPlaceholders, validateSteps } from "@/app/(app)/drips/shared";
import { cn } from "@/lib/utils";
import { Chip, Field, Notice } from "./ui";
import { AutomationSwitch } from "./automation-controls";
import { DRIP_PLACEHOLDER_HINT, DripPreview, DripTemplateFields } from "./drip-template-fields";

type Item = { key: string; step: DripStep };
let seq = 0;
const k = () => `d${++seq}`;

const DEFAULT_STEPS: DripStep[] = [
  { delayHours: 0, kind: "template", templateId: "", body: [] },
  { delayHours: 48, kind: "template", templateId: "", body: [] },
  { delayHours: 96, kind: "template", templateId: "", body: [] },
];

export function DripBuilder({
  sequence,
  templates,
  lists,
  action,
}: {
  sequence?: { id: string; name: string; listId: string | null; steps: DripStep[]; stopOnReply: boolean; active: boolean };
  templates: DripTemplateOption[];
  lists: DripListOption[];
  action: (id: string | null, payload: string) => Promise<{ ok: boolean; message: string; id?: string }>;
}) {
  const router = useRouter();
  const [name, setName] = useState(sequence?.name ?? "");
  const [listId, setListId] = useState(sequence?.listId ?? "");
  const [stopOnReply, setStopOnReply] = useState(sequence?.stopOnReply ?? true);
  const [active, setActive] = useState(sequence?.active ?? true);
  const [items, setItems] = useState<Item[]>(() => (sequence?.steps.length ? sequence.steps : DEFAULT_STEPS).map((step) => ({ key: k(), step })));
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  const steps = items.map((i) => i.step);
  const cum = cumulativeHours(steps);
  const tplVars = new Map(templates.map((t) => [t.id, t.bodyVars]));

  const update = (key: string, step: DripStep) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, step } : x)));
  const move = (i: number, d: number) =>
    setItems((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const next = [...xs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  function save() {
    const errs = [...(name.trim() ? [] : ["Give the sequence a name."]), ...validateSteps(steps, (id) => tplVars.get(id))];
    if (errs.length) return setResult({ ok: false, message: errs.join(" ") });
    start(async () => {
      const r = await action(sequence?.id ?? null, JSON.stringify({ name, listId, stopOnReply, active, steps }));
      setResult(r);
      if (r.ok && !sequence && r.id) router.push(`/drips/${r.id}`);
      else if (r.ok) router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="card space-y-3 p-3">
        <Field label="Sequence name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New lead follow-up" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Auto-enroll list" hint="Contacts added to this list are enrolled automatically.">
            <select className="input" value={listId} onChange={(e) => setListId(e.target.value)}>
              <option value="">None — enroll manually</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </Field>
          <div className="space-y-2 pt-5">
            <label className="flex items-center gap-2 text-sm">
              <AutomationSwitch checked={stopOnReply} onChange={setStopOnReply} label="Stop on reply" /> Stop when the contact replies
            </label>
            <label className="flex items-center gap-2 text-sm">
              <AutomationSwitch checked={active} onChange={setActive} label="Active" /> Active
            </label>
          </div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink">
          <IconClock size={14} className="text-ink-3" /> Timeline
          <span className="font-normal text-ink-3">· each delay counts from the previous step</span>
        </div>
        <ol className="relative space-y-3 border-l border-line pl-5">
          {items.map((it, i) => (
            <li key={it.key} className="relative">
              <span className="absolute top-3 -left-[27px] size-3 rounded-full border-2 border-panel bg-accent" />
              <StepCard
                index={i}
                count={items.length}
                step={it.step}
                at={cum[i]}
                templates={templates}
                onChange={(s) => update(it.key, s)}
                onMove={(d) => move(i, d)}
                onRemove={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}
              />
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="btn mt-3"
          onClick={() => setItems((xs) => [...xs, { key: k(), step: { delayHours: 48, kind: "template", templateId: "", body: [] } }])}
        >
          <IconPlus size={14} /> Add step
        </button>
      </div>

      {result && <Notice tone={result.ok ? "success" : "error"}>{result.message}</Notice>}
      <div className="flex justify-end gap-2">
        <Link href="/drips" className="btn">Cancel</Link>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
          {pending && <IconLoader2 size={14} className="animate-spin" />} {sequence ? "Save sequence" : "Create sequence"}
        </button>
      </div>
    </div>
  );
}

function StepCard({
  index,
  count,
  step,
  at,
  templates,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  step: DripStep;
  at: number;
  templates: DripTemplateOption[];
  onChange: (s: DripStep) => void;
  onMove: (d: number) => void;
  onRemove: () => void;
}) {
  const days = Math.floor(step.delayHours / 24);
  const hours = step.delayHours % 24;
  const setDelay = (d: number, h: number) => onChange({ ...step, delayHours: Math.max(0, d) * 24 + Math.min(23, Math.max(0, h)) });

  return (
    <div className="card p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip color="blue">{dayLabel(at)}</Chip>
        <span className="text-sm font-medium text-ink">Step {index + 1}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" title="Move up" className="btn btn-ghost h-6 px-1 text-ink-3" disabled={index === 0} onClick={() => onMove(-1)}><IconArrowUp size={14} /></button>
          <button type="button" title="Move down" className="btn btn-ghost h-6 px-1 text-ink-3" disabled={index === count - 1} onClick={() => onMove(1)}><IconArrowDown size={14} /></button>
          <button type="button" title="Delete step" className="btn btn-ghost h-6 px-1 text-ink-3 hover:text-danger" disabled={count === 1} onClick={onRemove}><IconTrash size={14} /></button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <span className="label">{index === 0 ? "Wait after enrolling" : "Wait after previous step"}</span>
          <div className="flex items-center gap-1.5 text-sm text-ink-2">
            <input type="number" min={0} className="input w-20" value={days} onChange={(e) => setDelay(Number(e.target.value) || 0, hours)} /> days
            <input type="number" min={0} max={23} className="input w-20" value={hours} onChange={(e) => setDelay(days, Number(e.target.value) || 0)} /> hours
          </div>
        </div>
        <div className="flex rounded-sm border border-line p-0.5">
          {(["template", "text"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={cn("inline-flex h-7 items-center gap-1 rounded-sm px-2 text-sm", step.kind === kind ? "bg-hover font-medium text-ink" : "text-ink-3")}
              onClick={() =>
                onChange(kind === "text" ? { delayHours: step.delayHours, kind, text: step.text ?? "" } : { delayHours: step.delayHours, kind, templateId: step.templateId ?? "", body: step.body ?? [] })
              }
            >
              {kind === "template" ? <IconTemplate size={14} /> : <IconMessage size={14} />}
              {kind === "template" ? "Template" : "Text"}
            </button>
          ))}
        </div>
      </div>

      {step.kind === "template" ? (
        <DripTemplateFields
          templates={templates}
          templateId={step.templateId ?? ""}
          body={step.body ?? []}
          onChange={(v) => onChange({ ...step, ...v })}
        />
      ) : (
        <div className="space-y-3">
          <Notice tone="warn">
            Plain text only reaches contacts who messaged you in the last 24 hours (WhatsApp’s customer-service window). Outside it the step fails — use an approved template for cold follow-ups.
          </Notice>
          <Field label="Message" hint={DRIP_PLACEHOLDER_HINT}>
            <textarea className="input min-h-24 py-1.5" value={step.text ?? ""} onChange={(e) => onChange({ ...step, text: e.target.value })} placeholder="Hi {{name}}, just checking in…" />
          </Field>
          <div>
            <span className="label">Preview</span>
            <DripPreview text={fillPlaceholders(step.text ?? "", SAMPLE_CONTACT)} />
          </div>
        </div>
      )}
    </div>
  );
}
