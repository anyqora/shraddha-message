import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { parseRange, reportCsv } from "@/lib/reports";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ tab: string }> }) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can(me, "reports.view"))) return Response.json({ error: "Not allowed" }, { status: 403 });
  const { tab } = await params;
  const q = new URL(req.url).searchParams;
  const r = parseRange({ from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, range: q.get("range") ?? undefined });
  const rate = q.has("rate") ? Number(q.get("rate")) : undefined;
  const csv = await reportCsv(tab, r, { rate });
  if (csv === null) return Response.json({ error: "Unknown report" }, { status: 404 });
  await audit("report.export", { entity: "report", entityId: tab, summary: `CSV ${tab} ${r.fromDay}..${r.toDay}` });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="report-${tab}-${r.fromDay}-to-${r.toDay}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
