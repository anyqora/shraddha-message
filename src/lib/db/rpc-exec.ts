import 'server-only'
import type { AuthCtx } from './auth-ctx'
import type { RpcCall } from './client-core'
import { toPgError } from './execute'
import type { Tx } from './pool'
import type { PostgrestResponse } from './query-state'
import { BROWSER_RPC, RPC } from './rpc'

/** Execute an RPC call (replaces PostgREST /rpc/<fn>) and shape the result like supabase-js. */
export async function executeRpc(
  call: RpcCall,
  auth: AuthCtx,
  opts: { fromBrowser?: boolean; conn?: Tx } = {}
): Promise<PostgrestResponse> {
  const fn = RPC[call.fn]
  if (!fn || (opts.fromBrowser && !BROWSER_RPC.has(call.fn))) {
    return {
      data: null,
      error: {
        message: `Could not find the function public.${call.fn} in the schema cache`,
        details: null,
        hint: null,
        code: 'PGRST202',
      },
      count: null,
      status: 404,
      statusText: 'Not Found',
    }
  }
  try {
    let data: any = await fn(call.args ?? {}, { auth, conn: opts.conn })
    if (data === undefined) data = null
    const count = call.count ? (Array.isArray(data) ? data.length : data === null ? 0 : 1) : null
    if (call.head) data = null
    if (call.single) {
      const arr = Array.isArray(data) ? data : data === null ? [] : [data]
      if (arr.length === 1) data = arr[0]
      else if (arr.length === 0 && call.single === 'maybe') data = null
      else
        return {
          data: null,
          error: {
            message: 'JSON object requested, multiple (or no) rows returned',
            details: `The result contains ${arr.length} rows`,
            hint: null,
            code: 'PGRST116',
          },
          count,
          status: 406,
          statusText: 'Not Acceptable',
        }
    }
    return { data, error: null, count, status: 200, statusText: 'OK' }
  } catch (e) {
    const err = toPgError(e)
    if (err.status >= 500) console.error(`[rpc] ${call.fn}`, err.message)
    return {
      data: null,
      error: { message: err.message, details: err.details, hint: err.hint, code: err.code },
      count: null,
      status: err.status,
      statusText: 'Error',
    }
  }
}
