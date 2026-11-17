import { eq } from "drizzle-orm";
import { leads } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { LEAD_STATUSES, leadsCsv, loadLeads, type LeadStatus } from "@/lib/leads";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const st = new URL(req.url).searchParams.get("status");
  const status = LEAD_STATUSES.includes(st as LeadStatus) ? (st as LeadStatus) : null;
  const rows = await loadLeads(status ? eq(leads.status, status) : undefined, 20000);
  await audit("lead.export", { entity: "lead", summary: `CSV ${status ?? "all"} (${rows.length})` });
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Response(leadsCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${status ?? "all"}-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
