import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { columnsOf, findTable, readRows, streamFrom } from "../tables";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : typeof v === "boolean" ? (v ? "1" : "0") : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await can(me, "backup.download"))) return Response.json({ error: "Not allowed" }, { status: 403 });
  const t = findTable(new URL(req.url).searchParams.get("table"));
  if (!t) return Response.json({ error: "Unknown table" }, { status: 404 });

  await audit("backup.download", { entity: "backup", entityId: t.name, summary: `CSV export of ${t.name}` });
  const names = columnsOf(t).map(([, n]) => n);
  async function* body(): AsyncGenerator<string> {
    yield "\uFEFF" + names.map(cell).join(",") + "\r\n";
    for await (const page of readRows(t!)) yield page.map((r) => names.map((n) => cell(r[n])).join(",")).join("\r\n") + "\r\n";
  }
  const stream = streamFrom(body(), `csv ${t.name}`);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${t.name}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
