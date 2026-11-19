import { NextResponse, type NextRequest } from 'next/server'
import { executeQuery } from '@/lib/db/execute'
import type { QueryState } from '@/lib/db/query-state'
import { ctxFromRequest, sameOrigin } from '@/lib/db/route-helpers'

export const dynamic = 'force-dynamic'

/**
 * Browser data endpoint (replaces PostgREST). The client sends a serialised QueryState;
 * it runs under the caller's session, so row policies always apply.
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: { message: 'Forbidden', code: '42501' } }, { status: 403 })
  let state: QueryState
  try {
    state = (await req.json()) as QueryState
  } catch {
    return NextResponse.json({ data: null, error: { message: 'Invalid JSON', code: 'PGRST100' }, status: 400 }, { status: 400 })
  }
  if (!state || typeof state.table !== 'string' || !Array.isArray(state.filters) || !Array.isArray(state.orders)) {
    return NextResponse.json({ data: null, error: { message: 'Invalid query', code: 'PGRST100' }, status: 400 }, { status: 400 })
  }
  const ctx = await ctxFromRequest(req)
  if (ctx.role === 'anon') {
    // anon may only read what anon policies allow (none of the app tables)
  }
  const res = await executeQuery(state, ctx)
  return NextResponse.json(res, { status: 200 })
}
