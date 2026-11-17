import "server-only";
import { and, eq, gt, gte, inArray, isNull, lt, lte, ne, type SQL } from "drizzle-orm";
import { db } from "./db";
import { appointments, contacts, templates, users, type Appointment } from "@/db/schema";
import { getSettings, type AppSettings } from "./settings";
import { waClient, errorMessage } from "./whatsapp";
import { recordOutbound } from "./messaging";
import { buildSendComponents, renderTemplatePreview } from "./template-utils";

const TZ = "Asia/Kolkata";
const WINDOW_MS = 24 * 3600 * 1000;
const REMINDER_BATCH = 50;

/* ------------------------------------------------------------ IST helpers */

/** YYYY-MM-DD of a moment in IST. */
export function istDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}
/** HH:MM (24h) of a moment in IST. */
export function istTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
/** "Tue, 19 Nov" */
export function fmtDay(d: Date): string {
  return d.toLocaleDateString("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
}
/** "10:30 am" */
export function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
}
/** UTC Date for an IST wall-clock date + time; null when invalid. */
export function fromIst(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(":");
  const d = new Date(`${date}T${h.padStart(2, "0")}:${m}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** ISO weekday (Mon=1 … Sun=7) of an IST calendar date. */
export function isoWeekday(date: string): number {
  const wd = new Date(`${date}T12:00:00+05:30`).getUTCDay();
  return wd === 0 ? 7 : wd;
}
/** IST calendar date `n` days after `date`. */
export function addDays(date: string, n: number): string {
  return istDate(new Date(new Date(`${date}T12:00:00+05:30`).getTime() + n * 864e5));
}
export function toMinutes(hhmm: string, d: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return d;
  return Math.min(24 * 60, Number(m[1]) * 60 + Number(m[2]));
}
export function minutesToHhmm(n: number): string {
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
export function workingDays(s: Pick<AppSettings, "apptDays">): Set<number> {
  return new Set(
    String(s.apptDays)
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((n) => n >= 1 && n <= 7),
  );
}

/* ------------------------------------------------------------------ slots */

type Busy = { start: number; end: number };

async function busyBetween(from: Date, to: Date, exceptId?: string): Promise<Busy[]> {
  const rows = await db
    .select({ startAt: appointments.startAt, durationMin: appointments.durationMin })
    .from(appointments)
    .where(
      and(
        ne(appointments.status, "cancelled"),
        gte(appointments.startAt, new Date(from.getTime() - 24 * 3600 * 1000)),
        lt(appointments.startAt, to),
        exceptId ? ne(appointments.id, exceptId) : undefined,
      ),
    );
  return rows.map((r) => ({ start: r.startAt.getTime(), end: r.startAt.getTime() + r.durationMin * 60000 }));
}

const overlaps = (busy: Busy[], start: number, end: number) => busy.some((b) => b.start < end && b.end > start);

/** Is [start, start+durationMin) free of other non-cancelled appointments? */
export async function isSlotFree(start: Date, durationMin: number, exceptId?: string): Promise<boolean> {
  const end = new Date(start.getTime() + durationMin * 60000);
  return !overlaps(await busyBetween(start, end, exceptId), start.getTime(), end.getTime());
}

/**
 * Next free slots from the working-hours settings (IST), skipping past times and booked slots.
 * Spreads picks across days (≤ perDay per day, evenly spaced) so the customer sees a range.
 */
export async function computeFreeSlots(limit = 10, perDay = 4): Promise<Date[]> {
  const s = await getSettings();
  const days = workingDays(s);
  const slot = Math.max(5, s.apptSlotMin || 30);
  const startMin = toMinutes(s.apptStart, 600);
  const endMin = toMinutes(s.apptEnd, 1140);
  const ahead = Math.max(1, Math.min(60, s.apptDaysAhead || 7));
  const earliest = Date.now() + 10 * 60000; // nothing in the next 10 minutes
  const today = istDate(new Date());
  const busy = await busyBetween(new Date(), new Date(Date.now() + (ahead + 1) * 864e5));

  const out: Date[] = [];
  for (let i = 0; i <= ahead && out.length < limit; i++) {
    const day = addDays(today, i);
    if (!days.has(isoWeekday(day))) continue;
    const free: Date[] = [];
    for (let t = startMin; t + slot <= endMin; t += slot) {
      const d = fromIst(day, minutesToHhmm(t));
      if (!d || d.getTime() < earliest) continue;
      if (overlaps(busy, d.getTime(), d.getTime() + slot * 60000)) continue;
      free.push(d);
    }
    const k = Math.min(perDay, free.length, limit - out.length);
    if (k <= 0) continue;
    if (k === free.length) out.push(...free);
    else {
      const idx = new Set<number>();
      for (let j = 0; j < k; j++) idx.add(k === 1 ? 0 : Math.round((j * (free.length - 1)) / (k - 1)));
      out.push(...[...idx].sort((x, y) => x - y).map((j) => free[j]));
    }
  }
  return out;
}

/* ------------------------------------------------------------ messaging */

export async function sendTextTo(contact: { id: string; phone: string }, text: string, sentBy: string) {
  let wamid: string | null = null;
  let error = "";
  try {
    wamid = await (await waClient()).sendText(contact.phone, text);
  } catch (e) {
    error = errorMessage(e);
  }
  await recordOutbound({ contactId: contact.id, type: "text", body: text, wamid, status: wamid ? "sent" : "failed", error, sentBy });
  return { ok: !!wamid, error };
}

export function describeAppointment(a: Pick<Appointment, "service" | "startAt">) {
  return { when: `${fmtDay(a.startAt)} at ${fmtTime(a.startAt)} (IST)`, service: a.service || "appointment" };
}

/** WhatsApp text to the customer when an appointment is confirmed / cancelled. */
export async function notifyAppointment(appointmentId: string, kind: "confirmed" | "cancelled"): Promise<{ ok: boolean; error: string }> {
  const [row] = await db
    .select({ a: appointments, phone: contacts.phone, optedOut: contacts.optedOut, contactId: contacts.id, channel: contacts.channel })
    .from(appointments)
    .innerJoin(contacts, eq(contacts.id, appointments.contactId))
    .where(eq(appointments.id, appointmentId))
    .limit(1);
  if (!row) return { ok: false, error: "No contact on this appointment." };
  if (row.optedOut) return { ok: false, error: "The contact has opted out." };
  if (row.channel !== "whatsapp") return { ok: false, error: "The contact isn’t a WhatsApp contact." };
  const { when, service } = describeAppointment(row.a);
  const text =
    kind === "confirmed"
      ? `✅ Your ${service} on ${when} is confirmed. See you then!`
      : `❌ Your ${service} on ${when} has been cancelled. Reply here if you'd like to pick another time.`;
  return sendTextTo({ id: row.contactId, phone: row.phone }, text, "bot");
}

/* ------------------------------------------------------------- reminders */

/**
 * Sends reminders for booked/confirmed appointments starting within `apptReminderHours`.
 * With a reminder template: body vars in order {{1}} name, {{2}} date, {{3}} time, {{4}} service.
 * Without one: a plain text, only while the 24h customer-care window is open.
 */
export async function runAppointmentReminders(): Promise<{ sent: number }> {
  const s = await getSettings();
  const hours = Number(s.apptReminderHours) || 0;
  if (!s.waAccessToken || !s.waPhoneNumberId || hours <= 0) return { sent: 0 };

  const tpl = s.apptReminderTemplateId
    ? (await db.select().from(templates).where(eq(templates.id, s.apptReminderTemplateId)).limit(1))[0]
    : undefined;
  const useTpl = tpl && tpl.status === "APPROVED" ? tpl : undefined;
  const now = new Date();

  const due = await db
    .select({ a: appointments, c: contacts })
    .from(appointments)
    .innerJoin(contacts, eq(contacts.id, appointments.contactId))
    .where(
      and(
        inArray(appointments.status, ["booked", "confirmed"]),
        isNull(appointments.reminderSentAt),
        gt(appointments.startAt, now),
        lte(appointments.startAt, new Date(now.getTime() + hours * 3600 * 1000)),
        eq(contacts.optedOut, false),
        eq(contacts.channel, "whatsapp"),
        useTpl ? undefined : gt(contacts.lastInboundAt, new Date(now.getTime() - WINDOW_MS + 5 * 60000)),
      ),
    )
    .orderBy(appointments.startAt)
    .limit(REMINDER_BATCH);

  let sent = 0;
  for (const { a, c } of due) {
    // claim first so overlapping cron runs never double-send
    const res = await db
      .update(appointments)
      .set({ reminderSentAt: new Date() })
      .where(and(eq(appointments.id, a.id), isNull(appointments.reminderSentAt)));
    if (!Number((res as any)?.[0]?.affectedRows ?? 1)) continue;

    const date = fmtDay(a.startAt);
    const time = fmtTime(a.startAt);
    const service = a.service || "appointment";
    const name = c.name || "there";
    if (useTpl) {
      const params = { header: [name], body: [name, date, time, service] };
      const preview = renderTemplatePreview(useTpl.components, params);
      try {
        const wamid = await (await waClient(s)).sendTemplate(c.phone, useTpl.name, useTpl.language, buildSendComponents(useTpl.components, params));
        await recordOutbound({ contactId: c.id, type: "template", body: preview, templateName: useTpl.name, wamid, status: "sent", sentBy: "bot" });
        sent++;
      } catch (e) {
        await recordOutbound({ contactId: c.id, type: "template", body: preview, templateName: useTpl.name, status: "failed", error: errorMessage(e), sentBy: "bot" });
      }
    } else {
      const r = await sendTextTo(c, `⏰ Reminder: your ${service} is on ${date} at ${time} (IST). Reply here if you need to reschedule.`, "bot");
      if (r.ok) sent++;
    }
  }
  return { sent };
}

/* ---------------------------------------------------------------- queries */

/** Appointments with contact + assignee names, ordered by start. */
export async function loadAppointments(where: SQL | undefined, limit = 500) {
  return db
    .select({
      a: appointments,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      assigneeName: users.name,
    })
    .from(appointments)
    .leftJoin(contacts, eq(contacts.id, appointments.contactId))
    .leftJoin(users, eq(users.id, appointments.assignedTo))
    .where(where)
    .orderBy(appointments.startAt)
    .limit(limit);
}
export type AppointmentRow = Awaited<ReturnType<typeof loadAppointments>>[number];
