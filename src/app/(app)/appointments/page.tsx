import Link from "next/link";
import { APPT_STATUS_META } from "@/lib/appointment-status";
import { and, eq, gte, lt } from "drizzle-orm";
import { IconCalendarEvent, IconChevronLeft, IconChevronRight, IconPlus, IconPencil } from "@tabler/icons-react";
import { db } from "@/lib/db";
import { appointments, templates } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { loadCrmOptions } from "@/lib/crm-queries";
import { formatPhone } from "@/lib/phone";
import { templateShape } from "@/lib/template-utils";
import { cn, formatDateTime } from "@/lib/utils";
import {
  addDays,
  fmtDay,
  fmtTime,
  fromIst,
  istDate,
  istTime,
  isoWeekday,
  loadAppointments,
  minutesToHhmm,
  toMinutes,
  workingDays,
  type AppointmentRow,
} from "@/lib/appointments";
import { Empty, Page } from "@/components/ui";
import {
  AppointmentDialog,
  AppointmentSettingsForm,
  AppointmentStatusSelect,
  type AppointmentFormValues,
} from "@/components/appointment-controls";
import { deleteAppointment, saveAppointment, saveAppointmentSettings, setAppointmentStatus } from "./actions";

type SP = { view?: string; week?: string; when?: string; status?: string; new?: string; edit?: string; date?: string; time?: string };
const STATUS_KEYS = Object.keys(APPT_STATUS_META);
const isDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const view = sp.view === "list" || sp.view === "settings" ? sp.view : "week";
  const s = await getSettings();
  const today = istDate(new Date());

  /** Link to this page keeping the current view state, with overrides (undefined = drop). */
  const href = (patch: Partial<Record<keyof SP, string | undefined>> = {}) => {
    const base: Partial<SP> = { view: view === "week" ? undefined : view, week: sp.week, when: sp.when, status: sp.status };
    const all = { ...base, ...patch };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    const q = p.toString();
    return `/appointments${q ? `?${q}` : ""}`;
  };
  const closeHref = href();

  /* ------------------------------------------------------------ dialog */
  let dialog: React.ReactNode = null;
  if (sp.new || sp.edit) {
    const editRow = sp.edit ? (await loadAppointments(eq(appointments.id, sp.edit), 1))[0] : undefined;
    const opts = await loadCrmOptions([editRow?.a.contactId]);
    const values: AppointmentFormValues = editRow
      ? {
          id: editRow.a.id,
          contactId: editRow.a.contactId ?? "",
          service: editRow.a.service,
          date: istDate(editRow.a.startAt),
          time: istTime(editRow.a.startAt),
          durationMin: editRow.a.durationMin,
          notes: editRow.a.notes,
          assignedTo: editRow.a.assignedTo ?? "",
          status: editRow.a.status,
          source: editRow.a.source,
          reminderSent: editRow.a.reminderSentAt ? formatDateTime(editRow.a.reminderSentAt) : undefined,
        }
      : {
          contactId: "",
          service: "",
          date: isDay(sp.date) ? sp.date! : today,
          time: sp.time && /^\d{2}:\d{2}$/.test(sp.time) ? sp.time : s.apptStart,
          durationMin: s.apptSlotMin,
          notes: "",
          assignedTo: "",
          status: "booked",
        };
    if (!sp.edit || editRow) {
      dialog = (
        <AppointmentDialog
          key={editRow?.a.id ?? "new"}
          action={saveAppointment.bind(null, editRow?.a.id ?? null)}
          values={values}
          contacts={opts.contacts}
          users={opts.users}
          closeHref={closeHref}
          onDelete={editRow ? deleteAppointment.bind(null, editRow.a.id, closeHref) : undefined}
          setStatus={editRow ? setAppointmentStatus.bind(null, editRow.a.id) : undefined}
        />
      );
    }
  }

  const tabs = (
    <div className="flex rounded-sm border border-line p-0.5">
      {[
        { k: "week", label: "Week" },
        { k: "list", label: "List" },
        { k: "settings", label: "Settings" },
      ].map((o) => (
        <Link
          key={o.k}
          href={href({ view: o.k === "week" ? undefined : o.k })}
          className={cn("rounded-[3px] px-2 py-0.5 text-sm font-medium", view === o.k ? "bg-hover text-ink" : "text-ink-3 hover:text-ink-2")}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );

  return (
    <Page
      title="Appointments"
      icon={<IconCalendarEvent />}
      noPad
      actions={
        <>
          {tabs}
          <Link href={href({ new: "1" })} className="btn btn-primary" scroll={false}><IconPlus size={14} /> New</Link>
        </>
      }
    >
      {view === "week" && <WeekView sp={sp} today={today} href={href} settings={s} />}
      {view === "list" && <ListView sp={sp} href={href} />}
      {view === "settings" && <SettingsView settings={s} />}
      {dialog}
    </Page>
  );
}

/* -------------------------------------------------------------- week view */

async function WeekView({
  sp,
  today,
  href,
  settings: s,
}: {
  sp: SP;
  today: string;
  href: (p?: Partial<Record<keyof SP, string | undefined>>) => string;
  settings: Awaited<ReturnType<typeof getSettings>>;
}) {
  const anchor = isDay(sp.week) ? sp.week! : today;
  const weekStart = addDays(anchor, 1 - isoWeekday(anchor));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const from = fromIst(weekStart, "00:00")!;
  const to = fromIst(addDays(weekStart, 7), "00:00")!;
  const rows = await loadAppointments(and(gte(appointments.startAt, from), lt(appointments.startAt, to)));

  const slot = Math.max(5, s.apptSlotMin || 30);
  const open = workingDays(s);
  const workStart = toMinutes(s.apptStart, 600);
  const workEnd = toMinutes(s.apptEnd, 1140);
  let gs = Math.floor(workStart / slot) * slot;
  let ge = workEnd;
  const cells = new Map<string, AppointmentRow[]>();
  for (const r of rows) {
    const m = toMinutes(istTime(r.a.startAt), 0);
    gs = Math.min(gs, Math.floor(m / slot) * slot);
    ge = Math.max(ge, Math.min(24 * 60, m + slot));
    const key = `${istDate(r.a.startAt)}|${Math.floor(m / slot) * slot}`;
    cells.set(key, [...(cells.get(key) ?? []), r]);
  }
  // keep the grid manageable for tiny slot lengths
  const step = (ge - gs) / slot > 60 ? Math.ceil((ge - gs) / 60 / slot) * slot : slot;
  const times: number[] = [];
  for (let t = gs; t < ge; t += step) times.push(t);
  if (step !== slot) {
    // re-bucket by the coarser step
    const re = new Map<string, AppointmentRow[]>();
    for (const r of rows) {
      const m = toMinutes(istTime(r.a.startAt), 0);
      const key = `${istDate(r.a.startAt)}|${gs + Math.floor((m - gs) / step) * step}`;
      re.set(key, [...(re.get(key) ?? []), r]);
    }
    cells.clear();
    for (const [k, v] of re) cells.set(k, v);
  }
  const now = Date.now();
  const active = rows.filter((r) => r.a.status !== "cancelled").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Link href={href({ week: addDays(weekStart, -7) })} className="btn btn-ghost h-7 px-1.5" title="Previous week"><IconChevronLeft size={14} /></Link>
        <Link href={href({ week: undefined })} className="btn h-7">Today</Link>
        <Link href={href({ week: addDays(weekStart, 7) })} className="btn btn-ghost h-7 px-1.5" title="Next week"><IconChevronRight size={14} /></Link>
        <span className="text-sm font-medium text-ink">
          {fmtDay(from)} – {fmtDay(fromIst(addDays(weekStart, 6), "12:00")!)}
        </span>
        <span className="text-xs text-ink-3">· {active} appointment{active === 1 ? "" : "s"} · times in IST</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid min-w-[900px]" style={{ gridTemplateColumns: "60px repeat(7, minmax(110px, 1fr))" }}>
          <div className="sticky top-0 z-10 border-b border-line bg-panel" />
          {days.map((d) => {
            const isToday = d === today;
            const closed = !open.has(isoWeekday(d));
            return (
              <div key={d} className={cn("sticky top-0 z-10 border-b border-l border-line bg-panel px-2 py-1.5 text-xs", closed && "bg-soft")}>
                <span className={cn("font-medium", isToday ? "text-accent" : "text-ink-2")}>{fmtDay(fromIst(d, "12:00")!)}</span>
                {closed && <span className="ml-1 text-ink-4">closed</span>}
              </div>
            );
          })}
          {times.map((t) => (
            <Row key={t} t={t} step={step} days={days} cells={cells} open={open} workStart={workStart} workEnd={workEnd} now={now} href={href} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({
  t,
  step,
  days,
  cells,
  open,
  workStart,
  workEnd,
  now,
  href,
}: {
  t: number;
  step: number;
  days: string[];
  cells: Map<string, AppointmentRow[]>;
  open: Set<number>;
  workStart: number;
  workEnd: number;
  now: number;
  href: (p?: Partial<Record<keyof SP, string | undefined>>) => string;
}) {
  const hhmm = minutesToHhmm(t);
  return (
    <>
      <div className="border-b border-line-light px-1.5 py-1 text-right text-[11px] text-ink-3">{fmtTime(fromIst("2026-01-01", hhmm)!)}</div>
      {days.map((d) => {
        const list = cells.get(`${d}|${t}`) ?? [];
        const working = open.has(isoWeekday(d)) && t >= workStart && t + step <= workEnd;
        const future = (fromIst(d, hhmm)?.getTime() ?? 0) > now;
        return (
          <div key={d} className={cn("group relative min-h-9 border-b border-l border-line-light p-0.5", !working && "bg-soft")}>
            <div className="space-y-0.5">
              {list.map((r) => {
                const meta = APPT_STATUS_META[r.a.status] ?? APPT_STATUS_META.booked;
                return (
                  <Link
                    key={r.a.id}
                    href={href({ edit: r.a.id })}
                    scroll={false}
                    className={cn("block rounded-sm border-l-2 px-1.5 py-0.5 text-[11.5px] leading-4 hover:brightness-95", meta.block)}
                    title={`${fmtTime(r.a.startAt)} · ${r.a.durationMin} min · ${meta.label}${r.a.notes ? `\n${r.a.notes}` : ""}`}
                  >
                    <span className="font-medium text-ink">{fmtTime(r.a.startAt)}</span>{" "}
                    <span className="text-ink-2">{r.contactName || formatPhone(r.contactPhone ?? "") || "—"}</span>
                    {r.a.service && <span className="block truncate text-ink-3">{r.a.service}</span>}
                  </Link>
                );
              })}
            </div>
            {!list.length && working && future && (
              <Link
                href={href({ new: "1", date: d, time: hhmm })}
                scroll={false}
                className="absolute inset-0.5 hidden items-center justify-center rounded-sm text-ink-4 hover:bg-accent-soft hover:text-accent group-hover:flex"
                title="New appointment"
              >
                <IconPlus size={14} />
              </Link>
            )}
          </div>
        );
      })}
    </>
  );
}

/* -------------------------------------------------------------- list view */

async function ListView({ sp, href }: { sp: SP; href: (p?: Partial<Record<keyof SP, string | undefined>>) => string }) {
  const when = sp.when === "past" || sp.when === "all" ? sp.when : "upcoming";
  const status = STATUS_KEYS.includes(sp.status ?? "") ? sp.status : undefined;
  const now = new Date();
  let rows = await loadAppointments(
    and(
      when === "upcoming" ? gte(appointments.startAt, new Date(now.getTime() - 3600 * 1000)) : when === "past" ? lt(appointments.startAt, now) : undefined,
      status ? eq(appointments.status, status as AppointmentRow["a"]["status"]) : undefined,
    ),
  );
  if (when !== "upcoming") rows = [...rows].reverse();

  const pill = (active: boolean) => cn("rounded-[3px] px-2 py-0.5 text-sm font-medium", active ? "bg-hover text-ink" : "text-ink-3 hover:text-ink-2");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="flex rounded-sm border border-line p-0.5">
          {(["upcoming", "past", "all"] as const).map((w) => (
            <Link key={w} href={href({ when: w === "upcoming" ? undefined : w })} className={pill(when === w)}>{w[0].toUpperCase() + w.slice(1)}</Link>
          ))}
        </div>
        <div className="flex flex-wrap rounded-sm border border-line p-0.5">
          <Link href={href({ status: undefined })} className={pill(!status)}>Any status</Link>
          {STATUS_KEYS.map((k) => (
            <Link key={k} href={href({ status: k })} className={pill(status === k)}>{APPT_STATUS_META[k].label}</Link>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty icon={<IconCalendarEvent />} title="No appointments" hint="Appointments booked by the chatbot or added here will show up in this list." />
      ) : (
        <div className="overflow-x-auto">
          <table className="table-grid w-full min-w-[900px] table-fixed">
            <thead>
              <tr>
                <th className="w-44">When (IST)</th>
                <th className="w-52">Contact</th>
                <th>Service</th>
                <th className="w-20">Duration</th>
                <th className="w-28">Status</th>
                <th className="w-32">Assigned</th>
                <th className="w-20">Source</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.a.id}>
                  <td className="whitespace-nowrap">
                    <span className="font-medium text-ink">{fmtDay(r.a.startAt)}</span> <span className="text-ink-2">{fmtTime(r.a.startAt)}</span>
                  </td>
                  <td className="truncate">
                    {r.a.contactId ? (
                      <Link href={`/inbox/${r.a.contactId}`} className="hover:underline">
                        {r.contactName || formatPhone(r.contactPhone ?? "")}
                        {r.contactName && <span className="ml-1 text-xs text-ink-3">{formatPhone(r.contactPhone ?? "")}</span>}
                      </Link>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </td>
                  <td className="truncate text-ink-2" title={r.a.notes}>{r.a.service || <span className="text-ink-4">—</span>}</td>
                  <td className="text-ink-2">{r.a.durationMin} min</td>
                  <td><AppointmentStatusSelect status={r.a.status} action={setAppointmentStatus.bind(null, r.a.id)} /></td>
                  <td className="truncate text-ink-2">{r.assigneeName || <span className="text-ink-4">—</span>}</td>
                  <td className="text-ink-3">{r.a.source}</td>
                  <td>
                    <Link href={href({ edit: r.a.id })} scroll={false} className="btn btn-ghost h-6 px-1 text-ink-3" title="Edit"><IconPencil size={14} /></Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- settings view */

async function SettingsView({ settings: s }: { settings: Awaited<ReturnType<typeof getSettings>> }) {
  const tpls = await db.select().from(templates).where(eq(templates.status, "APPROVED"));
  const list = tpls
    .filter((t) => !templateShape(t.components).headerMedia)
    .map((t) => ({ id: t.id, name: t.name, language: t.language, vars: templateShape(t.components).bodyVars }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="p-4">
      <AppointmentSettingsForm
        action={saveAppointmentSettings}
        templates={list}
        values={{
          apptDays: s.apptDays,
          apptStart: s.apptStart,
          apptEnd: s.apptEnd,
          apptSlotMin: s.apptSlotMin,
          apptDaysAhead: s.apptDaysAhead,
          apptReminderHours: s.apptReminderHours,
          apptReminderTemplateId: s.apptReminderTemplateId,
        }}
      />
    </div>
  );
}
