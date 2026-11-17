import "server-only";
import { headers } from "next/headers";
import { db } from "./db";
import { auditLog } from "@/db/schema";
import { getCurrentUser } from "./auth";

export type AuditOpts = {
  entity?: string;
  entityId?: string | null;
  summary?: string;
  /** Override the acting user (e.g. on sign-in, before the session cookie exists). `null` = system. */
  userId?: string | null;
};

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

async function requestIp(): Promise<string> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    return fwd || h.get("x-real-ip") || h.get("cf-connecting-ip") || "";
  } catch {
    return ""; // outside a request scope (cron, background job)
  }
}

/**
 * Append an audit-log entry. Reads the current user and client IP from the request.
 * Never throws: auditing must not break the action being audited.
 */
export async function audit(action: string, opts: AuditOpts = {}): Promise<void> {
  try {
    let userId: string | null = null;
    if (opts.userId !== undefined) userId = opts.userId;
    else {
      try {
        userId = (await getCurrentUser())?.id ?? null;
      } catch {
        userId = null;
      }
    }
    await db.insert(auditLog).values({
      userId,
      action: clip(action, 64),
      entity: clip(opts.entity ?? "", 64),
      entityId: clip(String(opts.entityId ?? ""), 64),
      summary: clip(opts.summary ?? "", 500),
      ip: clip(await requestIp(), 64),
    });
  } catch (e) {
    console.error("[audit] failed to record", action, e);
  }
}
