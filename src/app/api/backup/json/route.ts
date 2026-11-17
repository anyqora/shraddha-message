import { getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { backupTables, readRows, streamFrom, EXCLUDED_TABLES, SECRET_SETTING_KEYS, REDACTED_COLUMNS } from "../tables";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (me.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });

  const tables = backupTables();
  const stamp = new Date().toISOString();
  await audit("backup.download", { entity: "backup", entityId: "json", summary: `Full JSON backup (${tables.length} tables)` });

  const meta = {
    app: process.env.APP_NAME || "Shraddha Message",
    createdAt: stamp,
    createdBy: me.email,
    format: 1,
    excludedTables: [...EXCLUDED_TABLES],
    excludedSettings: SECRET_SETTING_KEYS,
    redactedColumns: REDACTED_COLUMNS,
  };
  async function* body(): AsyncGenerator<string> {
    yield `{"meta":${JSON.stringify(meta)},"tables":{`;
    for (const [ti, t] of tables.entries()) {
      yield `${ti ? "," : ""}\n${JSON.stringify(t.name)}:[`;
      let first = true;
      for await (const page of readRows(t)) {
        yield (first ? "\n" : ",\n") + page.map((r) => JSON.stringify(r)).join(",\n");
        first = false;
      }
      yield "]";
    }
    yield "\n}}\n";
  }
  const stream = streamFrom(body(), "json");
  const day = stamp.slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="backup-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
