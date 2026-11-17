"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appointments, contacts, templates, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { saveSettings } from "@/lib/settings";
import { fromIst, isSlotFree, notifyAppointment, toMinutes } from "@/lib/appointments";

type Result = { ok: boolean; message: string } | null;
const STATUSES = ["booked", "confirmed", "cancelled", "completed", "no_show"] as const;
type Status = (typeof STATUSES)[number];

function safeReturn(v: FormDataEntryValue | null): string {
  const s = String(v ?? "");
  return s.startsWith("/appointments") ? s : "/appointments";
}

export async function saveAppointment(id: string | null, _: unknown, fd: FormData): Promise<Result> {
  await requireUser();
  const str = (k: string) => String(fd.get(k) ?? "").trim();
  const contactId = str("contactId");
  const service = str("service").slice(0, 191);
  const start = fromIst(str("date"), str("time"));
  const duration = Math.round(Number(str("durationMin")));
  const notes = str("notes").slice(0, 5000);
  const assignedTo = str("assignedTo") || null;
  const status = (STATUSES as readonly string[]).includes(str("status")) ? (str("status") as Status) : "booked";

  if (!contactId) return { ok: false, message: "Choose a contact." };
  if (!start) return { ok: false, message: "Pick a valid date and time." };
  if (!Number.isFinite(duration) || duration < 5 || duration > 24 * 60) return { ok: false, message: "Duration must be 5–1440 minutes." };
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (!c) return { ok: false, message: "Contact not found." };
  if (assignedTo) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, assignedTo)).limit(1);
    if (!u) return { ok: false, message: "User not found." };
  }
  if (status !== "cancelled" && fd.get("allowOverlap") !== "on" && !(await isSlotFree(start, duration, id ?? undefined))) {
    return { ok: false, message: "This time overlaps another appointment. Tick “Allow overlap” to save anyway." };
  }

  const data = { contactId, service, startAt: start, durationMin: duration, notes, assignedTo, status };
  if (id) {
    const [prev] = await db.select({ startAt: appointments.startAt }).from(appointments).where(eq(appointments.id, id)).limit(1);
    if (!prev) return { ok: false, message: "Appointment not found." };
    const moved = prev.startAt.getTime() !== start.getTime();
    await db.update(appointments).set({ ...data, ...(moved ? { reminderSentAt: null } : {}) }).where(eq(appointments.id, id));
  } else {
    await db.insert(appointments).values({ ...data, source: "manual" });
  }
  revalidatePath("/appointments");
  redirect(safeReturn(fd.get("return")));
}

export async function setAppointmentStatus(id: string, status: string, notify: boolean): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, message: "Unknown status." };
  await db.update(appointments).set({ status: status as Status }).where(eq(appointments.id, id));
  revalidatePath("/appointments");
  if (notify && (status === "confirmed" || status === "cancelled")) {
    const r = await notifyAppointment(id, status);
    return r.ok
      ? { ok: true, message: "Status saved and the customer was notified." }
      : { ok: true, message: `Status saved, but the WhatsApp message failed: ${r.error}` };
  }
  return { ok: true, message: "Status saved." };
}

export async function deleteAppointment(id: string, returnTo: string): Promise<void> {
  await requireUser();
  await db.delete(appointments).where(eq(appointments.id, id));
  revalidatePath("/appointments");
  redirect(safeReturn(returnTo));
}

export async function saveAppointmentSettings(_: unknown, fd: FormData): Promise<Result> {
  await requireUser();
  const str = (k: string) => String(fd.get(k) ?? "").trim();
  const days = fd
    .getAll("apptDays")
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort();
  const start = str("apptStart");
  const end = str("apptEnd");
  const slot = Math.round(Number(str("apptSlotMin")));
  const ahead = Math.round(Number(str("apptDaysAhead")));
  const remind = Math.round(Number(str("apptReminderHours")));
  const tplId = str("apptReminderTemplateId");

  if (!days.length) return { ok: false, message: "Pick at least one working day." };
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return { ok: false, message: "Enter valid start and end times." };
  if (toMinutes(end, 0) <= toMinutes(start, 0)) return { ok: false, message: "End time must be after the start time." };
  if (!Number.isFinite(slot) || slot < 5 || slot > 480) return { ok: false, message: "Slot length must be 5–480 minutes." };
  if (!Number.isFinite(ahead) || ahead < 1 || ahead > 60) return { ok: false, message: "Days ahead must be 1–60." };
  if (!Number.isFinite(remind) || remind < 1 || remind > 168) return { ok: false, message: "Reminder hours must be 1–168." };
  if (tplId) {
    const [t] = await db.select({ id: templates.id }).from(templates).where(eq(templates.id, tplId)).limit(1);
    if (!t) return { ok: false, message: "Template not found." };
  }
  await saveSettings({
    apptDays: [...new Set(days)].join(","),
    apptStart: start,
    apptEnd: end,
    apptSlotMin: slot,
    apptDaysAhead: ahead,
    apptReminderHours: remind,
    apptReminderTemplateId: tplId,
  });
  revalidatePath("/appointments");
  return { ok: true, message: "Appointment settings saved." };
}
