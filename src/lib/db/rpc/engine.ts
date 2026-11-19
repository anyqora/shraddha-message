/* eslint-disable @typescript-eslint/no-explicit-any -- rows/args are dynamic PostgREST-shaped values */
/**
 * Engine / webhook RPCs: conversation counters, AI reply slot, execution counters, webhook
 * failure counter, flow graph replacement, flow timeout scan, duplicate merges.
 * All were SECURITY DEFINER in pg and (except replace_flow_*) do no caller checks; they are
 * only reachable from server code (not in BROWSER_RPC).
 */
import { emitRowChange, jsonText } from '../hooks'
import { query, uuid, type Tx } from '../pool'
import { dbTime, iso, isAccountMember, jsonArg, msOf, parseJson, readEx, rpcError, write, type RpcFn } from './util'

/** bump_conversation_on_inbound(p_conversation_id, p_last_message_text) → void (atomic unread++). */
export const bump_conversation_on_inbound: RpcFn = async (args, ctx) => {
  await write(ctx, async (conn) => {
    const [res]: any = await conn.query(
      `UPDATE conversations
         SET unread_count = COALESCE(unread_count, 0) + 1, last_message_text = ?,
             last_message_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6)
       WHERE id = ?`,
      [args.p_last_message_text ?? null, args.p_conversation_id]
    )
    if (res?.affectedRows) await emitRowChange(conn, 'conversations', 'UPDATE', { id: args.p_conversation_id })
  })
  return null
}

/** claim_ai_reply_slot(conversation_id, max_replies) → boolean (cap check + increment in one UPDATE). */
export const claim_ai_reply_slot: RpcFn = (args, ctx) =>
  write(ctx, async (conn) => {
    const [res]: any = await conn.query(
      `UPDATE conversations SET ai_reply_count = ai_reply_count + 1, updated_at = CURRENT_TIMESTAMP(6)
       WHERE id = ? AND ai_reply_count < ? AND NOT ai_autoreply_disabled AND assigned_agent_id IS NULL`,
      [args.conversation_id, args.max_replies ?? null]
    )
    const claimed = (res?.affectedRows ?? 0) > 0
    if (claimed) await emitRowChange(conn, 'conversations', 'UPDATE', { id: args.conversation_id })
    return claimed
  })

/** increment_automation_execution_count(p_automation_id) → void */
export const increment_automation_execution_count: RpcFn = async (args, ctx) => {
  await write(ctx, (conn) =>
    conn.query(
      `UPDATE automations SET execution_count = execution_count + 1, last_executed_at = CURRENT_TIMESTAMP(6),
         updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?`,
      [args.p_automation_id]
    )
  )
  return null
}

/** increment_flow_execution_count(p_flow_id) → void */
export const increment_flow_execution_count: RpcFn = async (args, ctx) => {
  await write(ctx, (conn) =>
    conn.query(
      `UPDATE flows SET execution_count = execution_count + 1, last_executed_at = CURRENT_TIMESTAMP(6),
         updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?`,
      [args.p_flow_id]
    )
  )
  return null
}

/** record_webhook_failure(endpoint_id, max_failures) → void (increment + auto-disable at threshold). */
export const record_webhook_failure: RpcFn = async (args, ctx) => {
  await write(ctx, (conn) =>
    // is_active is assigned first so it still sees the pre-increment failure_count
    conn.query(
      `UPDATE webhook_endpoints
         SET is_active = CASE WHEN failure_count + 1 >= ? THEN 0 ELSE is_active END,
             failure_count = failure_count + 1
       WHERE id = ?`,
      [args.max_failures ?? null, args.endpoint_id]
    )
  )
  return null
}

/** pg `(n->>'position_x')::INTEGER` — lenient: numbers are rounded instead of raising 22P02. */
function intOrZero(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  if (!Number.isFinite(n)) throw rpcError(`invalid input syntax for type integer: "${String(v)}"`, '22P02')
  return Math.round(n)
}

/** replace_flow_nodes body; returns the number of active runs cancelled. */
export async function replaceFlowNodes(conn: Tx, ctx: Parameters<RpcFn>[1], flowId: unknown, nodesIn: unknown): Promise<number> {
  if (ctx.auth.role !== 'service' && !ctx.auth.userId) throw rpcError('Unauthorized', '42501')
  const nodes = jsonArg(nodesIn)
  if (nodes === null || nodes === undefined || !Array.isArray(nodes)) throw rpcError('p_nodes must be a JSON array', '22023')
  const [flow] = await query<{ account_id: string }>('SELECT account_id FROM flows WHERE id = ? FOR UPDATE', [flowId], conn)
  if (!flow?.account_id || !(await isAccountMember(conn, ctx.auth, flow.account_id, 'agent'))) {
    throw rpcError('Flow not found', '42501')
  }
  await conn.query('DELETE FROM flow_nodes WHERE flow_id = ?', [flowId])
  if (nodes.length) {
    const rows = nodes.map((n: any) => {
      const o = n && typeof n === 'object' ? n : {}
      return [
        uuid(),
        flowId,
        jsonText(o.node_key),
        jsonText(o.node_type),
        JSON.stringify(o.config === undefined ? {} : o.config),
        intOrZero(o.position_x),
        intOrZero(o.position_y),
      ]
    })
    await conn.query(
      `INSERT INTO flow_nodes (id, flow_id, node_key, node_type, config, position_x, position_y) VALUES ${rows
        .map(() => '(?, ?, ?, ?, ?, ?, ?)')
        .join(', ')}`,
      rows.flat()
    )
  }
  const cancel = await query<{ id: string }>(
    `SELECT r.id FROM flow_runs r
     WHERE r.flow_id = ? AND r.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM flow_nodes fn WHERE fn.flow_id = ? AND fn.node_key = r.current_node_key)
     FOR UPDATE`,
    [flowId, flowId],
    conn
  )
  if (!cancel.length) return 0
  const ids = cancel.map((r) => r.id)
  const [res]: any = await conn.query(
    `UPDATE flow_runs SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP(6), end_reason = 'current_node_removed'
     WHERE id IN (?) AND status = 'active'`,
    [ids]
  )
  for (const id of ids) await emitRowChange(conn, 'flow_runs', 'UPDATE', { id })
  return res?.affectedRows ?? ids.length
}

/** replace_flow_nodes(p_flow_id, p_nodes) → integer */
export const replace_flow_nodes: RpcFn = (args, ctx) => write(ctx, (conn) => replaceFlowNodes(conn, ctx, args.p_flow_id, args.p_nodes))

const FLOW_TEXT_KEYS = ['name', 'description', 'trigger_type', 'entry_node_id'] as const
const FLOW_JSON_KEYS = ['trigger_config', 'fallback_policy'] as const

/** replace_flow_graph(p_flow_id, p_nodes, p_flow) → integer. Nodes + flow-row patch in one tx. */
export const replace_flow_graph: RpcFn = (args, ctx) => {
  const flow = jsonArg(args.p_flow)
  if (flow === null || flow === undefined || typeof flow !== 'object' || Array.isArray(flow)) {
    return Promise.reject(rpcError('p_flow must be a JSON object', '22023'))
  }
  return write(ctx, async (conn) => {
    const cancelled = await replaceFlowNodes(conn, ctx, args.p_flow_id, args.p_nodes)
    const sets: string[] = []
    const params: unknown[] = []
    for (const k of FLOW_TEXT_KEYS)
      if (k in flow) {
        sets.push(`\`${k}\` = ?`)
        params.push(jsonText(flow[k]))
      }
    for (const k of FLOW_JSON_KEYS)
      if (k in flow) {
        sets.push(`\`${k}\` = ?`)
        params.push(JSON.stringify(flow[k] === undefined ? null : flow[k]))
      }
    sets.push('updated_at = CURRENT_TIMESTAMP(6)')
    await conn.query(`UPDATE flows SET ${sets.join(', ')} WHERE id = ?`, [...params, args.p_flow_id])
    return cancelled
  })
}

/**
 * list_timed_out_flow_runs(p_now, p_limit) → TABLE(id, last_advanced_at, fallback_policy).
 * The per-flow timeout (fallback_policy.on_timeout_hours, default 24h, capped at 87600h) is
 * evaluated in TS: JSON_TYPE names differ between MySQL and MariaDB.
 */
export const list_timed_out_flow_runs: RpcFn = async (args, ctx) => {
  const nowStr = dbTime(args.p_now ?? new Date())!
  const nowMs = msOf(nowStr)!
  const limit = Math.max(Number(args.p_limit ?? 0) || 0, 0)
  if (!limit) return []
  const rows = await query<Record<string, any>>(
    `SELECT r.id, r.last_advanced_at, f.fallback_policy
     FROM flow_runs r LEFT JOIN flows f ON f.id = r.flow_id
     WHERE r.status = 'active' AND r.last_advanced_at <= ?
     ORDER BY r.last_advanced_at, r.id`,
    [nowStr],
    readEx(ctx)
  )
  const out: { id: string; last_advanced_at: string | null; fallback_policy: unknown }[] = []
  for (const r of rows) {
    const policy = parseJson(r.fallback_policy) ?? null
    const h = policy && typeof policy === 'object' ? (policy as any).on_timeout_hours : undefined
    const hours = typeof h === 'number' && h > 0 ? Math.min(h, 87600) : 24
    const adv = msOf(r.last_advanced_at)!
    if (adv <= nowMs - hours * 3600_000) {
      out.push({ id: r.id, last_advanced_at: iso(r.last_advanced_at), fallback_policy: policy })
      if (out.length >= limit) break
    }
  }
  return out
}

function requireService(ctx: Parameters<RpcFn>[1], name: string) {
  if (ctx.auth.role !== 'service') throw rpcError(`permission denied for function ${name}`, '42501')
}

/**
 * merge_duplicate_contacts() → integer (losers merged). Maintenance function (migrations only),
 * service role only. No realtime events are emitted for the re-pointed rows.
 */
export const merge_duplicate_contacts: RpcFn = (_args, ctx) => {
  requireService(ctx, 'merge_duplicate_contacts')
  return write(ctx, async (conn) => {
    const rows = await query<{ account_id: string; phone_normalized: string; id: string }>(
      `SELECT c.account_id, c.phone_normalized, c.id FROM contacts c
       JOIN (SELECT account_id, phone_normalized FROM contacts WHERE phone_normalized <> ''
             GROUP BY account_id, phone_normalized HAVING COUNT(*) > 1) d
         ON d.account_id = c.account_id AND d.phone_normalized = c.phone_normalized
       ORDER BY c.account_id, c.phone_normalized, (c.created_at IS NULL), c.created_at, c.id`,
      [],
      conn
    )
    const groups = new Map<string, string[]>()
    for (const r of rows) {
      const k = `${r.account_id}\u0000${r.phone_normalized}`
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(r.id)
    }
    let merged = 0
    for (const ids of groups.values()) {
      const [survivor, ...losers] = ids
      if (!losers.length) continue
      for (const t of ['conversations', 'contact_notes', 'deals', 'broadcast_recipients', 'automation_logs', 'automation_pending_executions']) {
        await conn.query(`UPDATE \`${t}\` SET contact_id = ? WHERE contact_id IN (?)`, [survivor, losers])
      }
      // UNIQUE(contact_id, tag_id) / UNIQUE(contact_id, custom_field_id): move only what the
      // survivor lacks (one row per key, so several losers sharing a tag cannot collide), drop the rest.
      for (const [t, key] of [
        ['contact_tags', 'tag_id'],
        ['contact_custom_values', 'custom_field_id'],
      ] as const) {
        const have = new Set(
          (await query<Record<string, string>>(`SELECT \`${key}\` AS k FROM \`${t}\` WHERE contact_id = ?`, [survivor], conn)).map((r) => r.k)
        )
        const cand = await query<{ id: string; k: string }>(
          `SELECT id, \`${key}\` AS k FROM \`${t}\` WHERE contact_id IN (?) ORDER BY id`,
          [losers],
          conn
        )
        for (const c of cand) {
          if (have.has(c.k)) continue
          have.add(c.k)
          await conn.query(`UPDATE \`${t}\` SET contact_id = ? WHERE id = ?`, [survivor, c.id])
        }
        await conn.query(`DELETE FROM \`${t}\` WHERE contact_id IN (?)`, [losers])
      }
      await conn.query("UPDATE flow_runs SET contact_id = ? WHERE contact_id IN (?) AND status <> 'active'", [survivor, losers])
      await conn.query('DELETE FROM contacts WHERE id IN (?)', [losers])
      merged += losers.length
    }
    return merged
  })
}

/** merge_duplicate_conversations() → integer. Maintenance, service role only. */
export const merge_duplicate_conversations: RpcFn = (_args, ctx) => {
  requireService(ctx, 'merge_duplicate_conversations')
  return write(ctx, async (conn) => {
    const rows = await query<{ account_id: string; contact_id: string; id: string; unread_count: number | null }>(
      `SELECT c.account_id, c.contact_id, c.id, c.unread_count FROM conversations c
       JOIN (SELECT account_id, contact_id FROM conversations GROUP BY account_id, contact_id HAVING COUNT(*) > 1) d
         ON d.account_id = c.account_id AND d.contact_id = c.contact_id
       ORDER BY c.account_id, c.contact_id, (c.created_at IS NULL), c.created_at, c.id`,
      [],
      conn
    )
    const groups = new Map<string, { ids: string[]; unread: number }>()
    for (const r of rows) {
      const k = `${r.account_id}\u0000${r.contact_id}`
      const g = groups.get(k) ?? { ids: [], unread: 0 }
      g.ids.push(r.id)
      g.unread += Number(r.unread_count ?? 0)
      groups.set(k, g)
    }
    let merged = 0
    for (const { ids, unread } of groups.values()) {
      const [survivor, ...losers] = ids
      if (!losers.length) continue
      for (const t of ['messages', 'message_reactions', 'deals', 'flow_runs', 'notifications', 'ai_usage_log']) {
        await conn.query(`UPDATE \`${t}\` SET conversation_id = ? WHERE conversation_id IN (?)`, [survivor, losers])
      }
      const [lm] = await query<{ content_text: string | null; created_at: string | null }>(
        'SELECT content_text, created_at FROM messages WHERE conversation_id = ? ORDER BY (created_at IS NULL) DESC, created_at DESC LIMIT 1',
        [survivor],
        conn
      )
      if (lm) {
        await conn.query(
          `UPDATE conversations SET unread_count = ?, last_message_text = ?, last_message_at = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?`,
          [unread, lm.content_text, lm.created_at, survivor]
        )
      } else {
        await conn.query('UPDATE conversations SET unread_count = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [unread, survivor])
      }
      await conn.query('DELETE FROM conversations WHERE id IN (?)', [losers])
      merged += losers.length
    }
    return merged
  })
}
