// ============================================================
// Scheduled broadcasts.
//
// The wizard writes a broadcast with status 'scheduled', a
// `scheduled_at`, and its recipient rows already frozen (params
// resolved, status 'pending'). GET /api/broadcasts/cron, hit every
// minute by the host's cron, calls `planDueBroadcasts` to pick up what
// is due and hands each plan to the same `deliverBroadcast` the resume
// path uses — no second fan-out loop.
//
// A pass is bounded (BROADCAST_CRON_MAX_PER_PASS recipients and a
// deadline inside the route's timeout). Whatever is left stays
// 'pending' on a broadcast in 'sending' with a `scheduled_at`, and the
// next tick continues it.
// ============================================================

import { timingSafeEqual } from 'node:crypto';

import type { SupabaseClient } from '@/lib/supabase/types';

import {
  BroadcastError,
  finalizeBroadcastStatus,
  type BroadcastPlan,
} from '@/lib/whatsapp/broadcast-core';
import {
  claimBroadcastDelivery,
  planBroadcastResume,
  releaseBroadcastDelivery,
} from '@/lib/whatsapp/broadcast-resume';

export { MIN_SCHEDULE_LEAD_MS } from '@/lib/broadcast-schedule';

/** Broadcasts looked at per tick, per bucket (due + in-flight). */
const MAX_BROADCASTS_PER_TICK = 10;

export type CronAuthResult = 'ok' | 'unauthorized' | 'unconfigured';

/**
 * Authenticate a cron request.
 *
 * The secret is BROADCAST_CRON_SECRET (falling back to
 * AUTOMATION_CRON_SECRET, so one secret can drive both crons). It is
 * accepted as `x-cron-secret: <secret>` or `Authorization: Bearer
 * <secret>`. Never as a query parameter — it would end up in access
 * logs.
 */
export function checkCronAuth(request: Request): CronAuthResult {
  const secret =
    process.env.BROADCAST_CRON_SECRET || process.env.AUTOMATION_CRON_SECRET;
  if (!secret) return 'unconfigured';

  const bearer = request.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '');
  const provided = request.headers.get('x-cron-secret') ?? bearer ?? '';

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'unauthorized';
}

export interface CronJob {
  broadcastId: string;
  plan: BroadcastPlan;
}

export interface CronPlan {
  /** Claimed + planned; the caller delivers, then calls {@link releaseJobs}. */
  jobs: CronJob[];
  /** Settled without sending (nothing left, or planning failed). */
  settled: string[];
  /** Another pass holds the lock, or a cancel won the race. */
  skipped: string[];
}

/** Fail every still-pending recipient so the broadcast can settle. */
async function failPendingRecipients(
  db: SupabaseClient,
  broadcastId: string,
  reason: string
): Promise<void> {
  await db
    .from('broadcast_recipients')
    .update({ status: 'failed', error_message: reason })
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending');
  await finalizeBroadcastStatus(db, broadcastId);
}

/**
 * Flip scheduled → sending. Conditional on the row still being
 * 'scheduled', so a cancel that lands first wins.
 */
async function startScheduledBroadcast(
  db: SupabaseClient,
  broadcastId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('broadcasts')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .eq('id', broadcastId)
    .eq('status', 'scheduled')
    .select('id');
  if (error) {
    console.error('[broadcast-schedule] start failed:', error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * Claim and plan this tick's work: broadcasts whose `scheduled_at` has
 * passed, plus scheduled broadcasts already 'sending' whose earlier
 * pass ran out of time. Each returned job holds the delivery lock.
 *
 * Runs with the service-role client — the cron has no user.
 */
export async function planDueBroadcasts(
  db: SupabaseClient,
  options: { now?: Date; maxPerPass?: number } = {}
): Promise<CronPlan> {
  const now = options.now ?? new Date();
  const result: CronPlan = { jobs: [], settled: [], skipped: [] };

  const { data: due, error: dueError } = await db
    .from('broadcasts')
    .select('id, account_id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(MAX_BROADCASTS_PER_TICK);
  if (dueError) {
    throw new Error(`Failed to load due broadcasts: ${dueError.message}`);
  }

  const { data: inFlight, error: inFlightError } = await db
    .from('broadcasts')
    .select('id, account_id')
    .eq('status', 'sending')
    .not('scheduled_at', 'is', null)
    .order('scheduled_at', { ascending: true })
    .limit(MAX_BROADCASTS_PER_TICK);
  if (inFlightError) {
    throw new Error(
      `Failed to load in-flight broadcasts: ${inFlightError.message}`
    );
  }

  type Row = { id: string; account_id: string };
  const candidates = [
    ...((due ?? []) as Row[]).map((r) => ({ ...r, isDue: true })),
    ...((inFlight ?? []) as Row[]).map((r) => ({ ...r, isDue: false })),
  ];

  for (const { id, account_id: accountId, isDue } of candidates) {
    // The same lock the resume route and the wizard's lease respect: a
    // broadcast someone is already sending is left alone.
    if (!(await claimBroadcastDelivery(db, accountId, id, now))) {
      result.skipped.push(id);
      continue;
    }

    let handedOff = false;
    try {
      if (isDue && !(await startScheduledBroadcast(db, id))) {
        result.skipped.push(id);
        continue;
      }
      const { plan } = await planBroadcastResume(
        db,
        accountId,
        id,
        'pending',
        options.maxPerPass
      );
      result.jobs.push({ broadcastId: id, plan });
      handedOff = true;
    } catch (err) {
      if (err instanceof BroadcastError && err.code === 'nothing_to_resume') {
        // Every recipient opted out or had no phone — settle it.
        await finalizeBroadcastStatus(db, id);
      } else {
        const message =
          err instanceof Error ? err.message : 'Scheduled send could not start';
        console.error(`[broadcast-schedule] ${id} could not be planned:`, message);
        await failPendingRecipients(db, id, message);
      }
      result.settled.push(id);
    } finally {
      if (!handedOff) await releaseBroadcastDelivery(db, id);
    }
  }

  return result;
}

/** Release the delivery lock of every job once its pass is done. */
export async function releaseJobs(
  db: SupabaseClient,
  jobs: CronJob[]
): Promise<void> {
  for (const job of jobs) {
    await releaseBroadcastDelivery(db, job.broadcastId);
  }
}
