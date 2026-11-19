import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@/lib/supabase/types';

import { applyInboundOptKeyword, parseOptKeyword, setContactOptOut } from './opt-out';

describe('parseOptKeyword', () => {
  it.each([
    ['STOP', 'opt_out'],
    ['  stop! ', 'opt_out'],
    ['Unsubscribe.', 'opt_out'],
    ['opt-out', 'opt_out'],
    ['Opt_Out', 'opt_out'],
    ['stop all', 'opt_out'],
    ['START', 'opt_in'],
    ['subscribe', 'opt_in'],
    ['opt in', 'opt_in'],
  ])('%s → %s', (text, expected) => {
    expect(parseOptKeyword(text)).toBe(expected);
  });

  it.each(['please stop sending', 'stopped', 'hi', '', '   '])(
    'ignores %j',
    (text) => {
      expect(parseOptKeyword(text)).toBeNull();
    },
  );

  it('ignores a missing body', () => {
    expect(parseOptKeyword(undefined)).toBeNull();
  });
});

function contactsDb(changedRows: unknown[]) {
  const calls: { update: Record<string, unknown>; filters: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      expect(table).toBe('contacts');
      const call = { update: {} as Record<string, unknown>, filters: {} as Record<string, unknown> };
      calls.push(call);
      const b: Record<string, unknown> = {
        update: (row: Record<string, unknown>) => {
          call.update = row;
          return b;
        },
        eq: (col: string, val: unknown) => {
          call.filters[col] = val;
          return b;
        },
        select: async () => ({ data: changedRows, error: null }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe('setContactOptOut', () => {
  it('stamps an opt-out only on a contact not already opted out', async () => {
    const { db, calls } = contactsDb([{ id: 'c1' }]);
    const changed = await setContactOptOut(db, 'c1', true, 'keyword', new Date('2026-11-19T10:00:00Z'));
    expect(changed).toBe(true);
    expect(calls[0].update).toEqual({
      opted_out: true,
      opted_out_at: '2026-11-19T10:00:00.000Z',
      opt_out_source: 'keyword',
    });
    expect(calls[0].filters).toEqual({ id: 'c1', opted_out: false });
  });

  it('clears every opt-out column on opt-in', async () => {
    const { db, calls } = contactsDb([]);
    expect(await setContactOptOut(db, 'c1', false, 'keyword')).toBe(false);
    expect(calls[0].update).toEqual({ opted_out: false, opted_out_at: null, opt_out_source: null });
    expect(calls[0].filters).toEqual({ id: 'c1', opted_out: true });
  });
});

describe('applyInboundOptKeyword', () => {
  it('does nothing for an ordinary message', async () => {
    const { db, calls } = contactsDb([]);
    expect(await applyInboundOptKeyword(db, 'c1', 'hello')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('opts the contact out on STOP and reports the keyword', async () => {
    const { db, calls } = contactsDb([{ id: 'c1' }]);
    expect(await applyInboundOptKeyword(db, 'c1', 'STOP')).toBe('opt_out');
    expect(calls[0].update.opted_out).toBe(true);
  });
});
