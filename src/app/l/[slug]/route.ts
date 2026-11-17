import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { waLinks } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { waMeUrl } from "@/lib/link-tags";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [link] = await db.select().from(waLinks).where(eq(waLinks.slug, slug.toLowerCase())).limit(1);
  if (!link) return new Response("Link not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  await db.update(waLinks).set({ clicks: sql`${waLinks.clicks} + 1` }).where(eq(waLinks.id, link.id)).catch(() => {});
  const settings = await getSettings();
  return new Response(null, {
    status: 302,
    headers: { Location: waMeUrl(settings.waDisplayPhone, link.message), "Cache-Control": "no-store" },
  });
}
