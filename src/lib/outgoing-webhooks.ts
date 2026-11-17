import "server-only";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { webhookEndpoints, type WebhookEndpoint } from "@/db/schema";
import type { AppEvent } from "./events";

export function signBody(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** POST one payload to one endpoint and record the outcome. Never throws. */
export async function deliver(ep: WebhookEndpoint, event: string, data: unknown): Promise<{ ok: boolean; status: number | null; error: string }> {
  const body = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  let status: number | null = null;
  let error = "";
  try {
    const res = await fetch(ep.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ShraddhaMessage-Webhooks/1.0",
        "X-Event": event,
        "X-Signature-256": signBody(body, ep.secret),
      },
      body,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    status = res.status;
    if (!res.ok) error = `HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`.trim();
  } catch (e) {
    error = e instanceof Error ? (e.name === "TimeoutError" ? "Timed out after 8 s" : e.message) : String(e);
  }
  try {
    await db
      .update(webhookEndpoints)
      .set({ lastStatus: status, lastError: error.slice(0, 500), lastAt: new Date() })
      .where(eq(webhookEndpoints.id, ep.id));
  } catch (e) {
    console.error("[webhooks] failed to record status", e);
  }
  return { ok: !error, status, error };
}

export async function handleEvent(event: AppEvent): Promise<void> {
  const eps = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.active, true));
  const targets = eps.filter((e) => Array.isArray(e.events) && e.events.includes(event.name));
  if (!targets.length) return;
  const { name, ...data } = event;
  await Promise.all(targets.map((ep) => deliver(ep, name, data)));
}
