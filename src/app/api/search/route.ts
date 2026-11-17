import { desc, like, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, contacts, lists, templates } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await getCurrentUser())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q) return Response.json({ contacts: [], templates: [], campaigns: [], lists: [] });
  const t = `%${q}%`;
  const digits = q.replace(/\D/g, "");
  const [c, tp, cp, ls] = await Promise.all([
    db
      .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
      .from(contacts)
      .where(digits.length >= 3 ? or(like(contacts.name, t), like(contacts.phone, `%${digits}%`), like(contacts.email, t)) : or(like(contacts.name, t), like(contacts.email, t)))
      .orderBy(desc(contacts.lastMessageAt))
      .limit(8),
    db.select({ id: templates.id, name: templates.name, status: templates.status }).from(templates).where(like(templates.name, t)).limit(5),
    db.select({ id: campaigns.id, name: campaigns.name, status: campaigns.status }).from(campaigns).where(like(campaigns.name, t)).orderBy(desc(campaigns.createdAt)).limit(5),
    db.select({ id: lists.id, name: lists.name }).from(lists).where(like(lists.name, t)).limit(5),
  ]);
  return Response.json({ contacts: c, templates: tp, campaigns: cp, lists: ls });
}
