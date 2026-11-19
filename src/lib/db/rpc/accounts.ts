/* eslint-disable @typescript-eslint/no-explicit-any -- rows/args are dynamic PostgREST-shaped values */
/**
 * Account / membership RPCs (all SECURITY DEFINER in pg; caller identity = ctx.auth.userId).
 * Raw SQL here deliberately skips the profiles/accounts hooks: in pg these functions ran as
 * the definer, so enforce_profile_privilege_columns / enforce_account_identity_columns let
 * them through. updated_at is stamped explicitly (and by ON UPDATE CURRENT_TIMESTAMP).
 */
import type { AccountRole } from '../auth-ctx'
import { emitRowChange } from '../hooks'
import { query, uuid, type Tx } from '../pool'
import { iso, isMemberStrict, readEx, requireUid, ROLES, rpcError, write, type RpcFn } from './util'

/** is_account_member(target_account_id, min_role = 'viewer') → boolean (auth.uid() based, no bypass). */
export const is_account_member: RpcFn = async (args, ctx) => {
  const minRole = (args.min_role ?? 'viewer') as AccountRole
  if (!ROLES.includes(minRole)) throw rpcError(`invalid input value for enum account_role_enum: "${minRole}"`, '22P02')
  return isMemberStrict(readEx(ctx), ctx.auth.userId, args.target_account_id, minRole)
}

/** peek_invitation(p_token_hash) → json {ok, reason} | {ok, account_name, role, expires_at}. Callable by anon. */
export const peek_invitation: RpcFn = async (args, ctx) => {
  const ex = readEx(ctx)
  const [inv] = await query<Record<string, any>>(
    `SELECT i.account_id, i.role, i.expires_at, i.accepted_at, (i.expires_at <= CURRENT_TIMESTAMP(6)) AS expired, a.name AS account_name
     FROM account_invitations i LEFT JOIN accounts a ON a.id = i.account_id
     WHERE i.token_hash = ?`,
    [args.p_token_hash],
    ex
  )
  if (!inv) return { ok: false, reason: 'not_found' }
  if (inv.accepted_at !== null && inv.accepted_at !== undefined) return { ok: false, reason: 'used' }
  if (Number(inv.expired) === 1) return { ok: false, reason: 'expired' }
  return { ok: true, account_name: inv.account_name ?? null, role: inv.role, expires_at: iso(inv.expires_at) }
}

const OLD_ACCOUNT_DATA_TABLES = [
  'contacts',
  'conversations',
  'broadcasts',
  'automations',
  'automation_logs',
  'automation_pending_executions',
  'flows',
  'flow_runs',
  'pipelines',
  'deals',
  'message_templates',
  'tags',
  'custom_fields',
  'contact_notes',
  'whatsapp_config',
  'api_keys',
  'webhook_endpoints',
  'quick_replies',
  'notifications',
  'ai_configs',
  'ai_knowledge_documents',
  'ai_knowledge_chunks',
  'ai_usage_log',
  'companies',
  'tasks',
  'views',
] as const

/** redeem_invitation(p_token_hash) → uuid (the joined account id). Raises 42501 / 22023 / 23505. */
export const redeem_invitation: RpcFn = (args, ctx) =>
  write(ctx, async (conn) => {
    const caller = requireUid(ctx.auth)
    const [inv] = await query<Record<string, any>>(
      `SELECT id, account_id, role, accepted_at, (expires_at <= CURRENT_TIMESTAMP(6)) AS expired
       FROM account_invitations WHERE token_hash = ? FOR UPDATE`,
      [args.p_token_hash],
      conn
    )
    if (!inv) throw rpcError('Invitation not found', '22023')
    if (inv.accepted_at !== null && inv.accepted_at !== undefined) throw rpcError('Invitation has already been redeemed', '22023')
    if (Number(inv.expired) === 1) throw rpcError('Invitation has expired', '22023')

    const [me] = await query<{ account_id: string; owner_user_id: string }>(
      `SELECT p.account_id, a.owner_user_id FROM profiles p JOIN accounts a ON a.id = p.account_id
       WHERE p.user_id = ? FOR UPDATE`,
      [caller],
      conn
    )
    if (!me?.account_id) throw rpcError('Caller has no profile', '42501')
    const oldAccount = me.account_id
    if (oldAccount === inv.account_id) throw rpcError('You are already a member of this account', '23505')
    if (me.owner_user_id !== caller) {
      throw rpcError('You are already in a shared account; sign up with a different email to join this one', '23505')
    }
    const others = await query('SELECT 1 AS x FROM profiles WHERE account_id = ? AND user_id <> ? LIMIT 1', [oldAccount, caller], conn)
    if (others.length) {
      throw rpcError(
        'Your account has other members; remove them or transfer ownership before joining another account',
        '23505'
      )
    }
    const union = OLD_ACCOUNT_DATA_TABLES.map((t) => `SELECT 1 AS x FROM \`${t}\` WHERE account_id = ?`).join(' UNION ALL ')
    const data = await query(`SELECT 1 AS x FROM (${union}) d LIMIT 1`, OLD_ACCOUNT_DATA_TABLES.map(() => oldAccount), conn)
    if (data.length) {
      throw rpcError('Your account already contains data; sign up with a different email to join this one', '23505')
    }

    await conn.query('UPDATE profiles SET account_id = ?, account_role = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE user_id = ?', [
      inv.account_id,
      inv.role,
      caller,
    ])
    await conn.query(
      'UPDATE account_invitations SET accepted_at = CURRENT_TIMESTAMP(6), accepted_by_user_id = ? WHERE id = ?',
      [caller, inv.id]
    )
    // member_presence (and anything else still keyed to the empty old account) cascades
    await conn.query('DELETE FROM accounts WHERE id = ?', [oldAccount])
    return inv.account_id as string
  })

/** Lock both profile rows in user_id order (same as `PERFORM … ORDER BY user_id FOR UPDATE`). */
async function lockProfiles(conn: Tx, a: string, b: unknown) {
  await query('SELECT id FROM profiles WHERE user_id IN (?, ?) ORDER BY user_id FOR UPDATE', [a, b], conn)
}

async function callerAdmin(conn: Tx, caller: string, roles: AccountRole[], roleMessage: string) {
  const [me] = await query<{ account_id: string; account_role: AccountRole }>(
    'SELECT account_id, account_role FROM profiles WHERE user_id = ?',
    [caller],
    conn
  )
  if (!me?.account_id) throw rpcError('Caller has no account', '42501')
  if (!roles.includes(me.account_role)) throw rpcError(roleMessage, '42501')
  return me
}

async function targetProfile(conn: Tx, userId: unknown) {
  const [t] = await query<{ account_id: string; account_role: AccountRole; full_name: string | null; email: string | null }>(
    'SELECT account_id, account_role, full_name, email FROM profiles WHERE user_id = ?',
    [userId],
    conn
  )
  if (!t?.account_id) throw rpcError('Target user not found', '22023')
  return t
}

/** remove_account_member(p_user_id) → uuid (the removed user's new personal account). */
export const remove_account_member: RpcFn = (args, ctx) =>
  write(ctx, async (conn) => {
    const caller = requireUid(ctx.auth)
    const target = args.p_user_id
    await lockProfiles(conn, caller, target)
    const me = await callerAdmin(conn, caller, ['owner', 'admin'], 'This action requires the admin role or higher')
    if (target === caller) {
      throw rpcError('Cannot remove yourself; transfer ownership or leave the account instead', '22023')
    }
    const t = await targetProfile(conn, target)
    if (t.account_id !== me.account_id) throw rpcError('Target user is not a member of your account', '42501')
    if (t.account_role === 'owner') throw rpcError('Cannot remove the account owner; transfer ownership first', '22023')

    const newAccount = uuid()
    await conn.query('INSERT INTO accounts (id, name, owner_user_id) VALUES (?, ?, ?)', [
      newAccount,
      t.full_name ? t.full_name : (t.email ?? 'My account'),
      target,
    ])
    await conn.query(
      "UPDATE profiles SET account_id = ?, account_role = 'owner', updated_at = CURRENT_TIMESTAMP(6) WHERE user_id = ?",
      [newAccount, target]
    )
    const convs = await query<{ id: string }>(
      'SELECT id FROM conversations WHERE account_id = ? AND assigned_agent_id = ? FOR UPDATE',
      [t.account_id, target],
      conn
    )
    if (convs.length) {
      await conn.query(
        'UPDATE conversations SET assigned_agent_id = NULL, updated_at = CURRENT_TIMESTAMP(6) WHERE account_id = ? AND assigned_agent_id = ?',
        [t.account_id, target]
      )
      for (const c of convs) await emitRowChange(conn, 'conversations', 'UPDATE', { id: c.id })
    }
    return newAccount
  })

/** set_member_role(p_user_id, p_new_role) → void */
export const set_member_role: RpcFn = async (args, ctx) => {
  const newRole = args.p_new_role as AccountRole
  if (!ROLES.includes(newRole)) throw rpcError(`invalid input value for enum account_role_enum: "${String(newRole)}"`, '22P02')
  await write(ctx, async (conn) => {
    const caller = requireUid(ctx.auth)
    const target = args.p_user_id
    await lockProfiles(conn, caller, target)
    const me = await callerAdmin(conn, caller, ['owner', 'admin'], 'This action requires the admin role or higher')
    if (target === caller) throw rpcError('Cannot change your own role', '22023')
    const t = await targetProfile(conn, target)
    if (t.account_id !== me.account_id) throw rpcError('Target user is not a member of your account', '42501')
    if (t.account_role === 'owner') throw rpcError('Use transfer_account_ownership to demote an owner', '22023')
    if (newRole === 'owner') throw rpcError('Use transfer_account_ownership to promote to owner', '22023')
    await conn.query('UPDATE profiles SET account_role = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE user_id = ?', [newRole, target])
  })
  return null
}

/** transfer_account_ownership(p_new_owner_user_id) → void */
export const transfer_account_ownership: RpcFn = async (args, ctx) => {
  await write(ctx, async (conn) => {
    const caller = requireUid(ctx.auth)
    const target = args.p_new_owner_user_id
    await lockProfiles(conn, caller, target)
    const me = await callerAdmin(conn, caller, ['owner'], 'Only the account owner can transfer ownership')
    if (target === caller) throw rpcError('You are already the owner', '22023')
    const t = await targetProfile(conn, target)
    if (t.account_id !== me.account_id) throw rpcError('Target user is not a member of your account', '42501')
    await conn.query("UPDATE profiles SET account_role = 'admin', updated_at = CURRENT_TIMESTAMP(6) WHERE user_id = ?", [caller])
    await conn.query("UPDATE profiles SET account_role = 'owner', updated_at = CURRENT_TIMESTAMP(6) WHERE user_id = ?", [target])
    await conn.query('UPDATE accounts SET owner_user_id = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [target, me.account_id])
  })
  return null
}

/** touch_presence(p_status = 'online') → void. Upserts member_presence and emits realtime. */
export const touch_presence: RpcFn = async (args, ctx) => {
  const status = args.p_status === undefined ? 'online' : args.p_status
  await write(ctx, async (conn) => {
    const caller = requireUid(ctx.auth)
    if (status !== 'online' && status !== 'away') throw rpcError(`Invalid presence status: ${String(status)}`, '22023')
    const [p] = await query<{ account_id: string }>('SELECT account_id FROM profiles WHERE user_id = ?', [caller], conn)
    if (!p?.account_id) throw rpcError('No account for caller', '22023')
    const [res]: any = await conn.query(
      `INSERT INTO member_presence (user_id, account_id, status, last_seen_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP(6))
       ON DUPLICATE KEY UPDATE status = VALUES(status), last_seen_at = CURRENT_TIMESTAMP(6), account_id = VALUES(account_id)`,
      [caller, p.account_id, status]
    )
    await emitRowChange(conn, 'member_presence', res?.affectedRows === 1 ? 'INSERT' : 'UPDATE', { user_id: caller })
  })
  return null
}
