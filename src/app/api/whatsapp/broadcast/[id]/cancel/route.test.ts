import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  result: { data: [{ id: 'b-1' }] as unknown[] | null, error: null as { message: string } | null },
  update: null as Record<string, unknown> | null,
  filters: {} as Record<string, unknown>,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    accountId: 'acct-1',
    supabase: {
      from: (table: string) => {
        expect(table).toBe('broadcasts')
        const b: Record<string, unknown> = {
          update: (row: Record<string, unknown>) => {
            h.update = row
            return b
          },
          eq: (col: string, val: unknown) => {
            h.filters[col] = val
            return b
          },
          select: async () => h.result,
        }
        return b
      },
    },
  })),
  toErrorResponse: () => new Response(null, { status: 500 }),
}))

import { POST } from './route'

const call = () =>
  POST(new Request('http://localhost/api/whatsapp/broadcast/b-1/cancel', { method: 'POST' }), {
    params: Promise.resolve({ id: 'b-1' }),
  })

describe('POST /api/whatsapp/broadcast/[id]/cancel', () => {
  beforeEach(() => {
    h.result = { data: [{ id: 'b-1' }], error: null }
    h.update = null
    h.filters = {}
  })

  it('turns a scheduled broadcast back into a draft', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, broadcast_id: 'b-1' })
    expect(h.update).toMatchObject({ status: 'draft', scheduled_at: null })
    // Only this account's row, and only while it is still scheduled.
    expect(h.filters).toEqual({ id: 'b-1', account_id: 'acct-1', status: 'scheduled' })
  })

  it('409s when the broadcast already started sending', async () => {
    h.result = { data: [], error: null }
    expect((await call()).status).toBe(409)
  })

  it('500s on a database error', async () => {
    h.result = { data: null, error: { message: 'down' } }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call()).status).toBe(500)
  })
})
