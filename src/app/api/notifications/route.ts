import { getCurrentUser } from "@/lib/auth";
import { listNotifications, markNotificationsRead } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await listNotifications(me.id, 30), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; id?: unknown };
  if (body.action !== "read") return Response.json({ error: "Unknown action" }, { status: 400 });
  const id = typeof body.id === "string" && body.id ? body.id : undefined;
  await markNotificationsRead(me.id, id);
  return Response.json({ ok: true });
}
