import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, messages, templates } from "@/db/schema";
import { apiError, authenticateApi, readJson } from "@/lib/api-auth";
import { getSettings } from "@/lib/settings";
import { normalizePhone } from "@/lib/phone";
import { emit } from "@/lib/events";
import { errorMessage, waClient } from "@/lib/whatsapp";
import { recordOutbound } from "@/lib/messaging";
import { buildSendComponents, renderTemplatePreview } from "@/lib/template-utils";
import { messageJson, pageOf, PAGE_SIZE } from "../serialize";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateApi(req);
  if (auth instanceof Response) return auth;
  const url = new URL(req.url);
  const s = await getSettings();
  const phone = normalizePhone(url.searchParams.get("contact") ?? "", s.defaultCountryCode);
  if (!phone) return apiError("Pass `contact` (the contact's phone number).", 422);
  const [c] = await db.select().from(contacts).where(eq(contacts.phone, phone)).limit(1);
  if (!c) return apiError("Contact not found.", 404);
  const page = pageOf(url);
  const where = eq(messages.contactId, c.id);
  const [rows, [{ n }]] = await Promise.all([
    db.select().from(messages).where(where).orderBy(desc(messages.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ n: sql<number>`count(*)` }).from(messages).where(where),
  ]);
  const total = Number(n);
  return Response.json({
    contact: { id: c.id, phone: c.phone, name: c.name },
    data: rows.map(messageJson),
    page,
    per_page: PAGE_SIZE,
    total,
    has_more: page * PAGE_SIZE < total,
  });
}

export async function POST(req: Request) {
  const auth = await authenticateApi(req);
  if (auth instanceof Response) return auth;
  const body = await readJson(req);
  if (!body) return apiError("Send a JSON object body.");
  const s = await getSettings();
  const phone = normalizePhone(String(body.to ?? ""), s.defaultCountryCode);
  if (!phone) return apiError("`to` is missing or invalid.", 422);

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const tpl = body.template && typeof body.template === "object" ? (body.template as Record<string, unknown>) : null;
  if (!text && !tpl) return apiError("Send either `text` or `template`.", 422);
  if (text && text.length > 4096) return apiError("`text` is longer than 4096 characters.", 422);
  if (tpl && (typeof tpl.name !== "string" || !tpl.name)) return apiError("`template.name` is required.", 422);
  const asStrings = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "")) : []);

  let wa;
  try {
    wa = await waClient(s);
  } catch (e) {
    return apiError(errorMessage(e), 503);
  }

  // find or create the contact
  let [c] = await db.select().from(contacts).where(eq(contacts.phone, phone)).limit(1);
  if (!c) {
    const id = crypto.randomUUID();
    try {
      await db.insert(contacts).values({ id, phone, name: typeof body.name === "string" ? body.name.trim().slice(0, 191) : "" });
    } catch (e: any) {
      if (e?.code !== "ER_DUP_ENTRY") throw e;
    }
    [c] = await db.select().from(contacts).where(eq(contacts.phone, phone)).limit(1);
    if (c.id === id) await emit({ name: "contact.created", contactId: id });
  }
  if (c.optedOut) return apiError("This contact has opted out of messages.", 409);

  let type = "text";
  let preview = text;
  let templateName: string | null = null;
  let send: () => Promise<string>;

  if (tpl) {
    const name = String(tpl.name);
    const language = typeof tpl.language === "string" && tpl.language ? tpl.language : "";
    const params = { header: asStrings(tpl.header), body: asStrings(tpl.body) };
    const where = language ? and(eq(templates.name, name), eq(templates.language, language)) : eq(templates.name, name);
    const [t] = await db.select().from(templates).where(where).limit(1);
    if (!t && !language) return apiError("Template not found locally — pass `template.language` too.", 422);
    type = "template";
    templateName = name;
    if (t) {
      preview = renderTemplatePreview(t.components, params);
      send = () => wa.sendTemplate(phone, t.name, t.language, buildSendComponents(t.components, params));
    } else {
      // not synced locally: send the raw body parameters
      const components: unknown[] = [];
      if (params.header.length) components.push({ type: "header", parameters: params.header.map((x) => ({ type: "text", text: x })) });
      if (params.body.length) components.push({ type: "body", parameters: params.body.map((x) => ({ type: "text", text: x })) });
      preview = `[template ${name}] ${params.body.join(" · ")}`.trim();
      send = () => wa.sendTemplate(phone, name, language, components);
    }
  } else {
    send = () => wa.sendText(phone, text);
  }

  try {
    const wamid = await send();
    await recordOutbound({ contactId: c.id, type, body: preview, templateName, wamid, status: "sent", sentBy: "api" });
    return Response.json({ data: { contact_id: c.id, to: phone, wamid, status: "sent", type } }, { status: 201 });
  } catch (e) {
    const msg = errorMessage(e);
    await recordOutbound({ contactId: c.id, type, body: preview, templateName, status: "failed", error: msg, sentBy: "api" });
    return apiError(msg, 502, { contact_id: c.id });
  }
}
