import "server-only";
import { and, eq, gte, inArray, isNotNull, notExists, or, sql } from "drizzle-orm";
import { db, pool } from "./db";
import { contacts, dateWishes, messages, templates } from "@/db/schema";
import { waClient, errorMessage } from "./whatsapp";
import { recordOutbound } from "./messaging";
import { buildSendComponents, renderTemplatePreview, templateShape } from "./template-utils";
import { fillPlaceholders } from "@/app/(app)/drips/shared";

const IST_OFFSET_MS = 330 * 60_000;
const BATCH = 50;
const LOCK = "sm_date_wishes";

/** Current IST calendar info. */
export function istNow(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const date = ist.toISOString().slice(0, 10); // YYYY-MM-DD
  const year = ist.getUTCFullYear();
  // start of today (IST) as a real UTC instant
  const dayStart = new Date(Date.UTC(year, ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS);
  return { date, monthDay: date.slice(5), hour: ist.getUTCHours(), year, dayStart };
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Once per IST day per active wish (after its send hour): send the template to every contact whose
 * birthday/anniversary is today. Works in batches of 50 per run and only marks the day done once no
 * one is left, so a big day spreads over several cron ticks. A MySQL named lock keeps overlapping
 * runs from double-sending, and contacts already wished today (same template) are skipped.
 */
export async function runDateWishes(): Promise<{ sent: number }> {
  const { date, monthDay, hour, year, dayStart } = istNow();
  const wishes = await db.select().from(dateWishes).where(and(eq(dateWishes.active, true), isNotNull(dateWishes.templateId)));
  const due = wishes.filter((w) => w.lastRunDate !== date && hour >= w.sendHour);
  if (!due.length) return { sent: 0 };

  const conn = await pool.getConnection();
  let sent = 0;
  try {
    const [rows] = await conn.query("SELECT GET_LOCK(?, 0) AS l", [LOCK]);
    if (Number((rows as any)?.[0]?.l) !== 1) return { sent: 0 };
    try {
      // Feb 29 birthdays are celebrated on Feb 28 in non-leap years
      const days = monthDay === "02-28" && !isLeap(year) ? ["02-28", "02-29"] : [monthDay];
      for (const w of due) {
        const [tpl] = await db.select().from(templates).where(eq(templates.id, w.templateId!)).limit(1);
        if (!tpl || tpl.status !== "APPROVED" || templateShape(tpl.components).headerMedia) {
          console.warn(`[date-wishes] ${w.kind}: template missing, not approved or has a media header — skipped`);
          await db.update(dateWishes).set({ lastRunDate: date }).where(eq(dateWishes.id, w.id));
          continue;
        }
        const col = w.kind === "birthday" ? contacts.birthday : contacts.anniversary;
        const batch = await db
          .select()
          .from(contacts)
          .where(
            and(
              inArray(col, days),
              eq(contacts.optedOut, false),
              eq(contacts.channel, "whatsapp"),
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(messages)
                  .where(
                    and(
                      eq(messages.contactId, contacts.id),
                      eq(messages.sentBy, "wish"),
                      eq(messages.templateName, tpl.name),
                      gte(messages.createdAt, dayStart),
                    ),
                  ),
              ),
            ),
          )
          .limit(BATCH);

        for (const c of batch) {
          const params = { header: [] as string[], body: w.body.map((b) => fillPlaceholders(b, c)) };
          const preview = renderTemplatePreview(tpl.components, params);
          try {
            const wamid = await (await waClient()).sendTemplate(c.phone, tpl.name, tpl.language, buildSendComponents(tpl.components, params));
            await recordOutbound({ contactId: c.id, type: "template", body: preview, templateName: tpl.name, wamid, status: "sent", sentBy: "wish" });
            sent++;
          } catch (e) {
            // recorded as failed so the contact isn't retried again today
            await recordOutbound({ contactId: c.id, type: "template", body: preview, templateName: tpl.name, status: "failed", error: errorMessage(e), sentBy: "wish" });
          }
        }
        if (batch.length < BATCH) {
          await db
            .update(dateWishes)
            .set({ lastRunDate: date })
            .where(and(eq(dateWishes.id, w.id), or(sql`${dateWishes.lastRunDate} is null`, sql`${dateWishes.lastRunDate} <> ${date}`)));
        }
      }
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [LOCK]);
    }
  } finally {
    conn.release();
  }
  return { sent };
}
