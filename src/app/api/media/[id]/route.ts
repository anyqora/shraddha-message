import { getCurrentUser } from "@/lib/auth";
import { waClient } from "@/lib/whatsapp";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^\d+$/.test(id)) return new Response("Bad id", { status: 400 });
  try {
    const wa = await waClient();
    const r = await wa.downloadMedia(id);
    if (!r.ok) return new Response("Media not available", { status: 404 });
    return new Response(r.body, {
      headers: {
        "Content-Type": r.headers.get("content-type") ?? "application/octet-stream",
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch {
    return new Response("Media not available", { status: 404 });
  }
}
