/* eslint-disable @typescript-eslint/no-explicit-any -- rows/args are dynamic PostgREST-shaped values */
import type { AccountRole, AuthCtx } from '../auth-ctx'
import { fromMysqlDatetime, toMysqlDatetime } from '../codec'
import { HookError } from '../hooks'
import { getPool, query, tx, type Executor, type Tx } from '../pool'

export interface RpcCtx {
  auth: AuthCtx
  /** when given, run inside this transaction; otherwise writers open their own tx() */
  conn?: Tx
}
export type RpcFn = (args: Record<string, any>, ctx: RpcCtx) => Promise<unknown>

/** RPC errors carry the Postgres SQLSTATE (`code`) the callers check. */
export const RpcError = HookError
export const rpcError = (message: string, code = 'P0001') => new HookError(message, code)

export function readEx(ctx: RpcCtx): Executor {
  return ctx.conn ?? getPool()
}

export function write<T>(ctx: RpcCtx, fn: (conn: Tx) => Promise<T>): Promise<T> {
  return tx(fn, ctx.conn)
}

export const ROLE_RANK: Record<AccountRole, number> = { owner: 4, admin: 3, agent: 2, viewer: 1 }
export const ROLES: readonly AccountRole[] = ['owner', 'admin', 'agent', 'viewer']

/** auth.uid() is NULL → 'Unauthorized' (42501), like the SECURITY DEFINER functions. */
export function requireUid(auth: AuthCtx): string {
  if (!auth.userId) throw rpcError('Unauthorized', '42501')
  return auth.userId
}

/**
 * is_account_member(target, min_role) evaluated live against profiles (as pg did).
 * Service role bypasses (trusted server code; pg would have used the service key, which
 * skipped RLS, or the function is only reachable from service code).
 */
export async function isAccountMember(
  ex: Executor,
  auth: AuthCtx,
  accountId: unknown,
  minRole: AccountRole = 'viewer'
): Promise<boolean> {
  if (auth.role === 'service') return true
  return isMemberStrict(ex, auth.userId, accountId, minRole)
}

/** Exact is_account_member semantics: auth.uid() only, no service bypass. */
export async function isMemberStrict(
  ex: Executor,
  userId: string | null | undefined,
  accountId: unknown,
  minRole: AccountRole = 'viewer'
): Promise<boolean> {
  if (!userId || !accountId) return false
  const rows = await query<{ account_role: AccountRole }>(
    'SELECT account_role FROM profiles WHERE user_id = ? AND account_id = ? LIMIT 1',
    [userId, accountId],
    ex
  )
  const r = rows[0]?.account_role
  return !!r && ROLE_RANK[r] >= ROLE_RANK[minRole]
}

/** Accounts whose rows an invoker-rights (non SECURITY DEFINER) function may read; null = all. */
export function readableAccounts(auth: AuthCtx): string[] | null {
  if (auth.role === 'service') return null
  return Object.keys(auth.memberships ?? {})
}

/** DATETIME string → ISO "…+00:00" (same as codec / PostgREST). */
export const iso = (v: unknown): string | null => fromMysqlDatetime(v)
/** any timestamp-ish → MySQL DATETIME(6) UTC string */
export const dbTime = (v: unknown): string | null => toMysqlDatetime(v)

/** timestamp-ish → epoch milliseconds (fractional, keeps microseconds). null → null. */
export function msOf(v: unknown): number | null {
  const s = toMysqlDatetime(v)
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(s)
  if (!m) return null
  const frac = m[7] ? Number('0.' + m[7]) * 1000 : 0
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + frac
}

/** epoch ms (fractional) → 'YYYY-MM-DD HH:MM:SS.ffffff' */
export function dbFromMs(ms: number): string {
  const whole = Math.floor(ms)
  const d = new Date(whole)
  const micros = Math.round((ms - whole) * 1000) + d.getUTCMilliseconds() * 1000
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(Math.min(micros, 999999), 6)}`
  )
}

export function parseJson(v: unknown): any {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v)
    } catch {
      return v
    }
  }
  if (Buffer.isBuffer(v)) {
    try {
      return JSON.parse(v.toString('utf8'))
    } catch {
      return null
    }
  }
  return v
}

/** jsonb argument: accept JS values or a JSON string (args from a JSON body may be either). */
export function jsonArg(v: unknown): any {
  if (typeof v === 'string') {
    const t = v.trim()
    if (t.startsWith('[') || t.startsWith('{')) {
      try {
        return JSON.parse(t)
      } catch {
        return v
      }
    }
  }
  return v
}

/** uuid[] / text[] argument: JS array, JSON array string, or pg literal '{a,b}'. null → null. */
export function arrayArg(v: unknown): string[] | null {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) return v.map((x) => String(x))
  if (typeof v === 'string') {
    const t = v.trim()
    if (t.startsWith('[')) return (JSON.parse(t) as unknown[]).map((x) => String(x))
    if (t.startsWith('{') && t.endsWith('}'))
      return t
        .slice(1, -1)
        .split(',')
        .map((x) => x.trim().replace(/^"|"$/g, ''))
        .filter((x) => x !== '')
  }
  throw rpcError(`malformed array literal: "${String(v)}"`, '22P02')
}

/** integer argument (PostgREST casts "7" → 7). null/undefined → null. */
export function intArg(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw rpcError(`invalid input syntax for type integer: "${String(v)}"`, '22P02')
  return n
}

export function num(v: unknown): number {
  if (v === null || v === undefined) return 0
  return typeof v === 'number' ? v : Number(v)
}

export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  return typeof v === 'number' ? v : Number(v)
}

export function bool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || (Buffer.isBuffer(v) && v[0] === 1)
}

/** pg left(text, n): first n characters (code points). */
export function leftChars(s: unknown, n: number): string | null {
  if (s === null || s === undefined) return null
  const str = String(s)
  if (str.length <= n) return str
  return Array.from(str).slice(0, n).join('')
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
