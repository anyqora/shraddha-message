"use server";

import { revalidatePath } from "next/cache";
import { asc, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { getSettings, saveSettings } from "@/lib/settings";
import { EVENT_NAMES } from "@/lib/events";
import { contactRow, postToSheet } from "@/lib/sheets-sync";
import { assertPermission } from "@/lib/permissions";

type Result = { ok: boolean; message: string };

function validUrl(u: string) {
  try {
    const x = new URL(u);
    return x.protocol === "https:";
  } catch {
    return false;
  }
}

export async function saveSheets(_: unknown, fd: FormData): Promise<Result> {
  await assertPermission("integrations.manage");
  const url = String(fd.get("url") ?? "").trim();
  if (url && !validUrl(url)) return { ok: false, message: "Enter the https:// Web App URL from Apps Script (Deploy → Manage deployments)." };
  const events = fd.getAll("events").map(String).filter((e) => (EVENT_NAMES as string[]).includes(e));
  await saveSettings({ sheetsWebhookUrl: url, sheetsEvents: events.join(",") });
  revalidatePath("/integrations");
  return { ok: true, message: url ? "Saved. New events will be appended to your sheet." : "Saved. Google Sheets sync is off." };
}

export async function sendTestRow(): Promise<Result> {
  await assertPermission("integrations.manage");
  const s = await getSettings();
  if (!s.sheetsWebhookUrl) return { ok: false, message: "Save the Web App URL first." };
  const r = await postToSheet(s.sheetsWebhookUrl, {
    event: "test",
    data: { time: new Date().toISOString(), name: "Test contact", phone: "919999999999", email: "test@example.com", text: "Hello from Shraddha Message 👋" },
  });
  return r.ok ? { ok: true, message: "Test row sent — look for a “test” tab in your sheet." } : { ok: false, message: r.error };
}

export async function exportAllContacts(): Promise<Result> {
  await assertPermission("integrations.manage");
  await assertPermission("contacts.export");
  const s = await getSettings();
  if (!s.sheetsWebhookUrl) return { ok: false, message: "Save the Web App URL first." };
  const BATCH = 500;
  let after = "";
  let sent = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(contacts)
      .where(after ? gt(contacts.id, after) : undefined)
      .orderBy(asc(contacts.id))
      .limit(BATCH);
    if (!rows.length) break;
    const r = await postToSheet(s.sheetsWebhookUrl, { event: "contacts", rows: rows.map((c) => contactRow(c)) }, 60_000);
    if (!r.ok) return { ok: false, message: `Stopped after ${sent.toLocaleString("en-IN")} contacts: ${r.error}` };
    sent += rows.length;
    after = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }
  return { ok: true, message: `Exported ${sent.toLocaleString("en-IN")} contacts to the “contacts” tab.` };
}
