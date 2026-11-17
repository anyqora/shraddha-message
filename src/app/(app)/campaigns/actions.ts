"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaignRecipients, campaigns, contacts, listMembers, lists, templates, type VarSource } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { normalizePhone } from "@/lib/phone";
import { resolveSource, templateShape } from "@/lib/template-utils";
import { errorMessage, waClient } from "@/lib/whatsapp";
import { runCampaigns } from "@/lib/campaign-runner";
import { getSegment, segmentWhere } from "@/lib/segments";

export type CampaignInput = {
  name: string;
  templateId: string;
  audience:
    | { kind: "list"; listId: string }
    | { kind: "segment"; segmentId: string }
    | { kind: "csv"; fileName: string; phoneColumn: string; nameColumn: string; rows: Record<string, string>[] };
  mapping: { header: VarSource[]; body: VarSource[] };
  scheduleAt: string | null; // ISO
};

export async function createCampaign(_: unknown, fd: FormData): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  let id = "";
  try {
    const input = JSON.parse(String(fd.get("payload") ?? "{}")) as CampaignInput;
    if (!input.name?.trim()) throw new Error("Give the campaign a name.");
    const [tpl] = await db.select().from(templates).where(eq(templates.id, input.templateId)).limit(1);
    if (!tpl) throw new Error("Choose a template.");
    if (tpl.status !== "APPROVED") throw new Error("Only APPROVED templates can be sent.");
    const shape = templateShape(tpl.components);
    const settings = await getSettings();

    let headerMediaId: string | null = null;
    let headerMediaType: string | null = null;
    if (shape.headerMedia) {
      const f = fd.get("header_file");
      if (!(f instanceof File) || !f.size) throw new Error(`This template needs a header ${shape.headerFormat?.toLowerCase()} — upload the file.`);
      const wa = await waClient(settings);
      headerMediaId = await wa.uploadMedia(f, f.name);
      headerMediaType = shape.headerFormat!.toLowerCase();
    }

    type R = { contactId: string; phone: string; name: string; params: { header: string[]; body: string[] } };
    const recips: R[] = [];
    let skipped = 0;
    let audience = "";
    const build = (c: { name: string; phone: string; email: string; custom: Record<string, string> }, row?: Record<string, string>) => ({
      header: input.mapping.header.slice(0, shape.headerVars).map((s) => resolveSource(s, c, row)),
      body: input.mapping.body.slice(0, shape.bodyVars).map((s) => resolveSource(s, c, row)),
    });

    if (input.audience.kind === "list") {
      const listId = input.audience.listId;
      const [l] = await db.select().from(lists).where(eq(lists.id, listId)).limit(1);
      if (!l) throw new Error("Choose a list.");
      audience = `List: ${l.name}`;
      const rows = await db
        .select({ id: contacts.id, phone: contacts.phone, name: contacts.name, email: contacts.email, custom: contacts.custom, optedOut: contacts.optedOut })
        .from(listMembers)
        .innerJoin(contacts, eq(contacts.id, listMembers.contactId))
        .where(eq(listMembers.listId, listId));
      for (const c of rows) {
        if (c.optedOut) skipped++;
        else recips.push({ contactId: c.id, phone: c.phone, name: c.name, params: build(c) });
      }
    } else if (input.audience.kind === "segment") {
      const seg = await getSegment(input.audience.segmentId);
      if (!seg) throw new Error("Choose a segment.");
      audience = `Segment: ${seg.name}`;
      const rows = await db
        .select({ id: contacts.id, phone: contacts.phone, name: contacts.name, email: contacts.email, custom: contacts.custom, optedOut: contacts.optedOut, channel: contacts.channel })
        .from(contacts)
        .where(segmentWhere(seg));
      for (const c of rows) {
        if (c.optedOut) skipped++;
        else if (c.channel !== "whatsapp" || !c.phone) skipped++;
        else recips.push({ contactId: c.id, phone: c.phone, name: c.name, params: build(c) });
      }
    } else {
      const a = input.audience;
      audience = `File: ${a.fileName}`;
      const byPhone = new Map<string, Record<string, string>>();
      for (const row of a.rows) {
        const p = normalizePhone(row[a.phoneColumn] ?? "", settings.defaultCountryCode);
        if (p && !byPhone.has(p)) byPhone.set(p, row);
      }
      const phones = [...byPhone.keys()];
      for (let i = 0; i < phones.length; i += 500) {
        const chunk = phones.slice(i, i + 500);
        await db
          .insert(contacts)
          .values(chunk.map((p) => ({ id: crypto.randomUUID(), phone: p, name: a.nameColumn ? (byPhone.get(p)![a.nameColumn] ?? "").slice(0, 191) : "" })))
          .onDuplicateKeyUpdate({ set: { name: sql`if(${contacts.name} = '', values(${contacts.name}), ${contacts.name})` } });
      }
      for (let i = 0; i < phones.length; i += 1000) {
        const got = await db.select().from(contacts).where(inArray(contacts.phone, phones.slice(i, i + 1000)));
        for (const c of got) {
          if (c.optedOut) skipped++;
          else recips.push({ contactId: c.id, phone: c.phone, name: c.name, params: build(c, byPhone.get(c.phone)) });
        }
      }
    }
    if (!recips.length) throw new Error(skipped ? "Everyone in this audience has opted out." : "The audience has no valid phone numbers.");

    const schedule = input.scheduleAt ? new Date(input.scheduleAt) : new Date();
    id = crypto.randomUUID();
    await db.insert(campaigns).values({
      id,
      name: input.name.trim().slice(0, 191),
      templateId: tpl.id,
      templateName: tpl.name,
      templateLanguage: tpl.language,
      status: "scheduled",
      scheduledAt: schedule,
      audience: audience.slice(0, 255),
      headerMediaId,
      headerMediaType,
      mapping: input.mapping,
      total: recips.length,
      skipped,
      createdBy: user.id,
    });
    for (let i = 0; i < recips.length; i += 500) {
      await db.insert(campaignRecipients).values(
        recips.slice(i, i + 500).map((r) => ({ campaignId: id, contactId: r.contactId, phone: r.phone, name: r.name.slice(0, 191), params: r.params })),
      );
    }
    if (schedule.getTime() <= Date.now() + 5000) after(() => runCampaigns(55_000).catch(() => {}));
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
  revalidatePath("/campaigns");
  redirect(`/campaigns/${id}`);
}

export async function setCampaignStatus(id: string, status: "paused" | "running") {
  await requireUser();
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  if (!c) return;
  if (status === "paused" && (c.status === "running" || c.status === "scheduled")) {
    await db.update(campaigns).set({ status: "paused" }).where(eq(campaigns.id, id));
  }
  if (status === "running" && c.status === "paused") {
    await db.update(campaigns).set({ status: "running", lastError: "", startedAt: c.startedAt ?? new Date() }).where(eq(campaigns.id, id));
    after(() => runCampaigns(55_000).catch(() => {}));
  }
  revalidatePath(`/campaigns/${id}`);
}

export async function retryFailed(id: string) {
  await requireUser();
  await db
    .update(campaignRecipients)
    .set({ status: "pending", error: "", wamid: null })
    .where(and(eq(campaignRecipients.campaignId, id), eq(campaignRecipients.status, "failed")));
  await db.update(campaigns).set({ status: "running", completedAt: null, lastError: "" }).where(eq(campaigns.id, id));
  after(() => runCampaigns(55_000).catch(() => {}));
  revalidatePath(`/campaigns/${id}`);
}

export async function deleteCampaign(id: string) {
  await requireUser();
  await db.delete(campaignRecipients).where(eq(campaignRecipients.campaignId, id));
  await db.delete(campaigns).where(eq(campaigns.id, id));
  revalidatePath("/campaigns");
  redirect("/campaigns");
}
