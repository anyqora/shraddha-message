/* eslint-disable @typescript-eslint/no-explicit-any -- rows/args are dynamic PostgREST-shaped values */
/**
 * Broadcast RPCs: create_broadcast_with_recipients, recompute_broadcast_counts, the wizard
 * delivery lease (acquire / renew / in_flight). The per-recipient aggregate trigger lives in
 * hooks.ts (applyBroadcastAggregate).
 */
import { uuid, query, type Tx } from '../pool'
import {
  arrayArg,
  bool,
  chunk,
  dbTime,
  intArg,
  isAccountMember,
  iso,
  jsonArg,
  readEx,
  rpcError,
  write,
  type RpcFn,
} from './util'

/**
 * create_broadcast_with_recipients → TABLE(broadcast_id, recipient_id, contact_id).
 * Parent + recipient rows in one transaction. Recipients are inserted as 'pending', which
 * contributes nothing to the aggregate counters, so no aggregate bump is needed.
 */
export const create_broadcast_with_recipients: RpcFn = async (args, ctx) => {
  const params = jsonArg(args.p_template_params)
  const contactIds = arrayArg(args.p_contact_ids) ?? []
  if (params === null || params === undefined || !Array.isArray(params)) {
    throw rpcError('p_template_params must be a JSON array with one params array per contact', '22023')
  }
  if (params.length !== contactIds.length) {
    throw rpcError(`p_template_params has ${params.length} entries but p_contact_ids has ${contactIds.length}`, '22023')
  }
  if (params.some((p) => !Array.isArray(p))) {
    throw rpcError('every p_template_params entry must be a JSON array', '22023')
  }
  const totalRecipients = intArg(args.p_total_recipients)

  return write(ctx, async (conn) => {
    // pg had no membership check (SECURITY DEFINER, only called by server code); a
    // session-scoped caller must at least be an agent of the account.
    if (!(await isAccountMember(conn, ctx.auth, args.p_account_id, 'agent'))) {
      throw rpcError('new row violates row-level security policy for table "broadcasts"', '42501')
    }
    const broadcastId = uuid()
    await conn.query(
      `INSERT INTO broadcasts (id, account_id, user_id, name, template_name, template_language, status, total_recipients)
       VALUES (?, ?, ?, ?, ?, ?, 'sending', ?)`,
      [
        broadcastId,
        args.p_account_id,
        args.p_user_id,
        args.p_name,
        args.p_template_name,
        args.p_template_language,
        totalRecipients,
      ]
    )
    const out: { broadcast_id: string; recipient_id: string; contact_id: string }[] = []
    const rows = contactIds.map((cid, i) => ({ id: uuid(), cid, prm: params[i] }))
    for (const part of chunk(rows, 500)) {
      await conn.query(
        `INSERT INTO broadcast_recipients (id, broadcast_id, contact_id, status, template_params) VALUES ${part
          .map(() => "(?, ?, ?, 'pending', ?)")
          .join(', ')}`,
        part.flatMap((r) => [r.id, broadcastId, r.cid, JSON.stringify(r.prm)])
      )
      for (const r of part) out.push({ broadcast_id: broadcastId, recipient_id: r.id, contact_id: r.cid })
    }
    return out
  })
}

/** recompute_broadcast_counts(bid) → void. Rebuilds the counters from broadcast_recipients. */
export async function recomputeBroadcastCounts(conn: Tx, bid: unknown): Promise<void> {
  const [agg] = await query<Record<string, unknown>>(
    `SELECT
       COALESCE(SUM(status IN ('sent','delivered','read','replied')), 0) AS sent_count,
       COALESCE(SUM(status IN ('delivered','read','replied')), 0)        AS delivered_count,
       COALESCE(SUM(status IN ('read','replied')), 0)                    AS read_count,
       COALESCE(SUM(status = 'replied'), 0)                              AS replied_count,
       COALESCE(SUM(status = 'failed'), 0)                               AS failed_count
     FROM broadcast_recipients WHERE broadcast_id = ?`,
    [bid],
    conn
  )
  await conn.query(
    `UPDATE broadcasts SET sent_count = ?, delivered_count = ?, read_count = ?, replied_count = ?, failed_count = ?,
       updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?`,
    [
      Number(agg.sent_count),
      Number(agg.delivered_count),
      Number(agg.read_count),
      Number(agg.replied_count),
      Number(agg.failed_count),
      bid,
    ]
  )
}

export const recompute_broadcast_counts: RpcFn = async (args, ctx) => {
  await write(ctx, (conn) => recomputeBroadcastCounts(conn, args.bid))
  return null
}

/**
 * acquire_broadcast_delivery_lease(p_broadcast_id) → timestamptz | null.
 * Conditional UPDATE (no SKIP LOCKED needed): the WHERE re-checks the lease under the row
 * lock, affectedRows tells whether we won. The new lease value is then re-read inside the
 * same transaction (MySQL has no UPDATE … RETURNING) and returned as an ISO string with full
 * microsecond precision, so renew's equality check (`delivery_lease_until = p_held`) and the
 * wizard's `.eq('delivery_lease_until', lease)` round-trip exactly.
 */
export const acquire_broadcast_delivery_lease: RpcFn = (args, ctx) =>
  write(ctx, async (conn) => {
    const [b] = await query<{ account_id: string }>('SELECT account_id FROM broadcasts WHERE id = ?', [args.p_broadcast_id], conn)
    if (!b || !(await isAccountMember(conn, ctx.auth, b.account_id, 'agent'))) return null
    const [res]: any = await conn.query(
      `UPDATE broadcasts
         SET delivery_lease_until = CURRENT_TIMESTAMP(6) + INTERVAL 5 MINUTE, updated_at = CURRENT_TIMESTAMP(6)
       WHERE id = ?
         AND (delivery_lease_until IS NULL OR delivery_lease_until < CURRENT_TIMESTAMP(6))
         AND (delivery_locked_at IS NULL OR delivery_locked_at < CURRENT_TIMESTAMP(6) - INTERVAL 30 MINUTE)`,
      [args.p_broadcast_id]
    )
    if (!res?.affectedRows) return null
    const [row] = await query<{ l: string }>('SELECT delivery_lease_until AS l FROM broadcasts WHERE id = ?', [args.p_broadcast_id], conn)
    return iso(row?.l ?? null)
  })

/** renew_broadcast_delivery_lease(p_broadcast_id, p_held) → timestamptz | null (only while still holding p_held). */
export const renew_broadcast_delivery_lease: RpcFn = (args, ctx) =>
  write(ctx, async (conn) => {
    const held = dbTime(args.p_held)
    if (!held) return null
    const [b] = await query<{ account_id: string }>('SELECT account_id FROM broadcasts WHERE id = ?', [args.p_broadcast_id], conn)
    if (!b || !(await isAccountMember(conn, ctx.auth, b.account_id, 'agent'))) return null
    const [res]: any = await conn.query(
      `UPDATE broadcasts
         SET delivery_lease_until = CURRENT_TIMESTAMP(6) + INTERVAL 5 MINUTE, updated_at = CURRENT_TIMESTAMP(6)
       WHERE id = ? AND delivery_lease_until = ?`,
      [args.p_broadcast_id, held]
    )
    if (!res?.affectedRows) return null
    const [row] = await query<{ l: string }>('SELECT delivery_lease_until AS l FROM broadcasts WHERE id = ?', [args.p_broadcast_id], conn)
    return iso(row?.l ?? null)
  })

/**
 * broadcast_delivery_in_flight(p_broadcast_id) → boolean. Invoker rights in pg (RLS on
 * broadcasts applied): a caller who cannot see the broadcast gets false.
 */
export const broadcast_delivery_in_flight: RpcFn = async (args, ctx) => {
  const ex = readEx(ctx)
  const [b] = await query<{ account_id: string; f: number | null }>(
    `SELECT account_id,
       (delivery_locked_at > CURRENT_TIMESTAMP(6) - INTERVAL 30 MINUTE OR delivery_lease_until > CURRENT_TIMESTAMP(6)) AS f
     FROM broadcasts WHERE id = ?`,
    [args.p_broadcast_id],
    ex
  )
  if (!b) return false
  if (!(await isAccountMember(ex, ctx.auth, b.account_id, 'viewer'))) return false
  return bool(b.f)
}
