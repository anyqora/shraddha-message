import { NextResponse, type NextRequest } from 'next/server'
import type { RpcCall } from '@/lib/db/client-core'
import { ctxFromRequest, sameOrigin } from '@/lib/db/route-helpers'
import { executeRpc } from '@/lib/db/rpc-exec'

export const dynamic = 'force-dynamic'

/** Browser RPC endpoint (replaces PostgREST /rpc). Only BROWSER_RPC functions are callable. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: { message: 'Forbidden', code: '42501' } }, { status: 403 })
  let call: RpcCall
  try {
    call = (await req.json()) as RpcCall
  } catch {
    return NextResponse.json({ data: null, error: { message: 'Invalid JSON', code: 'PGRST100' } }, { status: 400 })
  }
  if (!call || typeof call.fn !== 'string') {
    return NextResponse.json({ data: null, error: { message: 'Invalid call', code: 'PGRST100' } }, { status: 400 })
  }
  const ctx = await ctxFromRequest(req)
  const res = await executeRpc(call, ctx, { fromBrowser: true })
  return NextResponse.json(res, { status: 200 })
}
