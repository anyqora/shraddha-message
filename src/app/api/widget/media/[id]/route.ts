import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaFiles } from "@/db/schema";
import { CORS_HEADERS } from "@/lib/web-chat";

export const dynamic = "force-dynamic";

/** Public download for files agents send to web-chat visitors (ids are random UUIDs). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Bad id", { status: 400, headers: CORS_HEADERS });
  const [f] = await db.select().from(mediaFiles).where(eq(mediaFiles.id, id)).limit(1);
  if (!f) return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  // only render safe types inline; everything else (html, svg, …) is a forced download
  const inline = (/^(image|video|audio)\//.test(f.mime) && !/svg|xml/i.test(f.mime)) || f.mime === "application/pdf";
  return new Response(new Uint8Array(f.data), {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": inline ? f.mime : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.filename || "file")}`,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
