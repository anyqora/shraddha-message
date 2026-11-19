import type { NextRequest } from 'next/server'
import type { AuthCtx } from '@/lib/db/auth-ctx'
import { bus, type ChangeEvent } from '@/lib/db/events'
import { readPredicate } from '@/lib/db/access'
import { query } from '@/lib/db/pool'
import { ctxFromRequest } from '@/lib/db/route-helpers'
import { SCHEMA } from '@/lib/db/schema.generated'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Server-Sent Events stream of row changes (replaces Supabase Realtime postgres_changes).
 * GET /api/realtime?tables=messages,conversations
 * Each event is delivered only if the subscriber may read the row (read policy re-checked
 * against the database for the changed row's primary key; DELETEs are checked on account_id).
 */
const TABLES = SCHEMA.tables as unknown as Record<string, { primaryKey: readonly string[]; columns: Record<string, unknown> }>

async function canSee(ctx: AuthCtx, ev: ChangeEvent): Promise<boolean> {
  if (ctx.role === 'service') return true
  if (ctx.role !== 'authenticated') return false
  const row = ev.eventType === 'DELETE' ? ev.old : ev.new
  const meta = TABLES[ev.table]
  if (!meta) return false
  if (ev.eventType === 'DELETE') {
    // row no longer exists: fall back to tenant check
    const acc = row.account_id
    if (typeof acc === 'string') return acc in ctx.memberships
    if (ev.table === 'profiles' || ev.table === 'member_presence') return true
    return false
  }
  const pred = readPredicate(ctx, ev.table, 't0')
  if (pred === false) return false
  if (pred === true) return true
  const pk = meta.primaryKey.length ? meta.primaryKey : ['id']
  const where = pk.map((c) => `\`t0\`.\`${c}\` = ?`).join(' AND ')
  const rows = await query(`SELECT 1 FROM \`${ev.table}\` AS t0 WHERE ${where} AND (${pred.sql}) LIMIT 1`, [
    ...pk.map((c) => row[c] as unknown),
    ...pred.params,
  ])
  return rows.length > 0
}

export async function GET(req: NextRequest) {
  const ctx = await ctxFromRequest(req)
  if (ctx.role !== 'authenticated') return new Response('Unauthorized', { status: 401 })
  const tables = new Set(
    (req.nextUrl.searchParams.get('tables') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter((t) => TABLES[t])
  )
  const encoder = new TextEncoder()
  let closed = false
  let onChange: ((ev: ChangeEvent) => void) | null = null
  let ping: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }
      controller.enqueue(encoder.encode(`retry: 3000\n\n`))
      send('ready', { tables: [...tables] })
      onChange = (ev) => {
        if (!tables.has(ev.table)) return
        canSee(ctx, ev)
          .then((ok) => ok && send('change', ev))
          .catch((e) => console.error('[realtime] policy check failed', e))
      }
      bus.on('change', onChange)
      ping = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`))
        } catch {
          closed = true
        }
      }, 25_000)
    },
    cancel() {
      closed = true
      if (onChange) bus.off('change', onChange)
      if (ping) clearInterval(ping)
    },
  })

  req.signal.addEventListener('abort', () => {
    closed = true
    if (onChange) bus.off('change', onChange)
    if (ping) clearInterval(ping)
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
