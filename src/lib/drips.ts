import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { contacts, dripEnrollments, dripSequences, templates, type Contact, type DripStep, type Template } from "@/db/schema";
import { waClient, errorMessage } from "./whatsapp";
import { recordOutbound } from "./messaging";
import { buildSendComponents, renderTemplatePreview, templateShape } from "./template-utils";
import { fillPlaceholders } from "@/app/(app)/drips/shared";
import type { AppEvent } from "./events";

const BATCH = 50;
const HOUR = 3600_000;
const WINDOW_MS = 24 * HOUR;

export const affectedRows = (res: unknown) => Number((res as any)?.[0]?.affectedRows ?? (res as any)?.affectedRows ?? 0);

/**
 * Enroll contacts into a sequence. Existing enrollments (any status) are left alone so nobody gets
 * the same drip twice; remove an enrollment first to restart it. Opted-out contacts are skipped.
 */
export async function enrollContacts(sequenceId: string, contactIds: string[]): Promise<number> {
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (!ids.length) return 0;
  const [seq] = await db.select().from(dripSequences).where(eq(dripSequences.id, sequenceId)).limit(1);
  if (!seq || !seq.steps.length) return 0;
  const nextAt = new Date(Date.now() + Math.max(0, seq.steps[0].delayHours || 0) * HOUR);
  let added = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const eligible = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(inArray(contacts.id, chunk), eq(contacts.optedOut, false)));
    if (!eligible.length) continue;
    const res = await db
      .insert(dripEnrollments)
      .ignore()
      .values(eligible.map((c) => ({ id: crypto.randomUUID(), sequenceId, contactId: c.id, stepIndex: 0, nextAt, status: "active" as const })));
    added += affectedRows(res);
  }
  return added;
}

export async function handleEvent(event: AppEvent): Promise<void> {
  if (event.name === "contact.list_added") {
    const seqs = await db
      .select({ id: dripSequences.id })
      .from(dripSequences)
      .where(and(eq(dripSequences.listId, event.listId), eq(dripSequences.active, true)));
    for (const s of seqs) await enrollContacts(s.id, [event.contactId]);
    return;
  }
  if (event.name === "message.received") {
    await db
      .update(dripEnrollments)
      .set({ status: "stopped", nextAt: null, error: "Contact replied" })
      .where(
        and(
          eq(dripEnrollments.contactId, event.contactId),
          eq(dripEnrollments.status, "active"),
          inArray(dripEnrollments.sequenceId, db.select({ id: dripSequences.id }).from(dripSequences).where(eq(dripSequences.stopOnReply, true))),
        ),
      );
  }
}

async function sendStep(step: DripStep, c: Contact, tplCache: Map<string, Template | null>) {
  if (step.kind === "text") {
    const text = fillPlaceholders(step.text ?? "", c);
    if (!text.trim()) throw new Error("Step has no text.");
    if (c.channel === "web") {
      await recordOutbound({ contactId: c.id, type: "text", body: text, status: "sent", sentBy: "drip" });
      return;
    }
    if (!c.lastInboundAt || Date.now() - new Date(c.lastInboundAt).getTime() > WINDOW_MS) {
      throw new Error("Outside WhatsApp's 24-hour window — text steps need a recent reply. Use a template step instead.");
    }
    try {
      const wamid = await (await waClient()).sendText(c.phone, text);
      await recordOutbound({ contactId: c.id, type: "text", body: text, wamid, status: "sent", sentBy: "drip" });
    } catch (e) {
      const msg = errorMessage(e);
      await recordOutbound({ contactId: c.id, type: "text", body: text, status: "failed", error: msg, sentBy: "drip" });
      throw new Error(msg);
    }
    return;
  }

  if (c.channel === "web") throw new Error("Templates can only be sent to WhatsApp contacts.");
  const tid = step.templateId ?? "";
  if (!tplCache.has(tid)) {
    const [t] = tid ? await db.select().from(templates).where(eq(templates.id, tid)).limit(1) : [];
    tplCache.set(tid, t ?? null);
  }
  const tpl = tplCache.get(tid);
  if (!tpl) throw new Error("Template not found (deleted?).");
  if (tpl.status !== "APPROVED") throw new Error(`Template “${tpl.name}” is not approved (${tpl.status}).`);
  if (templateShape(tpl.components).headerMedia) throw new Error(`Template “${tpl.name}” has a media header, which drips can’t send.`);
  const params = { header: [] as string[], body: (step.body ?? []).map((b) => fillPlaceholders(b, c)) };
  const preview = renderTemplatePreview(tpl.components, params);
  try {
    const wamid = await (await waClient()).sendTemplate(c.phone, tpl.name, tpl.language, buildSendComponents(tpl.components, params));
    await recordOutbound({ contactId: c.id, type: "template", body: preview, templateName: tpl.name, wamid, status: "sent", sentBy: "drip" });
  } catch (e) {
    const msg = errorMessage(e);
    await recordOutbound({ contactId: c.id, type: "template", body: preview, templateName: tpl.name, status: "failed", error: msg, sentBy: "drip" });
    throw new Error(msg);
  }
}

/** Send every due drip step (≤50 per run). Safe to run concurrently: each enrollment is claimed atomically. */
export async function runDueDrips(): Promise<{ sent: number }> {
  const now = new Date();

  // recover enrollments whose claim was lost (process died mid-send) — retried after 30 min
  await db
    .update(dripEnrollments)
    .set({ nextAt: now })
    .where(and(eq(dripEnrollments.status, "active"), isNull(dripEnrollments.nextAt), lt(dripEnrollments.updatedAt, new Date(now.getTime() - 30 * 60_000))));

  const due = await db
    .select({ e: dripEnrollments, steps: dripSequences.steps })
    .from(dripEnrollments)
    .innerJoin(dripSequences, eq(dripSequences.id, dripEnrollments.sequenceId))
    .where(and(eq(dripEnrollments.status, "active"), isNotNull(dripEnrollments.nextAt), lte(dripEnrollments.nextAt, now), eq(dripSequences.active, true)))
    .orderBy(asc(dripEnrollments.nextAt))
    .limit(BATCH);

  const tplCache = new Map<string, Template | null>();
  let sent = 0;
  for (const { e, steps } of due) {
    // claim: only one runner can null out next_at while it is still due
    const claim = await db
      .update(dripEnrollments)
      .set({ nextAt: null })
      .where(and(eq(dripEnrollments.id, e.id), eq(dripEnrollments.status, "active"), isNotNull(dripEnrollments.nextAt), lte(dripEnrollments.nextAt, now)));
    if (affectedRows(claim) !== 1) continue;

    const finish = (set: Partial<typeof dripEnrollments.$inferInsert>) => db.update(dripEnrollments).set(set).where(eq(dripEnrollments.id, e.id));

    const step = steps[e.stepIndex];
    if (!step) {
      await finish({ status: "completed", nextAt: null });
      continue;
    }
    const [c] = await db.select().from(contacts).where(eq(contacts.id, e.contactId)).limit(1);
    if (!c) {
      await finish({ status: "stopped", error: "Contact was deleted" });
      continue;
    }
    if (c.optedOut) {
      await finish({ status: "stopped", error: "Contact opted out" });
      continue;
    }
    try {
      await sendStep(step, c, tplCache);
      sent++;
    } catch (err) {
      await finish({ status: "failed", error: errorMessage(err).slice(0, 500) });
      continue;
    }
    const next = e.stepIndex + 1;
    if (next < steps.length) {
      await finish({ stepIndex: next, nextAt: new Date(Date.now() + Math.max(0, steps[next].delayHours || 0) * HOUR), error: "" });
    } else {
      await finish({ stepIndex: next, status: "completed", nextAt: null, error: "" });
    }
  }
  return { sent };
}

export async function stopEnrollments(ids: string[]) {
  if (!ids.length) return;
  await db
    .update(dripEnrollments)
    .set({ status: "stopped", nextAt: null, error: "Stopped manually" })
    .where(and(inArray(dripEnrollments.id, ids), ne(dripEnrollments.status, "completed")));
}

/** sequenceId → { active, completed, stopped, failed } counts. */
export async function enrollmentCounts() {
  const rows = await db
    .select({ sequenceId: dripEnrollments.sequenceId, status: dripEnrollments.status, n: sql<number>`count(*)` })
    .from(dripEnrollments)
    .groupBy(dripEnrollments.sequenceId, dripEnrollments.status);
  const out = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const m = out.get(r.sequenceId) ?? {};
    m[r.status] = Number(r.n);
    out.set(r.sequenceId, m);
  }
  return out;
}
