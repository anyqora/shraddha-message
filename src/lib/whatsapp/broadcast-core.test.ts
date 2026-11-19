import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@/lib/supabase/types';
import {
  createBroadcast,
  deliverBroadcast,
  finalizeBroadcastStatus,
  BroadcastError,
  type BroadcastPlan,
} from './broadcast-core';
import { sendTemplateMessage, MetaApiError } from '@/lib/whatsapp/meta-api';

// Contact resolution and token decryption are exercised elsewhere — stub
// them so these tests focus on the persistence boundary.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'plain-access-token',
}));
vi.mock('@/lib/api/v1/contacts', () => ({
  findOrCreateContact: vi.fn(async () => ({ id: 'c1' })),
}));
// Never reach Meta from a test.
vi.mock('@/lib/whatsapp/meta-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/meta-api')>();
  return { ...actual, sendTemplateMessage: vi.fn() };
});

// These assertions all fire in the pure validation prologue, before
// any Supabase call — a bare stub is enough.
const db = {} as SupabaseClient;

describe('createBroadcast validation', () => {
  it('rejects a missing template_name', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: '',
        recipients: [{ to: '+14155550123' }],
      })
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('rejects an empty recipient list', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        recipients: [],
      })
    ).rejects.toBeInstanceOf(BroadcastError);
  });

  it('rejects more than 1000 recipients', async () => {
    const recipients = Array.from({ length: 1001 }, () => ({
      to: '+14155550123',
    }));
    await expect(
      createBroadcast(db, 'acc', 'user', { templateName: 'promo', recipients })
    ).rejects.toMatchObject({ status: 400 });
  });
});

// Build a Supabase-shaped mock that gets createBroadcast past its config +
// template lookups and into persistence. `rpcResult` is what the atomic
// create_broadcast_with_recipients RPC returns.
function makeDb(
  rpcResult: { data: unknown; error: unknown },
  optedOutIds: string[] = []
) {
  const calls = {
    rpc: [] as { name: string; args: unknown }[],
    // Incremented if the OLD non-atomic path (a direct broadcasts /
    // broadcast_recipients insert) is ever reached — it must not be.
    usedDirectInsert: 0,
  };
  const database = {
    from(table: string) {
      if (table === 'whatsapp_config') {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: { phone_number_id: 'pn-1', access_token: 'enc' },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === 'message_templates') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
        return chain;
      }
      if (table === 'contacts') {
        // The opt-out lookup: .select('id').eq().eq().in(ids)
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          in: (_col: string, ids: string[]) =>
            Promise.resolve({
              data: ids.filter((id) => optedOutIds.includes(id)).map((id) => ({ id })),
              error: null,
            }),
        };
        return chain;
      }
      if (table === 'broadcasts' || table === 'broadcast_recipients') {
        calls.usedDirectInsert++;
        return {
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: 'orphan' }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc(name: string, args: unknown) {
      calls.rpc.push({ name, args });
      return Promise.resolve(rpcResult);
    },
  } as unknown as SupabaseClient;
  return { db: database, calls };
}

describe('createBroadcast recipient validation (#586)', () => {
  it('counts a recipient without a leading + as rejected instead of sending it abroad', async () => {
    const { db } = makeDb({
      data: [{ broadcast_id: 'b-1', recipient_id: 'r-1', contact_id: 'c1' }],
      error: null,
    });

    const plan = await createBroadcast(db, 'acc', 'user', {
      templateName: 'promo',
      recipients: [
        { to: '4155551212' }, // US national → Meta would read +41 (Switzerland)
        { to: '14155550123' }, // country code but no + — indistinguishable
        { to: '+14155550123' },
      ],
    });

    expect(plan.rejected).toBe(2);
    expect(plan.planned).toEqual([
      { recipientRowId: 'r-1', phone: '14155550123', params: [] },
    ]);
  });

  it('counts recipients that resolve to an already-listed contact as duplicates', async () => {
    const { db } = makeDb({
      data: [{ broadcast_id: 'b-1', recipient_id: 'r-1', contact_id: 'c1' }],
      error: null,
    });

    const plan = await createBroadcast(db, 'acc', 'user', {
      templateName: 'promo',
      recipients: [
        { to: '+14155550123', params: ['first'] },
        { to: '+1 415 555 0123', params: ['second'] },
        { to: 'invalid' },
      ],
    });

    expect(plan.rejected).toBe(1);
    expect(plan.duplicates).toBe(1);
    expect(plan.planned).toEqual([
      { recipientRowId: 'r-1', phone: '14155550123', params: ['first'] },
    ]);
  });

  it('fails the whole request when no recipient carries a country code', async () => {
    const { db, calls } = makeDb({ data: [], error: null });
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        recipients: [{ to: '4155551212' }],
      })
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
    expect(calls.rpc).toHaveLength(0);
  });
});

describe('createBroadcast atomicity (#370)', () => {
  it('creates parent + recipients through the atomic RPC, never a bare parent insert', async () => {
    const { db, calls } = makeDb({
      data: [{ broadcast_id: 'b-1', recipient_id: 'r-1', contact_id: 'c1' }],
      error: null,
    });

    const plan = await createBroadcast(db, 'acc', 'user', {
      templateName: 'promo',
      recipients: [{ to: '+14155550123' }],
    });

    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe('create_broadcast_with_recipients');
    expect(calls.usedDirectInsert).toBe(0);
    expect(plan.broadcastId).toBe('b-1');
    expect(plan.planned).toEqual([
      { recipientRowId: 'r-1', phone: '14155550123', params: [] },
    ]);
  });

  it('sends one params array per contact, even for a single-variable template', async () => {
    const { db, calls } = makeDb({
      data: [{ broadcast_id: 'b-1', recipient_id: 'r-1', contact_id: 'c1' }],
      error: null,
    });

    await createBroadcast(db, 'acc', 'user', {
      templateName: 'promo',
      recipients: [{ to: '+14155550123', params: ['Ann'] }],
    });

    const args = calls.rpc[0].args as {
      p_contact_ids: string[];
      p_template_params: unknown;
    };
    expect(args.p_contact_ids).toEqual(['c1']);
    expect(args.p_template_params).toEqual([['Ann']]);
  });

  it('throws and leaves no orphaned parent when the atomic create fails', async () => {
    const { db, calls } = makeDb({
      data: null,
      error: { message: 'recipient insert failed' },
    });

    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        recipients: [{ to: '+14155550123' }],
      })
    ).rejects.toBeInstanceOf(BroadcastError);

    // The RPC was the only persistence attempt; because it runs both
    // inserts in a single transaction, its failure rolls the parent back —
    // there is no separate parent insert that could survive as an orphan.
    expect(calls.rpc).toHaveLength(1);
    expect(calls.usedDirectInsert).toBe(0);
  });
});

// ============================================================
// Terminal status (#472). Derived from the recipient rows, not from a
// counter local to one delivery pass — a resume only sends the
// leftovers, so "nothing sent this pass" must not condemn a campaign
// that already delivered hundreds.
// ============================================================

function statusDb(
  counts: Record<string, number>,
  total: number,
  writes: { update?: Record<string, unknown> },
) {
  return {
    from(table: string) {
      let status: string | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (col: string, val: unknown) => {
          if (col === 'status') status = val as string;
          return b;
        },
        update: (row: Record<string, unknown>) => {
          if (table === 'broadcasts') writes.update = row;
          return b;
        },
        then: (resolve: (r: { count: number; error: null }) => unknown) =>
          resolve({
            count: status === null ? total : (counts[status] ?? 0),
            error: null,
          }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

describe('finalizeBroadcastStatus', () => {
  it('leaves a capped pass in "sending" while recipients are still pending', async () => {
    const writes: { update?: Record<string, unknown> } = {};
    await finalizeBroadcastStatus(statusDb({ pending: 25 }, 1025, writes), 'b-1');
    // No write at all — the UI keeps offering Resume.
    expect(writes.update).toBeUndefined();
  });

  it('marks a fully-failed broadcast failed', async () => {
    const writes: { update?: Record<string, unknown> } = {};
    await finalizeBroadcastStatus(
      statusDb({ pending: 0, failed: 10 }, 10, writes),
      'b-1',
    );
    expect(writes.update?.status).toBe('failed');
  });

  it('marks a partially-failed broadcast sent', async () => {
    const writes: { update?: Record<string, unknown> } = {};
    await finalizeBroadcastStatus(
      statusDb({ pending: 0, failed: 3 }, 10, writes),
      'b-1',
    );
    // 7 people got the message; failed_count carries the other 3.
    expect(writes.update?.status).toBe('sent');
  });

  it('does not condemn a campaign whose resume pass sent nothing new', async () => {
    const writes: { update?: Record<string, unknown> } = {};
    // 800 delivered on the original pass, the 200-recipient resume all
    // failed. Pre-fix this wrote 'failed' off a pass-local counter.
    await finalizeBroadcastStatus(
      statusDb({ pending: 0, failed: 200 }, 1000, writes),
      'b-1',
    );
    expect(writes.update?.status).toBe('sent');
  });
});

describe('createBroadcast opt-out', () => {
  it('drops opted-out contacts before persisting', async () => {
    const { db, calls } = makeDb({ data: [], error: null }, ['c1']);
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        recipients: [{ to: '+14155550123' }],
      })
    ).rejects.toMatchObject({
      code: 'bad_request',
      message: 'Every recipient has opted out of broadcasts',
    });
    expect(calls.rpc).toHaveLength(0);
  });

  it('reports optedOut: 0 when nobody opted out', async () => {
    const { db } = makeDb({
      data: [{ broadcast_id: 'b-1', recipient_id: 'r-1', contact_id: 'c1' }],
      error: null,
    });
    const plan = await createBroadcast(db, 'acc', 'user', {
      templateName: 'promo',
      recipients: [{ to: '+14155550123' }],
    });
    expect(plan.optedOut).toBe(0);
  });
});

describe('deliverBroadcast', () => {
  function recordingDb() {
    const updates: { table: string; values: Record<string, unknown>; id?: unknown }[] = [];
    const db = {
      from(table: string) {
        const chain: Record<string, unknown> = {};
        let values: Record<string, unknown> = {};
        chain.update = (v: Record<string, unknown>) => {
          values = v;
          return chain;
        };
        chain.select = () => chain;
        chain.eq = (col: string, val: unknown) => {
          if (col === 'id') updates.push({ table, values, id: val });
          return chain;
        };
        // finalizeBroadcastStatus' counts: report one pending row so it
        // returns early and leaves the status alone.
        chain.then = (resolve: (r: unknown) => unknown) =>
          Promise.resolve(resolve({ data: null, count: 1, error: null }));
        return chain;
      },
    } as unknown as SupabaseClient;
    return { db, updates };
  }

  const plan = (n: number, extra: Partial<BroadcastPlan> = {}): BroadcastPlan => ({
    broadcastId: 'b-1',
    templateName: 'promo',
    templateLanguage: 'en_US',
    phoneNumberId: 'pn',
    accessToken: 'tok',
    templateRow: null,
    planned: Array.from({ length: n }, (_, i) => ({
      recipientRowId: `r-${i}`,
      phone: `1415555000${i}`,
      params: [],
    })),
    rejected: 0,
    ...extra,
  });

  it('passes the persisted header media URL to every send', async () => {
    const send = vi.mocked(sendTemplateMessage);
    send.mockResolvedValue({ messageId: 'wamid.1' } as never);
    const { db } = recordingDb();
    await deliverBroadcast(db, plan(2, { headerMediaUrl: 'https://x/img.jpg' }), {
      intervalMs: 0,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({
      messageParams: { headerMediaUrl: 'https://x/img.jpg' },
    });
  });

  it('stops starting sends at the deadline and leaves the rest pending', async () => {
    const send = vi.mocked(sendTemplateMessage);
    send.mockResolvedValue({ messageId: 'wamid.1' } as never);
    const { db, updates } = recordingDb();
    const result = await deliverBroadcast(db, plan(3), {
      deadline: new Date(Date.now() - 1),
      intervalMs: 0,
    });
    expect(result).toEqual({ attempted: 0, stoppedEarly: true });
    expect(send).not.toHaveBeenCalled();
    expect(updates.filter((u) => u.table === 'broadcast_recipients')).toHaveLength(0);
  });

  it('waits out a Meta rate limit and retries the same recipient', async () => {
    const send = vi.mocked(sendTemplateMessage);
    send
      .mockRejectedValueOnce(new MetaApiError('throttled', { code: 130429, httpStatus: 400 }))
      .mockResolvedValueOnce({ messageId: 'wamid.2' } as never);
    const sleep = vi.fn(async () => {});
    const { db, updates } = recordingDb();
    await deliverBroadcast(db, plan(1), { sleep, intervalMs: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(updates.find((u) => u.table === 'broadcast_recipients')?.values).toMatchObject({
      status: 'sent',
      whatsapp_message_id: 'wamid.2',
    });
  });
});
