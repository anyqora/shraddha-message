import 'server-only'
/* eslint-disable @typescript-eslint/no-explicit-any -- rows/args are dynamic PostgREST-shaped values */
/**
 * Table hooks: the TypeScript replacement for the Postgres triggers
 * (docs/mysql-port/pg-schema/triggers_policies.sql).
 *
 * The query executor (execute.ts) calls these for every write that goes through the
 * builder, inside the write transaction. Writes that RPC code (rpc/*.ts) performs with raw
 * SQL do NOT pass through here. Those call the exported side-effect helpers below
 * (`applyBroadcastAggregate`, `trackConversationMessageTimes`, `emitRowChange`, ...)
 * themselves where the Postgres trigger would have fired. See
 * docs/mysql-port/functions-notes.md for which RPC does what.
 *
 * Trigger → hook map (pg BEFORE triggers on one table fire in trigger-name order, and the
 * hooks below keep that order):
 *   auth.users       on_auth_user_created (AFTER INSERT)          → auth_users.afterInsert, and
 *                    handleNewUser(userId) which auth.ts calls via setUserCreatedHook
 *   accounts         enforce_account_identity_columns, set_updated_at
 *   ai_configs / ai_knowledge_documents / automations / broadcasts / companies / contacts /
 *   flows / message_templates / quick_replies / views / whatsapp_config
 *                    set_updated_at (BEFORE UPDATE)
 *   broadcast_recipients broadcast_recipients_aggregate (AFTER INSERT/UPDATE/DELETE)
 *   conversations    conversations_stamp_closed_at, enforce_conversation_assignee_membership,
 *                    set_updated_at (BEFORE); on_conversation_assigned (AFTER)
 *   deals            deals_stamp_closed_at, set_updated_at
 *   messages         messages_track_conversation_times (AFTER INSERT / UPDATE OF status)
 *   profiles         enforce_profile_privilege_columns, set_updated_at
 *   tasks            set_updated_at, tasks_stamp_completed_at
 *   realtime_notify_trg → not here: execute.ts publishes builder writes itself; RPC code uses
 *                    emitRowChange().
 * Plus the Postgres partial UNIQUE indexes MySQL cannot express (schema.generated.ts
 * `partialUnique`): contacts idx_contacts_account_phone_normalized, flow_runs
 * idx_one_active_run_per_contact, message_reactions idx_message_reactions_one_agent_reaction.
 */
import type { AuthCtx } from './auth-ctx'
import { decodeRow, toMysqlDatetime } from './codec'
import { publishChange } from './events'
import { query, tx, uuid, type Tx } from './pool'

type Row = Record<string, any>

export interface HookCtx {
  conn: Tx
  auth: AuthCtx
  table: string
}

export interface TableHooks {
  /** may mutate row (defaults, stamps, validation → throw HookError) */
  beforeInsert?: (row: Row, ctx: HookCtx) => void | Promise<void>
  /** newRow = merged full row, may mutate */
  beforeUpdate?: (newRow: Row, oldRow: Row, ctx: HookCtx) => void | Promise<void>
  afterInsert?: (row: Row, ctx: HookCtx) => void | Promise<void>
  afterUpdate?: (newRow: Row, oldRow: Row, ctx: HookCtx) => void | Promise<void>
  afterDelete?: (oldRow: Row, ctx: HookCtx) => void | Promise<void>
}

/** A trigger/RPC error. `code` is the Postgres SQLSTATE the app checks (42501, 22023, 23505, ...). */
export class HookError extends Error {
  constructor(
    message: string,
    public code = 'P0001'
  ) {
    super(message)
    this.name = 'HookError'
  }
}

// ── small value helpers ──────────────────────────────────────────────────────

/** Normalise a timestamp-ish value (Date | ISO | MySQL DATETIME string) for comparison. */
export function tsKey(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  try {
    return toMysqlDatetime(v)
  } catch {
    return String(v)
  }
}

/** SQL `IS DISTINCT FROM` for plain scalars (uuid/text/enum). */
function distinct(a: unknown, b: unknown): boolean {
  const na = a === undefined ? null : a
  const nb = b === undefined ? null : b
  return na !== nb
}

/** MySQL error that aborted the whole transaction (must never be swallowed). */
function isTxFatal(e: any): boolean {
  return e?.errno === 1213 /* deadlock */ || e?.errno === 1205 /* lock wait timeout */ || e?.code === 'PROTOCOL_CONNECTION_LOST'
}

const now = () => new Date()

// ── realtime ─────────────────────────────────────────────────────────────────

/**
 * Publish a realtime change for a row written with raw SQL (the pg realtime_notify trigger
 * fired for those too). Re-reads the row on `conn` and publishes after COMMIT.
 * Only tables that had realtime_notify_trg in Postgres need this: conversations, flow_runs,
 * member_presence, message_reactions, messages, notifications, tasks.
 */
export async function emitRowChange(
  conn: Tx,
  table: string,
  eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  pk: Record<string, unknown>,
  oldRow?: Row
): Promise<void> {
  let newRow: Row = {}
  if (eventType !== 'DELETE') {
    const cols = Object.keys(pk)
    const rows = await query(
      `SELECT * FROM \`${table}\` WHERE ${cols.map((c) => `\`${c}\` = ?`).join(' AND ')} LIMIT 1`,
      cols.map((c) => pk[c]),
      conn
    )
    if (!rows[0]) return
    newRow = decodeRow(table, rows[0])
  }
  const old = eventType === 'INSERT' ? {} : oldRow ? decodeRow(table, oldRow) : { ...pk }
  const fire = () => publishChange({ table, eventType, new: newRow, old })
  if (typeof (conn as Partial<Tx>).onCommit === 'function') conn.onCommit(fire)
  else fire()
}

// ── updated_at (update_updated_at_column / update_ai_*_updated_at) ──────────

const stampUpdatedAt: TableHooks = {
  beforeUpdate(row) {
    row.updated_at = now()
  },
}

// ── accounts: enforce_account_identity_columns ───────────────────────────────

const accountIdentity: TableHooks = {
  beforeUpdate(row, old, ctx) {
    if (ctx.auth.role !== 'authenticated') return
    if (
      distinct(row.owner_user_id, old.owner_user_id) ||
      distinct(row.id, old.id) ||
      tsKey(row.created_at) !== tsKey(old.created_at)
    ) {
      throw new HookError(
        'owner_user_id, id and created_at cannot be changed directly; use transfer_account_ownership',
        '42501'
      )
    }
  },
}

// ── profiles: enforce_profile_privilege_columns ──────────────────────────────

const profilePrivilege: TableHooks = {
  beforeInsert(_row, ctx) {
    if (ctx.auth.role !== 'authenticated') return
    throw new HookError('profiles are created by the signup trigger; they cannot be inserted directly', '42501')
  },
  beforeUpdate(row, old, ctx) {
    if (ctx.auth.role !== 'authenticated') return
    if (distinct(row.account_role, old.account_role) || distinct(row.account_id, old.account_id)) {
      throw new HookError(
        'account_role and account_id cannot be changed directly; use the account member/invitation RPCs',
        '42501'
      )
    }
  },
}

// ── conversations ────────────────────────────────────────────────────────────

/**
 * stamp_conversation_closed_at — BEFORE INSERT OR UPDATE OF status.
 * "UPDATE OF status" fires whenever status is in the SET list; the executor gives us the
 * merged row only, so on UPDATE we run when status actually changed (an unchanged status
 * would leave closed_at as COALESCE(OLD.closed_at, now()) ≈ unchanged anyway).
 */
const conversationClosedAt: TableHooks = {
  beforeInsert(row) {
    const status = row.status ?? 'open'
    if (status !== 'closed') row.closed_at = null
    else row.closed_at = row.closed_at ?? now()
  },
  beforeUpdate(row, old) {
    if (!distinct(row.status, old.status)) return
    if (row.status !== 'closed') row.closed_at = null
    else if (old.status !== 'closed') row.closed_at = now()
    else row.closed_at = old.closed_at ?? now()
  },
}

async function isProfileInAccount(conn: Tx, userId: unknown, accountId: unknown): Promise<boolean> {
  if (!userId || !accountId) return false
  const rows = await query('SELECT 1 AS ok FROM profiles WHERE user_id = ? AND account_id = ? LIMIT 1', [userId, accountId], conn)
  return rows.length > 0
}

/** enforce_conversation_assignee_membership — BEFORE INSERT OR UPDATE OF assigned_agent_id, account_id. */
async function enforceAssignee(row: Row, old: Row | null, conn: Tx): Promise<void> {
  if (!row.assigned_agent_id) return
  if (old && !distinct(row.assigned_agent_id, old.assigned_agent_id) && !distinct(row.account_id, old.account_id)) return
  if (await isProfileInAccount(conn, row.assigned_agent_id, row.account_id)) return
  if (old && !distinct(row.account_id, old.account_id) && (await isProfileInAccount(conn, old.assigned_agent_id, old.account_id))) {
    row.assigned_agent_id = old.assigned_agent_id
  } else {
    row.assigned_agent_id = null
  }
}

const conversationAssignee: TableHooks = {
  beforeInsert: (row, ctx) => enforceAssignee(row, null, ctx.conn),
  beforeUpdate: (row, old, ctx) => enforceAssignee(row, old, ctx.conn),
}

/**
 * notify_conversation_assigned — AFTER INSERT OR UPDATE OF assigned_agent_id.
 * Inserts a `conversation_assigned` notification for the new assignee (unless they assigned
 * themselves). Errors are swallowed like the pg `EXCEPTION WHEN OTHERS → WARNING`.
 */
export async function notifyConversationAssigned(conn: Tx, auth: AuthCtx, row: Row, old: Row | null): Promise<void> {
  if (!row.assigned_agent_id) return
  if (old && !distinct(row.assigned_agent_id, old.assigned_agent_id)) return
  const actor = auth.userId ?? null
  if (actor && actor === row.assigned_agent_id) return
  try {
    if (!(await isProfileInAccount(conn, row.assigned_agent_id, row.account_id))) return
    const contact = await query<{ n: string | null }>(
      "SELECT COALESCE(NULLIF(name, ''), phone) AS n FROM contacts WHERE id = ?",
      [row.contact_id],
      conn
    )
    let actorName: string | null = null
    if (actor) {
      const p = await query<{ full_name: string | null }>('SELECT full_name FROM profiles WHERE user_id = ?', [actor], conn)
      actorName = p[0]?.full_name ?? null
    }
    const id = uuid()
    await conn.query(
      `INSERT INTO notifications (id, account_id, user_id, type, conversation_id, contact_id, actor_user_id, title, body)
       VALUES (?, ?, ?, 'conversation_assigned', ?, ?, ?, 'New conversation assigned', ?)`,
      [
        id,
        row.account_id,
        row.assigned_agent_id,
        row.id,
        row.contact_id ?? null,
        actor,
        `${actorName ?? 'Someone'} assigned you a conversation with ${contact[0]?.n ?? 'a contact'}`,
      ]
    )
    await emitRowChange(conn, 'notifications', 'INSERT', { id })
  } catch (e) {
    if (isTxFatal(e)) throw e
    console.warn(`[hooks] Failed to create assignment notification for conversation ${row.id}:`, (e as Error)?.message)
  }
}

const conversationNotify: TableHooks = {
  afterInsert: (row, ctx) => notifyConversationAssigned(ctx.conn, ctx.auth, row, null),
  afterUpdate: (row, old, ctx) => notifyConversationAssigned(ctx.conn, ctx.auth, row, old),
}

// ── deals: stamp_deal_closed_at (BEFORE INSERT OR UPDATE OF status) ─────────

const dealClosedAt: TableHooks = {
  beforeInsert(row) {
    const status = row.status === undefined ? 'open' : row.status
    // `status NOT IN ('won','lost')` is NULL (not true) for a NULL status → falls through
    if (status !== null && status !== 'won' && status !== 'lost') row.closed_at = null
    else row.closed_at = row.closed_at ?? now()
  },
  beforeUpdate(row, old) {
    if (!distinct(row.status, old.status)) return // UPDATE OF status: see conversations note
    if (row.status !== null && row.status !== 'won' && row.status !== 'lost') row.closed_at = null
    else row.closed_at = now() // OLD.status IS DISTINCT FROM NEW.status
  },
}

// ── tasks: tasks_stamp_completed_at (BEFORE INSERT OR UPDATE) ───────────────

function stampTaskCompleted(row: Row, old: Row | null) {
  const status = row.status === undefined ? 'todo' : row.status
  if (status === 'done' && (!old || old.status !== 'done')) row.completed_at = now()
  else if (status !== null && status !== 'done') row.completed_at = null
}

const taskCompletedAt: TableHooks = {
  beforeInsert: (row) => stampTaskCompleted(row, null),
  beforeUpdate: (row, old) => stampTaskCompleted(row, old),
}

// ── broadcast_recipients: broadcast_recipient_aggregate_trigger ──────────────

const BCAST_COLS = ['sent_count', 'delivered_count', 'read_count', 'replied_count', 'failed_count'] as const

/** _bcast_cols_for_status */
export function bcastColsForStatus(s: unknown): string[] {
  switch (s) {
    case 'sent':
      return ['sent_count']
    case 'delivered':
      return ['sent_count', 'delivered_count']
    case 'read':
      return ['sent_count', 'delivered_count', 'read_count']
    case 'replied':
      return ['sent_count', 'delivered_count', 'read_count', 'replied_count']
    case 'failed':
      return ['failed_count']
    default:
      return [] // 'pending' and anything else contribute nothing
  }
}

/**
 * Apply the aggregate-counter delta for one recipient status transition (null = row did not
 * exist / was deleted). Same arithmetic as the sequence of `_bcast_bump` calls: each bump is
 * `GREATEST(0, col + delta)`, old contributions subtracted first, then the new ones added,
 * and a NULL counter becomes 0 (pg GREATEST ignores NULLs).
 */
export async function applyBroadcastAggregate(
  conn: Tx,
  broadcastId: unknown,
  oldStatus: unknown | null,
  newStatus: unknown | null
): Promise<void> {
  if (!broadcastId) return
  const ops: Record<string, number[]> = {}
  for (const c of oldStatus == null ? [] : bcastColsForStatus(oldStatus)) (ops[c] ??= []).push(-1)
  for (const c of newStatus == null ? [] : bcastColsForStatus(newStatus)) (ops[c] ??= []).push(1)
  const cols = Object.keys(ops).filter((c) => (BCAST_COLS as readonly string[]).includes(c))
  if (!cols.length) return
  const sets = cols.map((c) => {
    let expr = `\`${c}\``
    for (const d of ops[c]) expr = `GREATEST(0, COALESCE(${expr} + (${d}), 0))`
    return `\`${c}\` = ${expr}`
  })
  await conn.query(`UPDATE broadcasts SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?`, [broadcastId])
}

const broadcastRecipientAggregate: TableHooks = {
  afterInsert: (row, ctx) => applyBroadcastAggregate(ctx.conn, row.broadcast_id, null, row.status ?? 'pending'),
  afterUpdate: async (row, old, ctx) => {
    if (!distinct(row.status, old.status)) return
    // pg uses NEW.broadcast_id for both halves
    await applyBroadcastAggregate(ctx.conn, row.broadcast_id, old.status, row.status)
  },
  afterDelete: (old, ctx) => applyBroadcastAggregate(ctx.conn, old.broadcast_id, old.status, null),
}

// ── messages: track_conversation_message_times ───────────────────────────────

/**
 * AFTER INSERT OR UPDATE OF status on messages: keeps conversations.last_inbound_at /
 * last_reply_at in sync (dashboard "awaiting reply" relies on them).
 */
export async function trackConversationMessageTimes(conn: Tx, row: Row, old: Row | null): Promise<void> {
  const isReply = row.sender_type === 'agent' || row.ai_generated === true || row.ai_generated === 1
  const status = row.status ?? 'sent'
  if (!old) {
    let createdAt = row.created_at
    if (createdAt === undefined && row.id) {
      const r = await query<{ created_at: string | null }>('SELECT created_at FROM messages WHERE id = ?', [row.id], conn)
      createdAt = r[0]?.created_at
    }
    const ts = tsKey(createdAt)
    if (!ts) return // GREATEST(x, NULL) in pg ignores the NULL → no change
    let col: string | null = null
    if (row.sender_type === 'customer') col = 'last_inbound_at'
    else if (isReply && status !== 'failed') col = 'last_reply_at'
    if (!col) return
    await conn.query(
      `UPDATE conversations SET \`${col}\` = GREATEST(COALESCE(\`${col}\`, ?), ?), updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?`,
      [ts, ts, row.conversation_id]
    )
    await emitRowChange(conn, 'conversations', 'UPDATE', { id: row.conversation_id })
    return
  }
  if (status === 'failed' && old.status !== 'failed' && isReply) {
    await conn.query(
      `UPDATE conversations SET last_reply_at = (
         SELECT MAX(m.created_at) FROM messages m
         WHERE m.conversation_id = ? AND (m.sender_type = 'agent' OR m.ai_generated = 1) AND m.status <> 'failed'
       ), updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?`,
      [row.conversation_id, row.conversation_id]
    )
    await emitRowChange(conn, 'conversations', 'UPDATE', { id: row.conversation_id })
  }
}

const messageTimes: TableHooks = {
  afterInsert: (row, ctx) => trackConversationMessageTimes(ctx.conn, row, null),
  afterUpdate: (row, old, ctx) => trackConversationMessageTimes(ctx.conn, row, old),
}

// ── auth_users: handle_new_user ──────────────────────────────────────────────

function jsonObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object') return v as Record<string, unknown>
  if (typeof v === 'string') {
    try {
      const o = JSON.parse(v)
      return o && typeof o === 'object' ? o : {}
    } catch {
      return {}
    }
  }
  return {}
}

/** `->>` semantics: strings as-is, other JSON values as their JSON text, null → null. */
export function jsonText(v: unknown): string | null {
  if (v === null || v === undefined) return null
  return typeof v === 'string' ? v : JSON.stringify(v)
}

/**
 * handle_new_user body: bootstrap a personal account (owner) + profile for a new auth user
 * row. Failures are logged and swallowed (pg: RAISE WARNING), rolled back to a savepoint so a
 * half-created account never survives.
 */
export async function bootstrapNewUser(conn: Tx, user: Row): Promise<void> {
  const meta = jsonObj(user.raw_user_meta_data)
  const fullName = jsonText(meta.full_name) ?? ''
  await conn.query('SAVEPOINT handle_new_user')
  try {
    const accountId = uuid()
    await conn.query('INSERT INTO accounts (id, name, owner_user_id) VALUES (?, ?, ?)', [
      accountId,
      fullName !== '' ? fullName : (user.email ?? 'My account'),
      user.id,
    ])
    await conn.query(
      "INSERT INTO profiles (id, user_id, full_name, email, account_id, account_role) VALUES (?, ?, ?, ?, ?, 'owner')",
      [uuid(), user.id, fullName, user.email ?? null, accountId]
    )
    await conn.query('RELEASE SAVEPOINT handle_new_user')
  } catch (e) {
    if (isTxFatal(e)) throw e
    try {
      await conn.query('ROLLBACK TO SAVEPOINT handle_new_user')
    } catch {
      /* ignore */
    }
    console.warn(`[hooks] Failed to bootstrap account/profile for user ${user.id}:`, (e as Error)?.message)
  }
}

/**
 * handle_new_user (on_auth_user_created). auth.ts inserts auth_users with raw SQL and calls
 * this through setUserCreatedHook. Opens its own transaction unless `conn` is given.
 */
export async function handleNewUser(userId: string, conn?: Tx): Promise<void> {
  await tx(async (c) => {
    const rows = await query('SELECT id, email, raw_user_meta_data FROM auth_users WHERE id = ?', [userId], c)
    if (rows[0]) await bootstrapNewUser(c, rows[0])
  }, conn)
}

// ── partial UNIQUE indexes MySQL cannot enforce ──────────────────────────────

function uniqueViolation(name: string, detail: string): HookError {
  const e = new HookError(`duplicate key value violates unique constraint "${name}"`, '23505')
  ;(e as any).details = detail
  return e
}

/**
 * Locking read (FOR UPDATE) so two concurrent inserts serialise on the index gap
 * (InnoDB REPEATABLE READ next-key locks); the loser waits, then sees the winner's row.
 */
async function conflictExists(conn: Tx, sql: string, params: unknown[]): Promise<boolean> {
  const rows = await query(`${sql} LIMIT 1 FOR UPDATE`, params, conn)
  return rows.length > 0
}

/** idx_contacts_account_phone_normalized: UNIQUE (account_id, phone_normalized) WHERE phone_normalized <> '' */
async function checkContactPhone(row: Row, old: Row | null, conn: Tx) {
  const pn = row.phone_normalized
  if (pn === null || pn === undefined || pn === '') return
  if (old && !distinct(old.phone_normalized, pn) && !distinct(old.account_id, row.account_id)) return
  if (
    await conflictExists(
      conn,
      'SELECT id FROM contacts WHERE account_id = ? AND phone_normalized = ? AND id <> ?',
      [row.account_id, pn, row.id ?? '']
    )
  ) {
    throw uniqueViolation(
      'idx_contacts_account_phone_normalized',
      `Key (account_id, phone_normalized)=(${row.account_id}, ${pn}) already exists.`
    )
  }
}

/** idx_one_active_run_per_contact: UNIQUE (account_id, contact_id) WHERE status = 'active' */
async function checkActiveRun(row: Row, old: Row | null, conn: Tx) {
  const status = row.status === undefined ? 'active' : row.status
  if (status !== 'active' || !row.contact_id) return
  if (old && old.status === 'active' && !distinct(old.contact_id, row.contact_id) && !distinct(old.account_id, row.account_id))
    return
  if (
    await conflictExists(
      conn,
      "SELECT id FROM flow_runs WHERE account_id = ? AND contact_id = ? AND status = 'active' AND id <> ?",
      [row.account_id, row.contact_id, row.id ?? '']
    )
  ) {
    throw uniqueViolation(
      'idx_one_active_run_per_contact',
      `Key (account_id, contact_id)=(${row.account_id}, ${row.contact_id}) already exists.`
    )
  }
}

/** idx_message_reactions_one_agent_reaction: UNIQUE (message_id) WHERE actor_type = 'agent' */
async function checkAgentReaction(row: Row, old: Row | null, conn: Tx) {
  if (row.actor_type !== 'agent') return
  if (old && old.actor_type === 'agent' && !distinct(old.message_id, row.message_id)) return
  // A row with the same (message_id, actor_type, actor_id) is the full UNIQUE key's business
  // (it is the upsert target); only a *different* agent row is a partial-index conflict.
  if (
    await conflictExists(
      conn,
      "SELECT id FROM message_reactions WHERE message_id = ? AND actor_type = 'agent' AND id <> ? AND NOT (actor_id <=> ?)",
      [row.message_id, row.id ?? '', row.actor_id ?? null]
    )
  ) {
    throw uniqueViolation('idx_message_reactions_one_agent_reaction', `Key (message_id)=(${row.message_id}) already exists.`)
  }
}

// ── registry ────────────────────────────────────────────────────────────────

function compose(...list: TableHooks[]): TableHooks {
  const out: TableHooks = {}
  const keys = ['beforeInsert', 'beforeUpdate', 'afterInsert', 'afterUpdate', 'afterDelete'] as const
  for (const k of keys) {
    const fns = list.map((h) => h[k]).filter(Boolean) as Array<(...a: any[]) => any>
    if (fns.length)
      (out as any)[k] = async (...args: any[]) => {
        for (const fn of fns) await fn(...args)
      }
  }
  return out
}

export const HOOKS: Record<string, TableHooks> = {
  auth_users: {
    afterInsert: (row, ctx) => bootstrapNewUser(ctx.conn, row),
  },
  accounts: compose(accountIdentity, stampUpdatedAt),
  ai_configs: stampUpdatedAt,
  ai_knowledge_documents: stampUpdatedAt,
  automations: stampUpdatedAt,
  broadcasts: stampUpdatedAt,
  broadcast_recipients: broadcastRecipientAggregate,
  companies: stampUpdatedAt,
  contacts: compose(stampUpdatedAt, {
    beforeInsert: (row, ctx) => checkContactPhone(row, null, ctx.conn),
    beforeUpdate: (row, old, ctx) => checkContactPhone(row, old, ctx.conn),
  }),
  conversations: compose(conversationClosedAt, conversationAssignee, stampUpdatedAt, conversationNotify),
  deals: compose(dealClosedAt, stampUpdatedAt),
  flows: stampUpdatedAt,
  flow_runs: {
    beforeInsert: (row, ctx) => checkActiveRun(row, null, ctx.conn),
    beforeUpdate: (row, old, ctx) => checkActiveRun(row, old, ctx.conn),
  },
  message_reactions: {
    beforeInsert: (row, ctx) => checkAgentReaction(row, null, ctx.conn),
    beforeUpdate: (row, old, ctx) => checkAgentReaction(row, old, ctx.conn),
  },
  message_templates: stampUpdatedAt,
  messages: messageTimes,
  profiles: compose(profilePrivilege, stampUpdatedAt),
  quick_replies: stampUpdatedAt,
  tasks: compose(stampUpdatedAt, taskCompletedAt),
  views: stampUpdatedAt,
  whatsapp_config: stampUpdatedAt,
}
