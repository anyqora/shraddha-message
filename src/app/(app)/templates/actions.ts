"use server";

import { revalidatePath } from "next/cache";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { templates, type TemplateComponent } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { errorMessage, waClient } from "@/lib/whatsapp";
import { countVars } from "@/lib/template-utils";
import { assertPermission } from "@/lib/permissions";

export async function syncTemplates(): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  try {
    const wa = await waClient();
    const list = await wa.listTemplates();
    for (const t of list) {
      const data = {
        metaId: t.id,
        category: t.category ?? "MARKETING",
        status: t.status ?? "PENDING",
        rejectedReason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : "",
        components: (t.components ?? []) as TemplateComponent[],
      };
      await db
        .insert(templates)
        .values({ name: t.name, language: t.language, ...data })
        .onDuplicateKeyUpdate({ set: data });
    }
    // Templates deleted on Meta: remove local copies that came from Meta
    const keep = list.map((t) => t.id);
    if (keep.length) await db.delete(templates).where(and(notInArray(templates.metaId, keep)));
    revalidatePath("/templates");
    return { ok: true, message: `Synced ${list.length} templates from Meta.` };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

export async function createTemplate(_: unknown, fd: FormData): Promise<{ ok: boolean; message: string }> {
  await assertPermission("templates.manage");
  try {
    const name = String(fd.get("name") ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    if (!name) throw new Error("Template name is required (lowercase letters, numbers, underscore).");
    const language = String(fd.get("language") ?? "en");
    const category = String(fd.get("category") ?? "MARKETING");
    const headerType = String(fd.get("header_type") ?? "NONE");
    const headerText = String(fd.get("header_text") ?? "").trim();
    const body = String(fd.get("body") ?? "").trim();
    const footer = String(fd.get("footer") ?? "").trim();
    if (!body) throw new Error("Body text is required.");

    const wa = await waClient();
    const components: Record<string, unknown>[] = [];

    if (headerType === "TEXT" && headerText) {
      const n = countVars(headerText);
      components.push({
        type: "HEADER",
        format: "TEXT",
        text: headerText,
        ...(n ? { example: { header_text: [String(fd.get("header_example") ?? "Sample")] } } : {}),
      });
    } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerType)) {
      const f = fd.get("header_file");
      if (!(f instanceof File) || !f.size) throw new Error("Upload a sample file for the header.");
      const handle = await wa.uploadTemplateSample(f, f.name);
      components.push({ type: "HEADER", format: headerType, example: { header_handle: [handle] } });
    }

    const nBody = countVars(body);
    const examples = fd.getAll("body_example").map(String).slice(0, nBody);
    if (nBody && examples.filter(Boolean).length < nBody) throw new Error(`Give an example value for each of the ${nBody} body variables.`);
    components.push({ type: "BODY", text: body, ...(nBody ? { example: { body_text: [examples] } } : {}) });
    if (footer) components.push({ type: "FOOTER", text: footer });

    const btnTypes = fd.getAll("btn_type").map(String);
    const btnText = fd.getAll("btn_text").map(String);
    const btnValue = fd.getAll("btn_value").map(String);
    const buttons = btnTypes
      .map((t, i) => {
        const text = (btnText[i] ?? "").trim();
        const v = (btnValue[i] ?? "").trim();
        if (!text) return null;
        if (t === "URL") return { type: "URL", text, url: v };
        if (t === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text, phone_number: v };
        return { type: "QUICK_REPLY", text };
      })
      .filter(Boolean);
    if (buttons.length) components.push({ type: "BUTTONS", buttons });

    const r = await wa.createTemplate({ name, language, category, components });
    await db
      .insert(templates)
      .values({ name, language, category: r.category ?? category, status: r.status ?? "PENDING", metaId: r.id, components: components as TemplateComponent[] })
      .onDuplicateKeyUpdate({ set: { status: r.status ?? "PENDING", metaId: r.id, components: components as TemplateComponent[] } });
    revalidatePath("/templates");
    return { ok: true, message: `Template “${name}” submitted to Meta — status: ${r.status ?? "PENDING"}.` };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

export async function deleteTemplate(id: string): Promise<{ ok: boolean; message: string }> {
  await assertPermission("templates.manage");
  const [t] = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
  if (!t) return { ok: true, message: "Already deleted" };
  try {
    if (t.metaId) await (await waClient()).deleteTemplate(t.name);
    await db.delete(templates).where(eq(templates.id, id));
    revalidatePath("/templates");
    return { ok: true, message: "Deleted" };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}
