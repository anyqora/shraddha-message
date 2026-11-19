/**
 * Row-level access rules, replacing Postgres RLS.
 *
 * This is a 1:1 translation of every policy in docs/mysql-port/pg-schema/triggers_policies.sql
 * (all 125 are PERMISSIVE; none are RESTRICTIVE). See docs/mysql-port/policies-notes.md for the
 * table-by-table summary.
 *
 * ── How the SQL builder must use this module ────────────────────────────────────────────────
 *  - `ctx.role === 'service'` bypasses everything. The builder skips policies for service, and
 *    `policyFor()` also returns allow for service as a safety net.
 *  - SELECT: AND the `select(ctx, alias)` predicate into the WHERE clause. Rows that fail are
 *    silently invisible, as in Postgres.
 *  - INSERT: call `insert(ctx, row)` for every row, after defaults and BEFORE-INSERT hooks are
 *    applied (Postgres evaluates WITH CHECK after BEFORE triggers). If it returns false, abort the
 *    whole statement with code `42501` and the message
 *    `new row violates row-level security policy for table "<table>"`.
 *  - UPDATE: AND `update.using(ctx, alias)` into the WHERE clause (failing rows are silently
 *    skipped). Then, for each row that matched and after BEFORE-UPDATE hooks, call
 *    `update.check(ctx, newRow, oldRow)`. `oldRow` must be a row that matched `using`, and
 *    `newRow` may be the patch or the full row (it is merged over oldRow). If check returns false,
 *    abort with `42501`.
 *  - DELETE: AND `delete(ctx, alias)` into the WHERE clause.
 *  - `.insert().select()` / `.update().select()` (RETURNING): Postgres also requires the returned
 *    rows to pass the SELECT policy, and raises 42501 for an INSERT whose new row is not visible.
 *    In this schema every insert/update policy implies the select policy, so the extra check never
 *    changes the outcome. It is still the correct thing to do for future policies.
 *  - UPSERT (`ON CONFLICT DO UPDATE`): the insert check applies to the proposed row, and the
 *    update using + check apply to the conflicting row.
 *  - Postgres also applies a table's SELECT policy to existing rows of an UPDATE/DELETE that has
 *    a WHERE clause. In this schema each UPDATE/DELETE predicate already implies the SELECT one,
 *    so that is not repeated here.
 *  - `false` (boolean) means deny/no rows. `toPredicate()` turns any result into SQL (`1=0` / `1=1`).
 *
 * ── AuthCtx.memberships ─────────────────────────────────────────────────────────────────────
 *  is_account_member(target, min_role) = EXISTS(profiles p WHERE p.user_id = auth.uid() AND
 *  p.account_id = target AND rank(p.account_role) >= rank(min_role)), with owner 4 > admin 3 > agent 2
 *  > viewer 1. profiles.user_id is UNIQUE and profiles.account_id is NOT NULL, so a user has exactly
 *  one membership. The auth module must load it with MEMBERSHIP_SQL:
 *    memberships = { [row.account_id]: row.account_role }   (or {} when there is no profile row)
 *  and load it fresh per request, because is_account_member read profiles live.
 */
import type { AccountRole, AuthCtx } from './auth-ctx'
import { query, type Executor } from './pool'

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Public types (contract with the builder)
// ──────────────────────────────────────────────────────────────────────────────────────────────

/** SQL boolean fragment. Columns are referenced as `alias`.`col`; values only via `?`. */
export interface Predicate {
  sql: string
  params: unknown[]
}
/** true = all rows allowed, false = denied / no rows. */
export type PolicyResult = Predicate | boolean
export type Row = Record<string, unknown>

export type SelectPolicyFn = (ctx: AuthCtx, alias: string) => PolicyResult
/** WITH CHECK for a new row. `ex` lets lookups run on the caller's transaction connection. */
export type InsertPolicyFn = (ctx: AuthCtx, row: Row, ex?: Executor) => boolean | Promise<boolean>
export type UpdateCheckFn = (
  ctx: AuthCtx,
  newRow: Row,
  oldRow: Row,
  ex?: Executor
) => boolean | Promise<boolean>

export interface TablePolicy {
  select?: SelectPolicyFn
  insert?: InsertPolicyFn
  update?: { using: SelectPolicyFn; check?: UpdateCheckFn }
  delete?: SelectPolicyFn
}

export type PolicyOp = 'select' | 'insert' | 'update' | 'delete'

/** Loads AuthCtx.memberships: `{ [account_id]: account_role }` (zero or one row). */
export const MEMBERSHIP_SQL = 'SELECT account_id, account_role FROM profiles WHERE user_id = ?'

// ──────────────────────────────────────────────────────────────────────────────────────────────
// auth.uid() / is_account_member()
// ──────────────────────────────────────────────────────────────────────────────────────────────

export const ROLE_RANK: Record<AccountRole, number> = { viewer: 1, agent: 2, admin: 3, owner: 4 }

/** auth.uid(): the signed-in user's id, or null (anon / no session). Lowercased, like uuid text. */
export function authUid(ctx: AuthCtx): string | null {
  if (ctx.role !== 'authenticated' || !ctx.userId) return null
  return String(ctx.userId).toLowerCase()
}

const norm = (v: unknown): string | null => (v == null ? null : String(v).toLowerCase())

/** Account ids where the user's role is at least `minRole` (is_account_member's account set). */
export function memberAccountIds(ctx: AuthCtx, minRole: AccountRole = 'viewer'): string[] {
  if (!authUid(ctx)) return []
  const min = ROLE_RANK[minRole]
  return Object.entries(ctx.memberships ?? {})
    .filter(([, role]) => (ROLE_RANK[role] ?? 0) >= min)
    .map(([id]) => id.toLowerCase())
    .sort()
}

/** is_account_member(accountId, minRole), evaluated in JS (for WITH CHECK on rows). */
export function isAccountMember(
  ctx: AuthCtx,
  accountId: unknown,
  minRole: AccountRole = 'viewer'
): boolean {
  const id = norm(accountId)
  return id !== null && memberAccountIds(ctx, minRole).includes(id)
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// SQL helpers
// ──────────────────────────────────────────────────────────────────────────────────────────────

/** Quote an identifier with backticks. */
export function qi(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

/** `alias`.`col` */
export function col(alias: string, column: string): string {
  return `${qi(alias)}.${qi(column)}`
}

const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ')

/** `expr IN (?, ?, …)`, or false when the list is empty (one `?` per value: works with
 *  both client-side formatting and server-side prepared statements). */
export function inList(expr: string, values: unknown[]): PolicyResult {
  if (values.length === 0) return false
  return { sql: `${expr} IN (${marks(values.length)})`, params: [...values] }
}

/** `expr = ?`, or false when value is null (SQL `x = NULL` is never true). */
export function eqValue(expr: string, value: unknown): PolicyResult {
  if (value == null) return false
  return { sql: `${expr} = ?`, params: [value] }
}

/** OR of policies (permissive policies combine this way). */
export function or(...parts: PolicyResult[]): PolicyResult {
  const preds: Predicate[] = []
  for (const p of parts) {
    if (p === true) return true
    if (p !== false) preds.push(p)
  }
  if (preds.length === 0) return false
  if (preds.length === 1) return preds[0]
  return { sql: `(${preds.map((p) => `(${p.sql})`).join(' OR ')})`, params: preds.flatMap((p) => p.params) }
}

/** AND of predicates (restrictive policies would combine this way; also used within a policy). */
export function and(...parts: PolicyResult[]): PolicyResult {
  const preds: Predicate[] = []
  for (const p of parts) {
    if (p === false) return false
    if (p !== true) preds.push(p)
  }
  if (preds.length === 0) return true
  if (preds.length === 1) return preds[0]
  return { sql: `(${preds.map((p) => `(${p.sql})`).join(' AND ')})`, params: preds.flatMap((p) => p.params) }
}

/** Always returns a SQL fragment: true → `1=1`, false → `1=0`. */
export function toPredicate(r: PolicyResult): Predicate {
  if (r === true) return { sql: '1=1', params: [] }
  if (r === false) return { sql: '1=0', params: [] }
  return r
}

/** Async policy helper: resolves maybe-promises. */
async function resolve(v: boolean | Promise<boolean>): Promise<boolean> {
  return (await v) === true
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Policy factories for the two shapes used by almost every table
// ──────────────────────────────────────────────────────────────────────────────────────────────

interface AccountScopedSpec {
  /** account column; `id` for accounts itself. */
  column?: string
  select?: AccountRole
  insert?: AccountRole
  update?: AccountRole
  delete?: AccountRole
}

/**
 * Tables whose policies are `is_account_member(account_id[, min_role])` per command.
 * UPDATE policies here have no WITH CHECK, or one equal to USING, so Postgres uses USING as
 * the check: the new row must also be in an account where the user has `update` role (this
 * stops a row from being moved into another account).
 */
function accountScoped(spec: AccountScopedSpec): TablePolicy {
  const c = spec.column ?? 'account_id'
  const pred = (min: AccountRole): SelectPolicyFn => (ctx, alias) =>
    inList(col(alias, c), memberAccountIds(ctx, min))
  const p: TablePolicy = {}
  if (spec.select) p.select = pred(spec.select)
  if (spec.insert) {
    const min = spec.insert
    p.insert = (ctx, row) => isAccountMember(ctx, row[c], min)
  }
  if (spec.update) {
    const min = spec.update
    p.update = {
      using: pred(min),
      check: (ctx, newRow, oldRow) => isAccountMember(ctx, { ...oldRow, ...newRow }[c], min),
    }
  }
  if (spec.delete) p.delete = pred(spec.delete)
  return p
}

interface ParentScopedSpec {
  /** FK column on this table that points at the parent. */
  fk: string
  /** FROM clause of the policy's EXISTS subquery (parent table(s) with `__rls_*` aliases). */
  from: string
  /** Parent key expression compared with the FK. */
  key: string
  /** Parent account_id expression passed to is_account_member. */
  account: string
  /** Min role of the `<t>_select` policy. */
  selectMin: AccountRole
  /** Min role of the `<t>_modify` [ALL] policy (null when the table has no ALL policy). */
  modifyMin: AccountRole | null
}

/**
 * Child tables whose policies are `EXISTS (SELECT 1 FROM parent WHERE parent.id = child.fk AND
 * is_account_member(parent.account_id[, role]))`: a `<t>_modify` [ALL] policy (USING = CHECK)
 * plus a `<t>_select` [SELECT] policy.
 *
 * SELECT = ALL.using OR SELECT.using. Both are the same subquery with different min roles, and
 * modifyMin >= selectMin, so the OR is just the selectMin subquery.
 */
function parentScoped(spec: ParentScopedSpec): TablePolicy {
  const via = (ctx: AuthCtx, fkExpr: string, min: AccountRole): PolicyResult => {
    const ids = memberAccountIds(ctx, min)
    if (ids.length === 0) return false
    return {
      sql: `EXISTS (SELECT 1 FROM ${spec.from} WHERE ${spec.key} = ${fkExpr} AND ${spec.account} IN (${marks(ids.length)}))`,
      params: ids,
    }
  }
  const lookup = async (ctx: AuthCtx, fkValue: unknown, min: AccountRole, ex?: Executor) => {
    if (fkValue == null) return false
    const ids = memberAccountIds(ctx, min)
    if (ids.length === 0) return false
    const rows = await query(
      `SELECT 1 AS ok FROM ${spec.from} WHERE ${spec.key} = ? AND ${spec.account} IN (${marks(ids.length)}) LIMIT 1`,
      [fkValue, ...ids],
      ex
    )
    return rows.length > 0
  }

  const p: TablePolicy = {
    select: (ctx, alias) => via(ctx, col(alias, spec.fk), spec.selectMin),
  }
  const min = spec.modifyMin
  if (min) {
    p.insert = (ctx, row, ex) => lookup(ctx, row[spec.fk], min, ex)
    p.update = {
      using: (ctx, alias) => via(ctx, col(alias, spec.fk), min),
      check: (ctx, newRow, oldRow, ex) => {
        const merged = { ...oldRow, ...newRow }
        // CHECK = USING here. If the FK did not change, the same expression on the same parent row
        // was already true for oldRow (it matched `using` in this statement), so skip the query.
        if (norm(merged[spec.fk]) !== null && norm(merged[spec.fk]) === norm(oldRow[spec.fk])) return true
        return lookup(ctx, merged[spec.fk], min, ex)
      },
    }
    p.delete = (ctx, alias) => via(ctx, col(alias, spec.fk), min)
  }
  return p
}

const parent = (table: string, a = `__rls_${table}`) => ({
  from: `${qi(table)} ${qi(a)}`,
  key: col(a, 'id'),
  account: col(a, 'account_id'),
})

// ──────────────────────────────────────────────────────────────────────────────────────────────
// storage.objects
// ──────────────────────────────────────────────────────────────────────────────────────────────

/** (storage.foldername(name))[1] in JS: first path segment, or null when there is no folder. */
export function firstFolder(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const parts = name.split('/')
  return parts.length >= 2 ? parts[0] : null
}

/**
 * `(storage.foldername(name))[1] IN (...)` in SQL. foldername() drops the last path segment, so
 * a name without '/' has no folder and [1] is NULL. SUBSTRING_INDEX alone would return the whole
 * name, so the LOCATE guard is required.
 */
function folderIn(alias: string, values: string[]): PolicyResult {
  if (values.length === 0) return false
  const n = col(alias, 'name')
  return {
    sql: `(LOCATE('/', ${n}) > 0 AND SUBSTRING_INDEX(${n}, '/', 1) IN (${marks(values.length)}))`,
    params: values,
  }
}

const bucketIs = (alias: string, bucket: string): Predicate => ({
  sql: `${col(alias, 'bucket_id')} = ?`,
  params: [bucket],
})

const AGENT_PLUS: AccountRole = 'agent' // ARRAY['owner','admin','agent'] == rank >= agent

/** 'account-' || p.account_id for the user's profiles with at least `min` role. */
const accountFolders = (ctx: AuthCtx, min: AccountRole) =>
  memberAccountIds(ctx, min).map((id) => `account-${id}`)

/**
 * Folders the policy family allows for a write (INSERT/UPDATE/DELETE) per bucket:
 *  - chat-media: EXISTS(profile agent+ AND 'account-'||account_id = folder)
 *  - flow-media: EXISTS(profile agent+ AND ('account-'||account_id = folder OR uid = folder)).
 *                The uid branch is inside the EXISTS, so it needs an agent+ profile too.
 *  - avatars:    uid = folder (no profile needed)
 */
function writeFolders(ctx: AuthCtx, bucket: string): string[] {
  const uid = authUid(ctx)
  if (!uid) return []
  switch (bucket) {
    case 'chat-media':
      return accountFolders(ctx, AGENT_PLUS)
    case 'flow-media': {
      const f = accountFolders(ctx, AGENT_PLUS)
      return f.length ? [...f, uid] : []
    }
    case 'avatars':
      return [uid]
    default:
      return []
  }
}

/**
 * Folders readable per bucket (SELECT policies are roles={authenticated}):
 *  - chat-media: EXISTS(profile AND 'account-'||account_id = folder)   (any role)
 *  - flow-media: EXISTS(profile AND 'account-'||account_id = folder) OR uid = folder
 *                (the uid branch is outside the EXISTS here)
 *  - avatars:    uid = folder
 */
function readFolders(ctx: AuthCtx, bucket: string): string[] {
  const uid = authUid(ctx)
  if (!uid) return []
  switch (bucket) {
    case 'chat-media':
      return accountFolders(ctx, 'viewer')
    case 'flow-media':
      return [...accountFolders(ctx, 'viewer'), uid]
    case 'avatars':
      return [uid]
    default:
      return []
  }
}

const STORAGE_BUCKETS = ['avatars', 'chat-media', 'flow-media'] as const

function storagePredicate(ctx: AuthCtx, alias: string, folders: (c: AuthCtx, b: string) => string[]) {
  return or(...STORAGE_BUCKETS.map((b) => and(bucketIs(alias, b), folderIn(alias, folders(ctx, b)))))
}

function storageRowAllowed(ctx: AuthCtx, row: Row): boolean {
  const bucket = typeof row.bucket_id === 'string' ? row.bucket_id : null
  const folder = firstFolder(row.name)
  if (!bucket || folder === null) return false
  // text = text is case-sensitive in Postgres; the generated folders are lowercase like uuid::text.
  return writeFolders(ctx, bucket).includes(folder)
}

const storageObjects: TablePolicy = {
  // "Members can read chat media" / "Members can read flow media" / "Users can read their own avatar"
  // roles={authenticated}: anon is denied (and has no uid anyway).
  select: (ctx, alias) =>
    ctx.role === 'authenticated' ? storagePredicate(ctx, alias, readFolders) : false,
  // "Members can upload chat media" / "... flow media" / "Users can upload their own avatar"
  insert: (ctx, row) => storageRowAllowed(ctx, row),
  // "Members can update chat media" / "... flow media" (USING = CHECK) / "Users can update their own
  // avatar" (no CHECK, so CHECK = USING).
  update: {
    using: (ctx, alias) => storagePredicate(ctx, alias, writeFolders),
    check: (ctx, newRow, oldRow) => storageRowAllowed(ctx, { ...oldRow, ...newRow }),
  },
  // "Members can delete chat media" / "... flow media" / "Users can delete their own avatar"
  delete: (ctx, alias) => storagePredicate(ctx, alias, writeFolders),
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// Tables without RLS in Postgres
// ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Tables that had RLS disabled. Postgres would fall back to GRANTs, and we do not have them.
 *  - auth_users, auth_sessions, auth_one_time_tokens: the auth schema was never exposed through
 *    PostgREST and holds password hashes and tokens. Denied to everyone except service
 *    (src/lib/db/auth.ts uses the service ctx).
 *  - schema_migrations, storage_buckets: read allowed for authenticated, writes denied.
 *    Supabase's default grants would have allowed writes too. That is deliberately not reproduced.
 */
export const NO_RLS_TABLES = [
  'auth_users',
  'auth_sessions',
  'auth_one_time_tokens',
  'schema_migrations',
  'storage_buckets',
] as const

const authenticatedReadOnly: TablePolicy = {
  select: (ctx) => ctx.role === 'authenticated' && authUid(ctx) !== null,
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// POLICIES
// ──────────────────────────────────────────────────────────────────────────────────────────────

const V: AccountRole = 'viewer'
const AG: AccountRole = 'agent'
const AD: AccountRole = 'admin'

/** account_id scoped: select by any member, every write needs at least `role`. */
const scoped = (role: AccountRole) =>
  accountScoped({ select: V, insert: role, update: role, delete: role })

/**
 * Keyed by MySQL table name. If an RLS table has no entry for a command, that command is DENIED.
 * Every policy is roles={public} unless noted. anon has no auth.uid(), so every policy is false
 * for anon.
 */
export const POLICIES: Record<string, TablePolicy> = {
  // account_invitations_modify [ALL] admin + account_invitations_select [SELECT] admin
  account_invitations: accountScoped({ select: AD, insert: AD, update: AD, delete: AD }),

  // accounts_select [SELECT] is_account_member(id); accounts_update [UPDATE] admin on id (USING = CHECK).
  // No INSERT/DELETE policy: accounts are created by signup (service) and never deleted by users.
  accounts: accountScoped({ column: 'id', select: V, update: AD }),

  // *_select member; *_insert / *_update / *_delete admin
  ai_configs: scoped(AD),
  ai_knowledge_chunks: scoped(AD),
  ai_knowledge_documents: scoped(AD),
  api_keys: scoped(AD),
  custom_fields: scoped(AD),
  message_templates: scoped(AD),
  pipelines: scoped(AD),
  tags: scoped(AD),
  webhook_endpoints: scoped(AD),
  whatsapp_config: scoped(AD),

  // ai_usage_log_select [SELECT] admin only. Rows are written by service code.
  ai_usage_log: accountScoped({ select: AD }),

  // select-only tables (written by service code: engines, RPCs)
  automation_logs: accountScoped({ select: V }),
  flow_runs: accountScoped({ select: V }),
  member_presence: accountScoped({ select: V }), // writes go through the touch_presence RPC

  // RLS enabled, no policies at all → denied to every non-service caller
  automation_pending_executions: {},
  pending_message_statuses: {},

  // *_select member; *_insert / *_update / *_delete agent
  automations: scoped(AG),
  broadcasts: scoped(AG),
  companies: scoped(AG),
  contact_notes: scoped(AG),
  contacts: scoped(AG),
  conversations: scoped(AG),
  deals: scoped(AG),
  flows: scoped(AG),
  quick_replies: scoped(AG),
  tasks: scoped(AG),
  views: scoped(AG),

  // <t>_modify [ALL] EXISTS(parent, agent) + <t>_select [SELECT] EXISTS(parent, member)
  automation_steps: parentScoped({ fk: 'automation_id', ...parent('automations'), selectMin: V, modifyMin: AG }),
  broadcast_recipients: parentScoped({ fk: 'broadcast_id', ...parent('broadcasts'), selectMin: V, modifyMin: AG }),
  contact_custom_values: parentScoped({ fk: 'contact_id', ...parent('contacts'), selectMin: V, modifyMin: AG }),
  contact_tags: parentScoped({ fk: 'contact_id', ...parent('contacts'), selectMin: V, modifyMin: AG }),
  flow_nodes: parentScoped({ fk: 'flow_id', ...parent('flows'), selectMin: V, modifyMin: AG }),
  messages: parentScoped({ fk: 'conversation_id', ...parent('conversations'), selectMin: V, modifyMin: AG }),
  // pipeline_stages_modify [ALL] needs admin on the pipeline
  pipeline_stages: parentScoped({ fk: 'pipeline_id', ...parent('pipelines'), selectMin: V, modifyMin: AD }),
  // flow_run_events_select [SELECT] only
  flow_run_events: parentScoped({ fk: 'flow_run_id', ...parent('flow_runs'), selectMin: V, modifyMin: null }),
  // message_reactions: EXISTS(messages m JOIN conversations c ON c.id = m.conversation_id
  //                           WHERE m.id = message_reactions.message_id AND is_account_member(c.account_id[, agent]))
  message_reactions: parentScoped({
    fk: 'message_id',
    from: `${qi('messages')} ${qi('__rls_m')} JOIN ${qi('conversations')} ${qi('__rls_c')} ON ${col('__rls_c', 'id')} = ${col('__rls_m', 'conversation_id')}`,
    key: col('__rls_m', 'id'),
    account: col('__rls_c', 'account_id'),
    selectMin: V,
    modifyMin: AG,
  }),

  // notifications_select / notifications_update: auth.uid() = user_id (USING = CHECK). No INSERT/DELETE.
  notifications: {
    select: (ctx, alias) => eqValue(col(alias, 'user_id'), authUid(ctx)),
    update: {
      using: (ctx, alias) => eqValue(col(alias, 'user_id'), authUid(ctx)),
      check: (ctx, newRow, oldRow) => {
        const uid = authUid(ctx)
        return uid !== null && norm({ ...oldRow, ...newRow }.user_id) === uid
      },
    },
  },

  // profiles_select: auth.uid() = user_id OR is_account_member(account_id)
  // profiles_update: auth.uid() = user_id (USING = CHECK). No INSERT/DELETE (signup creates profiles).
  // The enforce_profile_privilege_columns trigger (hooks.ts) also blocks authenticated changes to
  // account_id / account_role and any direct insert.
  profiles: {
    select: (ctx, alias) =>
      or(eqValue(col(alias, 'user_id'), authUid(ctx)), inList(col(alias, 'account_id'), memberAccountIds(ctx, V))),
    update: {
      using: (ctx, alias) => eqValue(col(alias, 'user_id'), authUid(ctx)),
      check: (ctx, newRow, oldRow) => {
        const uid = authUid(ctx)
        return uid !== null && norm({ ...oldRow, ...newRow }.user_id) === uid
      },
    },
  },

  storage_objects: storageObjects,

  // RLS disabled in Postgres (see NO_RLS_TABLES)
  auth_users: {},
  auth_sessions: {},
  auth_one_time_tokens: {},
  schema_migrations: authenticatedReadOnly,
  storage_buckets: authenticatedReadOnly,
}

// ──────────────────────────────────────────────────────────────────────────────────────────────
// policyFor
// ──────────────────────────────────────────────────────────────────────────────────────────────

export interface UpdatePolicyFns {
  using: SelectPolicyFn
  check: (ctx: AuthCtx, newRow: Row, oldRow: Row, ex?: Executor) => Promise<boolean>
}

const DENY_SELECT: SelectPolicyFn = () => false

/**
 * Get the effective policy function for `table` and `op`. It is always defined (deny when there is
 * no policy):
 *  - `ctx.role === 'service'` → always allow (true). The builder normally bypasses policies for
 *    the service role before calling this; this is only a safety net.
 *  - unknown table → deny (tables added to MySQL later must be added to POLICIES explicitly).
 *  - table present but no policy for `op` → deny (the RLS default).
 *
 * select/delete → (ctx, alias) => PolicyResult
 * insert        → (ctx, row, ex?) => Promise<boolean>
 * update        → { using: (ctx, alias) => PolicyResult, check: (ctx, newRow, oldRow, ex?) => Promise<boolean> }
 */
export function policyFor(table: string, op: 'select' | 'delete'): SelectPolicyFn
export function policyFor(table: string, op: 'insert'): (ctx: AuthCtx, row: Row, ex?: Executor) => Promise<boolean>
export function policyFor(table: string, op: 'update'): UpdatePolicyFns
export function policyFor(
  table: string,
  op: PolicyOp
): SelectPolicyFn | UpdatePolicyFns | ((ctx: AuthCtx, row: Row, ex?: Executor) => Promise<boolean>) {
  const tp: TablePolicy | undefined = Object.prototype.hasOwnProperty.call(POLICIES, table)
    ? POLICIES[table]
    : undefined

  switch (op) {
    case 'select':
    case 'delete': {
      const fn = tp?.[op] ?? DENY_SELECT
      const wrapped: SelectPolicyFn = (ctx, alias) => (ctx.role === 'service' ? true : fn(ctx, alias))
      return wrapped
    }
    case 'insert': {
      const fn = tp?.insert
      return async (ctx: AuthCtx, row: Row, ex?: Executor): Promise<boolean> => {
        if (ctx.role === 'service') return true
        return fn ? resolve(fn(ctx, row, ex)) : false
      }
    }
    case 'update': {
      const up = tp?.update
      const using = up?.using ?? DENY_SELECT
      // Every update policy in POLICIES defines `check`. A missing one would mean "no WITH CHECK",
      // which Postgres never has (it falls back to USING), so deny to be safe.
      const check = up?.check
      return {
        using: (ctx, alias) => (ctx.role === 'service' ? true : using(ctx, alias)),
        check: async (ctx, newRow, oldRow, ex) => {
          if (ctx.role === 'service') return true
          return check ? resolve(check(ctx, newRow, oldRow, ex)) : false
        },
      }
    }
    default:
      throw new Error(`policyFor: unknown op ${String(op)}`)
  }
}

/** Has RLS-equivalent rules (every key of POLICIES). */
export function hasPolicyTable(table: string): boolean {
  return Object.prototype.hasOwnProperty.call(POLICIES, table)
}
