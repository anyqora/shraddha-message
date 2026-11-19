// ============================================================
// Server-side broadcast pacing.
//
// `deliverBroadcast` runs unattended (public API, resume, scheduled
// cron), so nothing slows it down the way the wizard's 10-per-second
// batches do. These helpers keep a long fan-out under Meta's
// per-number throughput and ride out a rate-limit response instead of
// writing the rest of the campaign off as failed.
// ============================================================

import { MetaApiError } from '@/lib/whatsapp/meta-api';

/** Meta error codes that mean "slow down", not "this send is bad". */
const RATE_LIMIT_CODES = new Set([4, 80007, 130429]);

/** Retries per recipient after a rate-limit response. */
export const RATE_LIMIT_MAX_RETRIES = 4;

export const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function isRetryableRateLimit(err: unknown): boolean {
  return (
    err instanceof MetaApiError &&
    ((err.code !== null && RATE_LIMIT_CODES.has(err.code)) ||
      err.httpStatus === 429)
  );
}

/** Exponential backoff: 2 s, 4 s, 8 s, … capped at 30 s. */
export function rateLimitBackoffMs(attempt: number): number {
  return Math.min(30_000, 2_000 * 2 ** (attempt - 1));
}

/**
 * Gap between two sends, from BROADCAST_SEND_INTERVAL_MS (default
 * 100 ms, clamped to 0–10 000).
 */
export function sendIntervalMs(): number {
  const raw = process.env.BROADCAST_SEND_INTERVAL_MS;
  if (raw === undefined || raw === '') return 100;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? Math.min(10_000, Math.max(0, parsed)) : 100;
}
