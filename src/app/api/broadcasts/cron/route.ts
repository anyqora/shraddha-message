// ============================================================
// GET /api/broadcasts/cron
//
// Sends scheduled broadcasts that have come due, and continues
// scheduled broadcasts whose earlier pass ran out of time. Hit it once a
// minute from the host's cron:
//
//   curl -fsS -H "x-cron-secret: $BROADCAST_CRON_SECRET" \
//     https://<host>/api/broadcasts/cron
//
// (`Authorization: Bearer <secret>` works too.) The secret is
// BROADCAST_CRON_SECRET, falling back to AUTOMATION_CRON_SECRET.
//
// Responds as soon as the work is claimed and planned; the sends run in
// `after()` and stop starting new messages 4 minutes in, leaving the
// rest 'pending' for the next tick.
// ============================================================

import { NextResponse, after } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  deliverBroadcast,
  finalizeBroadcastStatus,
} from '@/lib/whatsapp/broadcast-core';
import {
  checkCronAuth,
  planDueBroadcasts,
  releaseJobs,
  type CronPlan,
} from '@/lib/whatsapp/broadcast-schedule';

export const maxDuration = 300;

/** Stop starting sends this long after the tick began (under maxDuration). */
const PASS_BUDGET_MS = 240_000;

function maxPerPassFromEnv(): number | undefined {
  const parsed = Number.parseInt(process.env.BROADCAST_CRON_MAX_PER_PASS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: Request) {
  const auth = checkCronAuth(request);
  if (auth === 'unconfigured') {
    return NextResponse.json(
      { error: 'cron not configured — set BROADCAST_CRON_SECRET' },
      { status: 503 }
    );
  }
  if (auth === 'unauthorized') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const admin = supabaseAdmin();

  let planned: CronPlan;
  try {
    planned = await planDueBroadcasts(admin, { maxPerPass: maxPerPassFromEnv() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[broadcast-cron] planning failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { jobs } = planned;
  if (jobs.length > 0) {
    const deadline = new Date(startedAt + PASS_BUDGET_MS);
    after(async () => {
      try {
        for (const job of jobs) {
          try {
            await deliverBroadcast(admin, job.plan, { deadline });
          } catch (err) {
            console.error(
              `[broadcast-cron] delivery of ${job.broadcastId} threw:`,
              err instanceof Error ? err.message : err
            );
            await finalizeBroadcastStatus(admin, job.broadcastId).catch(() => {});
          }
        }
      } finally {
        await releaseJobs(admin, jobs);
      }
    });
  }

  return NextResponse.json({
    started: jobs.map((job) => ({
      broadcast_id: job.broadcastId,
      recipients: job.plan.planned.length,
    })),
    settled: planned.settled,
    skipped: planned.skipped,
  });
}
