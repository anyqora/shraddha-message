import { desc, eq, like, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts } from "@/db/schema";
import { apiError, authenticateApi, readJson } from "@/lib/api-auth";
import { getSettings } from "@/lib/settings";
import { normalizePhone } from "@/lib/phone";
import { emit } from "@/lib/events";
import { contactJson, pageOf, PAGE_SIZE } from "../serialize";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateApi(req);
  if (auth instanceof Response) return auth;
  const url = new URL(req.url);
  const page = pageOf(url);
  const q = (url.searchParams.get("q") ?? "").trim();
  let where;
  if (q) {
    const pat = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    const digits = q.replace(/\D/g, "");
    where = or(like(contacts.name, pat), like(contacts.email, pat), ...(digits.length >= 3 ? [like(contacts.phone, `%${digits}%`)] : []));
  }
  const [rows, [{ n }]] = await Promise.all([
    db.select().from(contacts).where(where).orderBy(desc(contacts.createdAt)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ n: sql<number>`count(*)` }).from(contacts).where(where),
  ]);
  const total = Number(n);
  return Response.json({
    data: rows.map(contactJson),
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
  const phone = normalizePhone(String(body.phone ?? ""), s.defaultCountryCode);
  if (!phone) return apiError("`phone` is missing or invalid.", 422);

  const patch: Partial<typeof contacts.$inferInsert> = {};
  if (typeof body.name === "string") patch.name = body.name.trim().slice(0, 191);
  if (typeof body.email === "string") patch.email = body.email.trim().slice(0, 191);
  if (body.custom !== undefined) {
    if (!body.custom || typeof body.custom !== "object" || Array.isArray(body.custom)) return apiError("`custom` must be an object.", 422);
  }
  const customIn: Record<string, string> = {};
  for (const [k, v] of Object.entries((body.custom ?? {}) as Record<string, unknown>)) {
    if (v !== null && v !== undefined) customIn[String(k).slice(0, 64)] = String(v);
  }

  const [existing] = await db.select().from(contacts).where(eq(contacts.phone, phone)).limit(1);
  if (existing) {
    const set = { ...patch, ...(Object.keys(customIn).length ? { custom: { ...(existing.custom ?? {}), ...customIn } } : {}) };
    if (Object.keys(set).length) await db.update(contacts).set(set).where(eq(contacts.id, existing.id));
    const [row] = await db.select().from(contacts).where(eq(contacts.id, existing.id)).limit(1);
    return Response.json({ data: contactJson(row), created: false });
  }

  const id = crypto.randomUUID();
  try {
    await db.insert(contacts).values({ id, phone, ...patch, custom: customIn });
  } catch (e: any) {
    if (e?.code !== "ER_DUP_ENTRY") throw e;
    // lost a race with a concurrent insert: fall through and return the row
  }
  const [row] = await db.select().from(contacts).where(eq(contacts.phone, phone)).limit(1);
  if (row.id === id) await emit({ name: "contact.created", contactId: id });
  return Response.json({ data: contactJson(row), created: row.id === id }, { status: row.id === id ? 201 : 200 });
}
