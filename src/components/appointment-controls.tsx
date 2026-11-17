"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconLoader2, IconTrash, IconX, IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Field, Notice } from "./ui";

type Result = { ok: boolean; message: string } | null;
type Opt = { id: string; name: string };

export { APPT_STATUS_META } from "@/lib/appointment-status";
import { APPT_STATUS_META } from "@/lib/appointment-status";

/** Status chip-select. Confirm / cancel ask whether to message the customer. */
export function AppointmentStatusSelect({
  status,
  action,
}: {
  status: string;
  action: (status: string, notify: boolean) => Promise<{ ok: boolean; message: string }>;
}) {
  const [v, setV] = useState(status);
  const [pending, start] = useTransition();
  const meta = APPT_STATUS_META[v] ?? APPT_STATUS_META.booked;
  return (
    <select
      value={v}
      disabled={pending}
      aria-label="Appointment status"
      className={cn("h-5 cursor-pointer appearance-none rounded-sm border-0 px-1.5 text-xs font-medium outline-none disabled:opacity-60", meta.cls)}
      onChange={(e) => {
        const next = e.target.value;
        const prev = v;
        const notify = (next === "confirmed" || next === "cancelled") && confirm(`Send the customer a WhatsApp message that the appointment is ${next}?`);
        setV(next);
        start(async () => {
          const r = await action(next, notify).catch(() => ({ ok: false, message: "Couldn’t update." }));
          if (!r.ok) setV(prev);
          if (!r.ok || notify) alert(r.message);
        });
      }}
    >
      {Object.entries(APPT_STATUS_META).map(([k, m]) => (
        <option key={k} value={k} className="bg-white text-ink">{m.label}</option>
      ))}
    </select>
  );
}

/** Contact select with a type-to-filter box. */
function ContactPicker({ contacts, value, onChange }: { contacts: Opt[]; value: string; onChange: (v: string) => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const f = t ? contacts.filter((c) => c.name.toLowerCase().includes(t) || c.id === value) : contacts;
    return f.slice(0, 300);
  }, [q, contacts, value]);
  return (
    <div className="space-y-1">
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts…" />
      <select name="contactId" required className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— choose a contact —</option>
        {list.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  );
}

export type AppointmentFormValues = {
  id?: string;
  contactId: string;
  service: string;
  date: string;
  time: string;
  durationMin: number;
  notes: string;
  assignedTo: string;
  status: string;
  source?: string;
  reminderSent?: string;
};

/** Create / edit dialog. Rendered by the page when ?new=1 or ?edit=<id> is in the URL. */
export function AppointmentDialog({
  action,
  values,
  contacts,
  users,
  closeHref,
  onDelete,
  setStatus,
}: {
  action: (s: unknown, fd: FormData) => Promise<Result>;
  values: AppointmentFormValues;
  contacts: Opt[];
  users: Opt[];
  closeHref: string;
  onDelete?: () => Promise<void>;
  setStatus?: (status: string, notify: boolean) => Promise<{ ok: boolean; message: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [contactId, setContactId] = useState(values.contactId);
  const [status, setStatusLocal] = useState(values.status);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [deleting, startDelete] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(closeHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeHref, router]);

  const quick = (next: string) => {
    if (!setStatus) return;
    const notify = (next === "confirmed" || next === "cancelled") && confirm(`Send the customer a WhatsApp message that the appointment is ${next}?`);
    start(async () => {
      const r = await setStatus(next, notify);
      if (r.ok) setStatusLocal(next);
      setNotice(r.message);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/20 p-4 pt-[8vh]">
      <div className="w-full max-w-lg rounded-lg border border-line bg-panel shadow-xl">
        <div className="flex h-11 items-center justify-between border-b border-line px-4">
          <span className="text-sm font-medium text-ink">{values.id ? "Edit appointment" : "New appointment"}</span>
          <Link href={closeHref} className="btn btn-ghost h-7 px-1.5 text-ink-3" title="Close"><IconX size={14} /></Link>
        </div>
        <form action={formAction} className="space-y-3 p-4">
          {state && !state.ok && <Notice tone="error">{state.message}</Notice>}
          {notice && <Notice tone="success">{notice}</Notice>}
          <input type="hidden" name="return" value={closeHref} />

          <Field label="Contact">
            <ContactPicker contacts={contacts} value={contactId} onChange={setContactId} />
          </Field>
          <Field label="Service">
            <input name="service" defaultValue={values.service} maxLength={191} className="input" placeholder="e.g. Consultation" />
          </Field>
          <div className="grid grid-cols-[1fr_110px_110px] gap-2">
            <Field label="Date (IST)">
              <input name="date" type="date" required defaultValue={values.date} className="input" />
            </Field>
            <Field label="Time">
              <input name="time" type="time" required step={300} defaultValue={values.time} className="input" />
            </Field>
            <Field label="Minutes">
              <input name="durationMin" type="number" min={5} max={1440} step={5} required defaultValue={values.durationMin} className="input" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Assigned to">
              <select name="assignedTo" defaultValue={values.assignedTo} className="input">
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select name="status" value={status} onChange={(e) => setStatusLocal(e.target.value)} className="input">
                {Object.entries(APPT_STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea name="notes" rows={3} defaultValue={values.notes} className="input h-auto py-1.5" maxLength={5000} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" name="allowOverlap" /> Allow overlap with other appointments
          </label>

          {values.id && setStatus && (
            <div className="space-y-1.5 rounded-md border border-line p-2.5">
              <div className="label !mb-0">Quick status {busy && <IconLoader2 size={12} className="ml-1 inline animate-spin" />}</div>
              <div className="flex flex-wrap gap-1.5">
                {(["confirmed", "cancelled", "completed", "no_show"] as const).map((k) => (
                  <button key={k} type="button" disabled={busy || status === k} onClick={() => quick(k)} className={cn("btn h-7", status === k && "opacity-60")}>
                    {status === k && <IconCheck size={12} />} {APPT_STATUS_META[k].label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-ink-3">Confirm / cancel can message the customer on WhatsApp (needs the 24h chat window to be open).</p>
            </div>
          )}

          {(values.source || values.reminderSent) && (
            <p className="text-xs text-ink-3">
              {values.source && <>Source: {values.source}. </>}
              {values.reminderSent && <>Reminder sent {values.reminderSent}.</>}
            </p>
          )}

          <div className="flex items-center gap-2 border-t border-line pt-3">
            <button className="btn btn-primary" disabled={pending}>
              {pending && <IconLoader2 size={14} className="animate-spin" />} {values.id ? "Save" : "Create"}
            </button>
            <Link href={closeHref} className="btn">Cancel</Link>
            {onDelete && (
              <button
                type="button"
                className="btn btn-ghost ml-auto text-danger"
                disabled={deleting}
                onClick={() => {
                  if (confirm("Delete this appointment?")) startDelete(() => onDelete());
                }}
              >
                {deleting ? <IconLoader2 size={14} className="animate-spin" /> : <IconTrash size={14} />} Delete
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function AppointmentSettingsForm({
  action,
  values,
  templates,
}: {
  action: (s: unknown, fd: FormData) => Promise<Result>;
  values: { apptDays: string; apptStart: string; apptEnd: string; apptSlotMin: number; apptDaysAhead: number; apptReminderHours: number; apptReminderTemplateId: string };
  templates: { id: string; name: string; language: string; vars: number }[];
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const days = new Set(values.apptDays.split(",").map((d) => d.trim()));
  const [tpl, setTpl] = useState(values.apptReminderTemplateId);
  const chosen = templates.find((t) => t.id === tpl);
  return (
    <form action={formAction} className="card max-w-2xl space-y-4 p-4">
      {state && <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice>}
      <div>
        <span className="label">Working days</span>
        <div className="flex flex-wrap gap-1.5">
          {DAY_LABELS.map((d, i) => (
            <label key={d} className="flex h-7 cursor-pointer items-center gap-1.5 rounded-sm border border-line px-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent">
              <input type="checkbox" name="apptDays" value={i + 1} defaultChecked={days.has(String(i + 1))} className="sr-only" />
              {d}
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Opens (IST)">
          <input name="apptStart" type="time" required defaultValue={values.apptStart} className="input" />
        </Field>
        <Field label="Closes (IST)">
          <input name="apptEnd" type="time" required defaultValue={values.apptEnd} className="input" />
        </Field>
        <Field label="Slot length (min)">
          <input name="apptSlotMin" type="number" min={5} max={480} step={5} required defaultValue={values.apptSlotMin} className="input" />
        </Field>
        <Field label="Book up to (days)">
          <input name="apptDaysAhead" type="number" min={1} max={60} required defaultValue={values.apptDaysAhead} className="input" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label="Remind (hours before)">
          <input name="apptReminderHours" type="number" min={1} max={168} required defaultValue={values.apptReminderHours} className="input" />
        </Field>
        <Field
          label="Reminder template"
          hint={
            chosen
              ? `Body variables are filled in order: {{1}} name, {{2}} date, {{3}} time, {{4}} service${chosen.vars > 4 ? " (extra variables get “-”)" : ""}.`
              : "Without a template, a plain text reminder is sent — only to customers who messaged in the last 24 hours."
          }
        >
          <select name="apptReminderTemplateId" value={tpl} onChange={(e) => setTpl(e.target.value)} className="input">
            <option value="">— plain text (24h window only) —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.language})</option>
            ))}
          </select>
        </Field>
      </div>
      <p className="text-xs text-ink-3">The chatbot’s “Book appointment” step offers free slots from these hours, skipping times already booked.</p>
      <button className="btn btn-primary" disabled={pending}>
        {pending && <IconLoader2 size={14} className="animate-spin" />} Save settings
      </button>
    </form>
  );
}
