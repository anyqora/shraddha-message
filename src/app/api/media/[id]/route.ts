import { getCurrentUser } from "@/lib/auth";
import { fetchAndStoreWaMedia, getMedia } from "@/lib/media-store";
import { waClient } from "@/lib/whatsapp";

function serve(data: Buffer, mime: string, filename: string) {
  const headers: Record<string, string> = {
    "Content-Type": mime || "application/octet-stream",
    "Content-Length": String(data.length),
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  if (filename) headers["Content-Disposition"] = `inline; filename*=UTF-8''${encodeURIComponent(filename)}`;
  return new Response(new Uint8Array(data), { headers });
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getCurrentUser())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[\w-]{1,128}$/.test(id)) return new Response("Bad id", { status: 400 });

  const local = await getMedia(id).catch(() => null);
  if (local) return serve(local.data, local.mime, local.filename);

  // Not stored yet: only WhatsApp media ids (numeric) can be fetched from Meta.
  if (!/^\d+$/.test(id)) return new Response("Media not available", { status: 404 });
  try {
    const saved = await fetchAndStoreWaMedia(id);
    if (saved) return serve(saved.data, saved.mime, saved.filename);
    // too large to store (or store failed) — stream straight from Meta
    const r = await (await waClient()).downloadMedia(id);
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
