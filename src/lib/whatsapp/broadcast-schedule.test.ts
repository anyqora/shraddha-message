import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@/lib/supabase/types';

const resume = vi.hoisted(() => ({
  claimBroadcastDelivery: vi.fn(),
  planBroadcastResume: vi.fn(),
  releaseBroadcastDelivery: vi.fn(),
}));
vi.mock('@/lib/whatsapp/broadcast-resume', () => resume);

const core = vi.hoisted(() => ({ finalizeBroadcastStatus: vi.fn() }));
vi.mock('@/lib/whatsapp/broadcast-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./broadcast-core')>();
  return { ...actual, finalizeBroadcastStatus: core.finalizeBroadcastStatus };
});

import { BroadcastError } from './broadcast-core';
import { checkCronAuth, planDueBroadcasts, releaseJobs } from './broadcast-schedule';

describe('checkCronAuth', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  const req = (headers: Record<string, string>) =>
    new Request('http://localhost/api/broadcasts/cron', { headers });

  it('is unconfigured without a secret', () => {
    delete process.env.BROADCAST_CRON_SECRET;
    delete process.env.AUTOMATION_CRON_SECRET;
    expect(checkCronAuth(req({ 'x-cron-secret': 'x' }))).toBe('unconfigured');
  });

  it('accepts x-cron-secret or a bearer token', () => {
    process.env.BROADCAST_CRON_SECRET = 's3cret';
    expect(checkCronAuth(req({ 'x-cron-secret': 's3cret' }))).toBe('ok');
    expect(checkCronAuth(req({ authorization: 'Bearer s3cret' }))).toBe('ok');
    expect(checkCronAuth(req({ authorization: 'Bearer nope' }))).toBe('unauthorized');
    expect(checkCronAuth(req({}))).toBe('unauthorized');
  });

  it('falls back to AUTOMATION_CRON_SECRET', () => {
    delete process.env.BROADCAST_CRON_SECRET;
    process.env.AUTOMATION_CRON_SECRET = 'auto';
    expect(checkCronAuth(req({ 'x-cron-secret': 'auto' }))).toBe('ok');
  });
});

interface Fixture {
  due: { id: string; account_id: string }[];
  inFlight: { id: string; account_id: string }[];
  /** ids whose scheduled → sending flip loses (e.g. cancelled). */
  startLoses?: string[];
}

function cronDb(fx: Fixture) {
  const statusFlips: string[] = [];
  const failedPending: string[] = [];
  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let update: Record<string, unknown> | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        update: (row: Record<string, unknown>) => {
          update = row;
          return b;
        },
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return b;
        },
        lte: () => b,
        not: () => b,
        order: () => b,
        limit: async () => ({
          data: filters.status === 'scheduled' ? fx.due : fx.inFlight,
          error: null,
        }),
        then: (resolve: (r: unknown) => unknown) => {
          if (table === 'broadcast_recipients' && update?.status === 'failed') {
            failedPending.push(filters.broadcast_id as string);
          }
          return resolve({ data: null, error: null });
        },
      };
      // `.select('id')` after an update ends the scheduled → sending flip.
      const origSelect = b.select as () => unknown;
      b.select = (cols?: string) => {
        if (update && table === 'broadcasts' && cols === 'id') {
          const id = filters.id as string;
          statusFlips.push(id);
          const lost = fx.startLoses?.includes(id);
          return Promise.resolve({ data: lost ? [] : [{ id }], error: null });
        }
        return origSelect();
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, statusFlips, failedPending };
}

const PLAN = { broadcastId: 'b', planned: [{ recipientRowId: 'r', phone: '1', params: [] }] };

describe('planDueBroadcasts', () => {
  beforeEach(() => {
    resume.claimBroadcastDelivery.mockResolvedValue(true);
    resume.planBroadcastResume.mockResolvedValue({ plan: PLAN, remaining: 0, unsendable: 0, optedOut: 0 });
  });

  it('starts due broadcasts and continues in-flight ones, keeping the lock for delivery', async () => {
    const { db, statusFlips } = cronDb({
      due: [{ id: 'due-1', account_id: 'a' }],
      inFlight: [{ id: 'run-1', account_id: 'a' }],
    });
    const res = await planDueBroadcasts(db, { maxPerPass: 50 });
    expect(res.jobs.map((j) => j.broadcastId)).toEqual(['due-1', 'run-1']);
    // Only the due one flips scheduled → sending.
    expect(statusFlips).toEqual(['due-1']);
    expect(resume.planBroadcastResume).toHaveBeenCalledWith(db, 'a', 'due-1', 'pending', 50);
    expect(resume.releaseBroadcastDelivery).not.toHaveBeenCalled();
  });

  it('skips a broadcast someone else is already sending', async () => {
    resume.claimBroadcastDelivery.mockResolvedValue(false);
    const { db } = cronDb({ due: [{ id: 'due-1', account_id: 'a' }], inFlight: [] });
    const res = await planDueBroadcasts(db);
    expect(res).toEqual({ jobs: [], settled: [], skipped: ['due-1'] });
  });

  it('lets a cancel that landed first win, and releases the lock', async () => {
    const { db } = cronDb({
      due: [{ id: 'due-1', account_id: 'a' }],
      inFlight: [],
      startLoses: ['due-1'],
    });
    const res = await planDueBroadcasts(db);
    expect(res.skipped).toEqual(['due-1']);
    expect(resume.planBroadcastResume).not.toHaveBeenCalled();
    expect(resume.releaseBroadcastDelivery).toHaveBeenCalledWith(db, 'due-1');
  });

  it('settles a broadcast with nothing left to send', async () => {
    resume.planBroadcastResume.mockRejectedValue(
      new BroadcastError('nothing_to_resume', 'none', 400),
    );
    const { db, failedPending } = cronDb({ due: [{ id: 'due-1', account_id: 'a' }], inFlight: [] });
    const res = await planDueBroadcasts(db);
    expect(res.settled).toEqual(['due-1']);
    expect(core.finalizeBroadcastStatus).toHaveBeenCalledWith(db, 'due-1');
    expect(failedPending).toEqual([]);
    expect(resume.releaseBroadcastDelivery).toHaveBeenCalledWith(db, 'due-1');
  });

  it('fails the pending recipients when the send cannot be planned', async () => {
    resume.planBroadcastResume.mockRejectedValue(new Error('WhatsApp not configured'));
    const { db, failedPending } = cronDb({ due: [{ id: 'due-1', account_id: 'a' }], inFlight: [] });
    const res = await planDueBroadcasts(db);
    expect(res.settled).toEqual(['due-1']);
    expect(failedPending).toEqual(['due-1']);
  });
});

describe('releaseJobs', () => {
  it('releases every job', async () => {
    const db = {} as SupabaseClient;
    await releaseJobs(db, [
      { broadcastId: 'x', plan: PLAN as never },
      { broadcastId: 'y', plan: PLAN as never },
    ]);
    expect(resume.releaseBroadcastDelivery.mock.calls.map((c) => c[1])).toEqual(['x', 'y']);
  });
});
