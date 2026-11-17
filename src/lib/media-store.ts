import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { mediaFiles } from "@/db/schema";
import { getSettings } from "./settings";
import { waClient } from "./whatsapp";

export type StoredMedia = { id: string; mime: string; filename: string; size: number; data: Buffer };

/** Save (or replace) a media file. Returns false if it exceeds the configured size limit. */
export async function storeMedia(id: string, mime: string, filename: string, buf: Buffer): Promise<boolean> {
  const maxMb = (await getSettings()).mediaStoreMaxMb || 16;
  if (!id || buf.length === 0 || buf.length > maxMb * 1024 * 1024) return false;
  const row = { id: id.slice(0, 128), mime: (mime || "application/octet-stream").slice(0, 128), filename: (filename || "").slice(0, 255), size: buf.length, data: buf };
  await db
    .insert(mediaFiles)
    .values(row)
    .onDuplicateKeyUpdate({ set: { mime: row.mime, filename: row.filename, size: row.size, data: sql`values(${mediaFiles.data})` } });
  return true;
}

export async function getMedia(id: string): Promise<StoredMedia | null> {
  const [r] = await db
    .select({ id: mediaFiles.id, mime: mediaFiles.mime, filename: mediaFiles.filename, size: mediaFiles.size, data: mediaFiles.data })
    .from(mediaFiles)
    .where(eq(mediaFiles.id, id))
    .limit(1);
  return r ?? null;
}

export async function hasMedia(id: string): Promise<boolean> {
  const [r] = await db.select({ id: mediaFiles.id }).from(mediaFiles).where(eq(mediaFiles.id, id)).limit(1);
  return !!r;
}

/** Download a WhatsApp media id from Meta and save it. Returns the stored file, or null. */
export async function fetchAndStoreWaMedia(id: string, mimeHint = "", filename = ""): Promise<StoredMedia | null> {
  const maxBytes = ((await getSettings()).mediaStoreMaxMb || 16) * 1024 * 1024;
  const wa = await waClient();
  const r = await wa.downloadMedia(id);
  if (!r.ok) return null;
  const len = Number(r.headers.get("content-length") || 0);
  if (len > maxBytes) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  const mime = r.headers.get("content-type") || mimeHint || "application/octet-stream";
  const file = { id, mime, filename, size: buf.length, data: buf };
  const ok = await storeMedia(id, mime, filename, buf);
  return ok ? file : null;
}
