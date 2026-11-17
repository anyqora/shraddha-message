import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { apiKeys, type ApiKey } from "@/db/schema";
import { randomToken, sha256 } from "./crypto";

export const API_KEY_PREFIX = "sm_live_";

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = API_KEY_PREFIX + randomToken(24);
  return { key, prefix: key.slice(0, 14), hash: sha256(key) };
}

export function apiError(message: string, status = 400, extra?: Record<string, unknown>) {
  return Response.json({ error: { message, ...extra } }, { status });
}

/** Returns the API key row, or a 401 Response. */
export async function authenticateApi(req: Request): Promise<ApiKey | Response> {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  if (!m) return apiError("Missing API key. Send `Authorization: Bearer <key>`.", 401);
  const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, sha256(m[1]))).limit(1);
  if (!row) return apiError("Invalid API key.", 401);
  // only touch lastUsedAt at most once a minute
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
  }
  return row;
}

export async function readJson(req: Request): Promise<Record<string, any> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? b : null;
  } catch {
    return null;
  }
}
