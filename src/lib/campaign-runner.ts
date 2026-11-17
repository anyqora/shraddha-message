import "server-only";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, pool } from "./db";
import { campaignRecipients, campaigns, contacts, templates } from "@/db/schema";
import { getSettings } from "./settings";
import { waClient, errorMessage } from "./whatsapp";
import { buildSendComponents, renderTemplatePreview } from "./template-utils";
import { recordOutbound } from "./messaging";
import { sleep } from "./utils";
import { emit } from "./events";

/**
 * Sends pending campaign messages with throttling.
 * Safe to call often (cron every minute + right after "send now"): a MySQL
 * named lock makes sure only one runner works at a time.
 */
export async function runCampaigns(budgetMs = 50_000): Promise<{ sent: number; failed: number; note?: string }> {
  const conn = await pool.getConnection();
  const started = Date.now();
  let sent = 0;
  let failed = 0;
  try {
    const [lockRows] = await conn.query("select get_lock('sm_campaign_runner', 0) as l");
    if ((lockRows as { l: number }[])[0]?.l !== 1) return { sent, failed, note: "another runner is active" };

    await db
      .update(campaigns)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(campaigns.status, "scheduled"), lte(campaigns.scheduledAt, new Date())));

    const running = await db.select().from(campaigns).where(eq(campaigns.status, "running")).orderBy(asc(campaigns.scheduledAt));
    if (!running.length) return { sent, failed };

    const settings = await getSettings();
    let wa: Awaited<ReturnType<typeof waClient>>;
    try {
      wa = await waClient(settings);
    } catch (e) {
      await db.update(campaigns).set({ lastError: errorMessage(e).slice(0, 500) }).where(inArray(campaigns.id, running.map((c) => c.id)));
      return { sent, failed, note: errorMessage(e) };
    }
    const gap = Math.ceil(60_000 / Math.max(1, settings.throttlePerMinute));

    for (const c of running) {
      const tpl = c.templateId
        ? (await db.select().from(templates).where(eq(templates.id, c.templateId)).limit(1))[0]
        : (await db.select().from(templates).where(and(eq(templates.name, c.templateName), eq(templates.language, c.templateLanguage))).limit(1))[0];
      if (!tpl) {
        await db.update(campaigns).set({ status: "failed", lastError: "Template not found — sync templates and retry." }).where(eq(campaigns.id, c.id));
        continue;
      }
      const headerMedia = c.headerMediaId ? { id: c.headerMediaId, type: c.headerMediaType ?? "image" } : null;

      while (Date.now() - started < budgetMs) {
        const batch = await db
          .select({ r: campaignRecipients, optedOut: contacts.optedOut })
          .from(campaignRecipients)
          .leftJoin(contacts, eq(contacts.id, campaignRecipients.contactId))
          .where(and(eq(campaignRecipients.campaignId, c.id), eq(campaignRecipients.status, "pending")))
          .limit(25);
        if (!batch.length) {
          await db.update(campaigns).set({ status: "completed", completedAt: new Date() }).where(eq(campaigns.id, c.id));
          await emit({ name: "campaign.completed", campaignId: c.id });
          break;
        }
        // stop if the campaign was paused meanwhile
        const [fresh] = await db.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.id, c.id));
        if (fresh?.status !== "running") break;

        for (const { r, optedOut } of batch) {
          if (Date.now() - started >= budgetMs) break;
          if (optedOut) {
            await db.update(campaignRecipients).set({ status: "skipped", error: "Contact opted out" }).where(eq(campaignRecipients.id, r.id));
            continue;
          }
          const t0 = Date.now();
          try {
            const wamid = await wa.sendTemplate(r.phone, tpl.name, tpl.language, buildSendComponents(tpl.components, r.params, headerMedia));
            await db.update(campaignRecipients).set({ status: "sent", wamid, sentAt: new Date(), error: "" }).where(eq(campaignRecipients.id, r.id));
            if (r.contactId) {
              await recordOutbound({
                contactId: r.contactId,
                type: "template",
                body: renderTemplatePreview(tpl.components, r.params),
                templateName: tpl.name,
                wamid,
                status: "sent",
                campaignId: c.id,
              });
            }
            sent++;
          } catch (e) {
            const msg = errorMessage(e);
            await db.update(campaignRecipients).set({ status: "failed", error: msg.slice(0, 500) }).where(eq(campaignRecipients.id, r.id));
            failed++;
            // Account-level problems: pause instead of failing every recipient.
            if (/token|OAuthException|permission|not connected|(#?190)|(#?10\b)/i.test(msg)) {
              await db.update(campaigns).set({ status: "paused", lastError: msg.slice(0, 500) }).where(eq(campaigns.id, c.id));
              return { sent, failed, note: msg };
            }
          }
          const wait = gap - (Date.now() - t0);
          if (wait > 0) await sleep(wait);
        }
      }
      if (Date.now() - started >= budgetMs) break;
    }
    return { sent, failed };
  } finally {
    await conn.query("select release_lock('sm_campaign_runner')").catch(() => {});
    conn.release();
  }
}

export async function campaignStats(ids: string[]) {
  if (!ids.length) return new Map<string, Record<string, number>>();
  const rows = await db
    .select({ id: campaignRecipients.campaignId, status: campaignRecipients.status, n: sql<number>`count(*)` })
    .from(campaignRecipients)
    .where(inArray(campaignRecipients.campaignId, ids))
    .groupBy(campaignRecipients.campaignId, campaignRecipients.status);
  const m = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const s = m.get(r.id) ?? {};
    s[r.status] = Number(r.n);
    m.set(r.id, s);
  }
  return m;
}

/** sent column counts every message that left the system (delivered/read imply sent). */
export function summarize(s: Record<string, number> = {}) {
  const read = s.read ?? 0;
  const delivered = (s.delivered ?? 0) + read;
  const sent = (s.sent ?? 0) + delivered;
  return { pending: s.pending ?? 0, sent, delivered, read, failed: s.failed ?? 0, skipped: s.skipped ?? 0 };
}
