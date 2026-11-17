"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  IconArrowDown,
  IconArrowUp,
  IconBolt,
  IconChecklist,
  IconCircleCheck,
  IconClock,
  IconLoader2,
  IconMessage,
  IconNote,
  IconPlayerPause,
  IconPlaylistAdd,
  IconPlaylistX,
  IconPlus,
  IconTemplate,
  IconTrash,
  IconUserCheck,
  IconWebhook,
} from "@tabler/icons-react";
import type { AutomationStep, AutomationTrigger } from "@/db/schema";
import {
  STEP_META,
  STEP_TYPES,
  TRIGGER_META,
  TRIGGER_TYPES,
  defaultStep,
  defaultTrigger,
  validateAutomation,
  waitLabel,
  type StepType,
  type TriggerType,
} from "@/app/(app)/automations/validate";
import { cn } from "@/lib/utils";
import { Chip, Field, Notice } from "./ui";
import { AutomationSwitch } from "./automation-controls";

export type BuilderTemplate = { id: string; name: string; language: string; bodyVars: number; body: string };
export type BuilderOption = { id: string; name: string };

const STEP_ICON: Record<StepType, React.ReactNode> = {
  send_text: <IconMessage size={14} />,
  send_template: <IconTemplate size={14} />,
  add_to_list: <IconPlaylistAdd size={14} />,
  remove_from_list: <IconPlaylistX size={14} />,
  assign: <IconUserCheck size={14} />,
  close_chat: <IconCircleCheck size={14} />,
  pause_bot: <IconPlayerPause size={14} />,
  add_note: <IconNote size={14} />,
  create_task: <IconChecklist size={14} />,
  webhook: <IconWebhook size={14} />,
  wait: <IconClock size={14} />,
};

const PLACEHOLDER_HINT = (
  <>
    Placeholders: <code className="rounded-sm bg-hover px-1">{"{{name}}"}</code> <code className="rounded-sm bg-hover px-1">{"{{phone}}"}</code>{" "}
    <code className="rounded-sm bg-hover px-1">{"{{email}}"}</code>
  </>
);

type Item = { key: string; step: AutomationStep };
let keySeq = 0;
const newKey = () => `s${++keySeq}`;

export function AutomationBuilder({
  automation,
  lists,
  templates,
  users,
  action,
}: {
  automation?: { name: string; active: boolean; trigger: AutomationTrigger; steps: AutomationStep[] };
  lists: BuilderOption[];
  templates: BuilderTemplate[];
  users: BuilderOption[];
  action: (payload: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [name, setName] = useState(automation?.name ?? "");
  const [active, setActive] = useState(automation?.active ?? true);
  const [trigger, setTrigger] = useState<AutomationTrigger>(automation?.trigger ?? defaultTrigger("contact.created"));
  const [items, setItems] = useState<Item[]>(() => (automation?.steps ?? []).map((step) => ({ key: newKey(), step })));
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const tplById = new Map(templates.map((t) => [t.id, t]));

  const setStep = (i: number, step: AutomationStep) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, step } : x)));
  const move = (i: number, d: -1 | 1) =>
    setItems((xs) => {
      const j = i + d;
      if (j < 0 || j >= xs.length) return xs;
      const next = [...xs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (i: number) => setItems((xs) => xs.filter((_, j) => j !== i));
  const add = (type: StepType) => setItems((xs) => [...xs, { key: newKey(), step: defaultStep(type) }]);

  function save() {
    const data = { name: name.trim(), active, trigger, steps: items.map((x) => x.step) };
    const errs = validateAutomation(data, { templateVars: (id) => tplById.get(id)?.bodyVars });
    setErrors(errs);
    if (errs.length) return;
    start(async () => {
      const r = await action(JSON.stringify(data));
      if (r && !r.ok) setErrors([r.message]);
    });
  }

  const noContact = trigger.type === "campaign.completed";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Welcome new contacts" maxLength={191} />
          </Field>
        </div>
        <label className="flex h-8 items-center gap-2 text-sm text-ink-2">
          <AutomationSwitch checked={active} onChange={setActive} label="Active" />
          {active ? "Active" : "Paused"}
        </label>
      </div>

      <div>
        {/* trigger */}
        <div className="card border-accent/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex size-6 items-center justify-center rounded-sm bg-accent text-white"><IconBolt size={14} /></span>
            <span className="text-sm font-medium text-ink">When</span>
            <Chip color={TRIGGER_META[trigger.type].color}>Trigger</Chip>
          </div>
          <div className="space-y-2">
            <select
              className="input"
              value={trigger.type}
              onChange={(e) => setTrigger(defaultTrigger(e.target.value as TriggerType))}
            >
              {TRIGGER_TYPES.map((t) => (
                <option key={t} value={t}>{TRIGGER_META[t].label}</option>
              ))}
            </select>
            <p className="text-xs text-ink-3">{TRIGGER_META[trigger.type].hint}</p>
            {trigger.type === "message.received" && (
              <div className="grid grid-cols-[1fr_140px] gap-2">
                <Field label="Keywords" hint="Comma-separated. Leave empty to run on every message.">
                  <input className="input" value={trigger.keywords ?? ""} onChange={(e) => setTrigger({ ...trigger, keywords: e.target.value })} placeholder="price, interested" />
                </Field>
                <Field label="Match">
                  <select className="input" value={trigger.matchType ?? "contains"} onChange={(e) => setTrigger({ ...trigger, matchType: e.target.value as "exact" | "contains" | "starts" })}>
                    <option value="contains">Contains</option>
                    <option value="exact">Exact</option>
                    <option value="starts">Starts with</option>
                  </select>
                </Field>
              </div>
            )}
            {trigger.type === "contact.list_added" && (
              <Field label="List">
                <ListSelect lists={lists} value={trigger.listId} onChange={(listId) => setTrigger({ ...trigger, listId })} />
              </Field>
            )}
          </div>
        </div>

        {/* steps */}
        {items.map((it, i) => (
          <div key={it.key}>
            <Connector />
            <StepCard
              index={i}
              step={it.step}
              count={items.length}
              warn={noContact && STEP_META[it.step.type].needsContact ? "Campaign triggers have no contact — this step will fail." : undefined}
              onMove={(d) => move(i, d)}
              onRemove={() => remove(i)}
            >
              <StepFields step={it.step} onChange={(s) => setStep(i, s)} lists={lists} templates={templates} users={users} />
            </StepCard>
          </div>
        ))}

        <Connector />
        <AddStepMenu onAdd={add} noContact={noContact} />
      </div>

      {errors.length > 0 && (
        <Notice tone="error">
          <ul className="list-disc space-y-0.5 pl-4">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </Notice>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
        <Link href="/automations" className="btn">Cancel</Link>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
          {pending && <IconLoader2 size={14} className="animate-spin" />} Save automation
        </button>
      </div>
    </div>
  );
}

function Connector() {
  return <div className="mx-auto h-5 w-px bg-line-strong" />;
}

function StepCard({
  index,
  step,
  count,
  warn,
  onMove,
  onRemove,
  children,
}: {
  index: number;
  step: AutomationStep;
  count: number;
  warn?: string;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const m = STEP_META[step.type];
  return (
    <div className={cn("card p-3", warn && "border-[#ffd1d1]")}>
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex size-6 items-center justify-center rounded-sm bg-hover text-ink-2">{STEP_ICON[step.type]}</span>
        <span className="text-xs font-medium text-ink-3">{index + 1}.</span>
        <span className="text-sm font-medium text-ink">{m.label}</span>
        {step.type === "wait" && step.minutes > 0 && <Chip color="blue">{waitLabel(step.minutes)}</Chip>}
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" title="Move up" className="btn btn-ghost h-6 px-1 text-ink-3" disabled={index === 0} onClick={() => onMove(-1)}><IconArrowUp size={14} /></button>
          <button type="button" title="Move down" className="btn btn-ghost h-6 px-1 text-ink-3" disabled={index === count - 1} onClick={() => onMove(1)}><IconArrowDown size={14} /></button>
          <button type="button" title="Delete step" className="btn btn-ghost h-6 px-1 text-ink-3 hover:text-danger" onClick={onRemove}><IconTrash size={14} /></button>
        </div>
      </div>
      {warn && <p className="mb-2 text-xs text-danger">{warn}</p>}
      {children}
    </div>
  );
}

function AddStepMenu({ onAdd, noContact }: { onAdd: (t: StepType) => void; noContact: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative flex justify-center">
      <button type="button" className="btn" onClick={() => setOpen((v) => !v)}>
        <IconPlus size={14} /> Add step
      </button>
      {open && (
        <div className="absolute top-8 z-20 w-60 rounded-md border border-line bg-panel p-1 shadow-lg">
          {STEP_TYPES.map((t) => {
            const disabled = noContact && STEP_META[t].needsContact;
            return (
              <button
                key={t}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onAdd(t);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-ink-2 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="text-ink-3">{STEP_ICON[t]}</span>
                {STEP_META[t].label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ListSelect({ lists, value, onChange }: { lists: BuilderOption[]; value: string; onChange: (id: string) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select a list…</option>
      {lists.map((l) => (
        <option key={l.id} value={l.id}>{l.name}</option>
      ))}
    </select>
  );
}

function StepFields({
  step,
  onChange,
  lists,
  templates,
  users,
}: {
  step: AutomationStep;
  onChange: (s: AutomationStep) => void;
  lists: BuilderOption[];
  templates: BuilderTemplate[];
  users: BuilderOption[];
}) {
  switch (step.type) {
    case "send_text":
      return (
        <Field label="Message" hint={<>{PLACEHOLDER_HINT}. Free-form messages only deliver within 24 h of the customer’s last message.</>}>
          <textarea className="input" rows={3} maxLength={4096} value={step.text} onChange={(e) => onChange({ ...step, text: e.target.value })} placeholder="Hi {{name}}, thanks for reaching out!" />
        </Field>
      );

    case "send_template": {
      const tpl = templates.find((t) => t.id === step.templateId);
      return (
        <div className="space-y-2">
          <Field label="Template" hint={templates.length ? "Approved templates without a media header." : "No approved templates yet — sync them in Templates."}>
            <select
              className="input"
              value={step.templateId}
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                onChange({ ...step, templateId: e.target.value, body: Array.from({ length: t?.bodyVars ?? 0 }, (_, i) => step.body[i] ?? "") });
              }}
            >
              <option value="">Select a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.language})</option>
              ))}
            </select>
          </Field>
          {tpl && (
            <>
              <div className="rounded-sm bg-soft px-2 py-1.5 text-xs whitespace-pre-wrap text-ink-2 border border-line-light">{tpl.body || "—"}</div>
              {tpl.bodyVars > 0 && (
                <div className="space-y-1.5">
                  {Array.from({ length: tpl.bodyVars }, (_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <code className="w-10 shrink-0 text-xs text-ink-3">{`{{${i + 1}}}`}</code>
                      <input
                        className="input"
                        value={step.body[i] ?? ""}
                        placeholder={i === 0 ? "{{name}}" : "value"}
                        onChange={(e) => {
                          const body = Array.from({ length: tpl.bodyVars }, (_, j) => step.body[j] ?? "");
                          body[i] = e.target.value;
                          onChange({ ...step, body });
                        }}
                      />
                    </div>
                  ))}
                  <p className="text-xs text-ink-3">{PLACEHOLDER_HINT}</p>
                </div>
              )}
            </>
          )}
        </div>
      );
    }

    case "add_to_list":
    case "remove_from_list":
      return (
        <Field label="List">
          <ListSelect lists={lists} value={step.listId} onChange={(listId) => onChange({ ...step, listId })} />
        </Field>
      );

    case "assign":
      return (
        <Field label="Assign to">
          <select className="input" value={step.userId ?? ""} onChange={(e) => onChange({ ...step, userId: e.target.value || null })}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </Field>
      );

    case "close_chat":
      return <p className="text-xs text-ink-3">Marks the conversation as closed in the inbox.</p>;

    case "pause_bot":
      return (
        <Field label="Pause for (hours)" hint="The chatbot won’t auto-reply to this contact during this time.">
          <input type="number" min={1} max={720} className="input w-28" value={step.hours} onChange={(e) => onChange({ ...step, hours: Number(e.target.value) })} />
        </Field>
      );

    case "add_note":
      return (
        <Field label="Note" hint={PLACEHOLDER_HINT}>
          <textarea className="input" rows={2} value={step.text} onChange={(e) => onChange({ ...step, text: e.target.value })} placeholder="Lead came in via WhatsApp — {{phone}}" />
        </Field>
      );

    case "create_task":
      return (
        <div className="grid grid-cols-[1fr_120px] gap-2">
          <Field label="Task title" hint={<>{PLACEHOLDER_HINT}. Assigned to the chat owner.</>}>
            <input className="input" maxLength={255} value={step.title} onChange={(e) => onChange({ ...step, title: e.target.value })} placeholder="Call {{name}}" />
          </Field>
          <Field label="Due in (hours)">
            <input
              type="number"
              min={0}
              className="input"
              value={step.dueInHours ?? ""}
              placeholder="No due date"
              onChange={(e) => onChange({ ...step, dueInHours: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </Field>
        </div>
      );

    case "webhook":
      return (
        <Field label="URL" hint="POSTs JSON { automation, contact, event } — 10 s timeout, non-2xx fails the run.">
          <input className="input" type="url" value={step.url} onChange={(e) => onChange({ ...step, url: e.target.value })} placeholder="https://example.com/hooks/whatsapp" />
        </Field>
      );

    case "wait":
      return <WaitFields minutes={step.minutes} onChange={(minutes) => onChange({ ...step, minutes })} />;
  }
}

const UNITS = [
  { label: "minutes", mult: 1 },
  { label: "hours", mult: 60 },
  { label: "days", mult: 1440 },
];

function WaitFields({ minutes, onChange }: { minutes: number; onChange: (m: number) => void }) {
  const [unit, setUnit] = useState(() => (minutes > 0 && minutes % 1440 === 0 ? 1440 : minutes > 0 && minutes % 60 === 0 ? 60 : 1));
  const amount = minutes / unit;
  return (
    <div className="flex items-center gap-2 text-sm text-ink-2">
      Wait
      <input type="number" min={1} className="input w-24" value={Number.isFinite(amount) ? amount : ""} onChange={(e) => onChange(Math.round(Number(e.target.value) * unit))} />
      <select
        className="input w-28"
        value={unit}
        onChange={(e) => {
          const u = Number(e.target.value);
          setUnit(u);
          onChange(Math.round(amount * u));
        }}
      >
        {UNITS.map((u) => (
          <option key={u.mult} value={u.mult}>{u.label}</option>
        ))}
      </select>
      then continue
    </div>
  );
}
