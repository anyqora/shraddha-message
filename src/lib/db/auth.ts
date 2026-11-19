import 'server-only'
/**
 * Self-hosted auth on MySQL (replaces Supabase Auth / GoTrue).
 *
 * Compatible with the staging fork, so migrated users and sessions keep working:
 *   - password hash: scrypt$N$r$p$salt_b64$hash_b64 (64-byte key)
 *   - session cookie `aq_session` = random 32 bytes base64url; DB stores sha256(token) hex in auth_sessions.id
 *   - sessions live 30 days and slide when < 29 days remain
 *   - one-time tokens (signup / recovery / invite / email_change) stored hashed in auth_one_time_tokens
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { ANON_CTX, type AccountRole, type AuthCtx } from './auth-ctx'
import { fromMysqlDatetime, toMysqlDatetime } from './codec'
import { execute, query, uuid } from './pool'
import { MEMBERSHIP_SQL } from './policies'
import { sendAuthEmail, type AuthEmailKind } from './mailer'

export const SESSION_COOKIE = 'aq_session'
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000
const SESSION_SLIDE_MS = 29 * 24 * 3600 * 1000
const TOKEN_TTL_MS: Record<OneTimeKind, number> = {
  signup: 24 * 3600 * 1000,
  recovery: 3600 * 1000,
  invite: 7 * 24 * 3600 * 1000,
  email_change: 24 * 3600 * 1000,
}

export type OneTimeKind = 'signup' | 'recovery' | 'invite' | 'email_change'

export interface AuthError {
  message: string
  status: number
  code: string
  name: 'AuthError'
}

export function authError(message: string, status = 400, code = 'auth_error'): AuthError {
  return { message, status, code, name: 'AuthError' }
}

export interface AuthUser {
  id: string
  email: string | null
  user_metadata: Record<string, unknown>
  app_metadata: Record<string, unknown>
  email_confirmed_at: string | null
  last_sign_in_at: string | null
  created_at: string
  aud: 'authenticated'
  role: 'authenticated'
}

export interface AuthSession {
  user: AuthUser
  access_token: string
  token_type: 'bearer'
  expires_at: number
}

interface UserRow {
  id: string
  email: string | null
  encrypted_password: string | null
  email_confirmed_at: string | null
  raw_user_meta_data: unknown
  raw_app_meta_data: unknown
  last_sign_in_at: string | null
  banned_until: string | null
  created_at: string
}

const USER_COLS =
  'id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, last_sign_in_at, banned_until, created_at'

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')
const requireConfirmation = () => process.env.AUTH_REQUIRE_EMAIL_CONFIRMATION === 'true'

function parseJson(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object') return v as Record<string, unknown>
  if (typeof v === 'string') {
    try {
      return JSON.parse(v)
    } catch {
      return {}
    }
  }
  return {}
}

export function toAuthUser(r: UserRow): AuthUser {
  return {
    id: r.id,
    email: r.email,
    user_metadata: parseJson(r.raw_user_meta_data),
    app_metadata: { provider: 'email', ...parseJson(r.raw_app_meta_data) },
    email_confirmed_at: fromMysqlDatetime(r.email_confirmed_at)?.replace('+00:00', 'Z') ?? null,
    last_sign_in_at: fromMysqlDatetime(r.last_sign_in_at)?.replace('+00:00', 'Z') ?? null,
    created_at: fromMysqlDatetime(r.created_at)?.replace('+00:00', 'Z') ?? '',
    aud: 'authenticated',
    role: 'authenticated',
  }
}

// ── passwords ────────────────────────────────────────────────────────────────

function scrypt(pw: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  return new Promise((res, rej) =>
    scryptCb(pw, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k)))
  )
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(pw, salt, 16384, 8, 1)
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false
  const [alg, N, r, p, salt, hash] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !hash) return false
  const want = Buffer.from(hash, 'base64')
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), Number(N), Number(r), Number(p))
  return got.length === want.length && timingSafeEqual(got, want)
}

export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 6) return 'Password should be at least 6 characters.'
  if (pw.length > 256) return 'Password is too long.'
  return null
}

// ── users ────────────────────────────────────────────────────────────────────

async function userByEmail(email: string): Promise<UserRow | null> {
  const rows = await query<UserRow & Record<string, unknown>>(
    `SELECT ${USER_COLS} FROM auth_users WHERE LOWER(email) = LOWER(?) LIMIT 1`,
    [email.trim()]
  )
  return rows[0] ?? null
}

async function userById(id: string): Promise<UserRow | null> {
  const rows = await query<UserRow & Record<string, unknown>>(`SELECT ${USER_COLS} FROM auth_users WHERE id = ? LIMIT 1`, [id])
  return rows[0] ?? null
}

export async function getUserById(id: string): Promise<AuthUser | null> {
  const r = await userById(id)
  return r ? toAuthUser(r) : null
}

// ── sessions ─────────────────────────────────────────────────────────────────

export interface RequestMeta {
  userAgent?: string | null
  ip?: string | null
}

export async function createSession(user: UserRow, meta: RequestMeta = {}): Promise<{ token: string; session: AuthSession }> {
  const token = newToken()
  const expires = new Date(Date.now() + SESSION_TTL_MS)
  await execute('INSERT INTO auth_sessions (id, user_id, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?)', [
    sha256(token),
    user.id,
    toMysqlDatetime(expires),
    meta.userAgent?.slice(0, 300) ?? null,
    meta.ip ?? null,
  ])
  await execute('UPDATE auth_users SET last_sign_in_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [user.id])
  return {
    token,
    session: {
      user: toAuthUser(user),
      access_token: 'cookie',
      token_type: 'bearer',
      expires_at: Math.floor(expires.getTime() / 1000),
    },
  }
}

export async function userFromSessionToken(token: string | null | undefined): Promise<AuthUser | null> {
  if (!token) return null
  const id = sha256(token)
  const rows = await query<UserRow & { expires_at: string } & Record<string, unknown>>(
    `SELECT ${USER_COLS.split(', ').map((c) => 'u.' + c).join(', ')}, s.expires_at
       FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > UTC_TIMESTAMP(6)
        AND (u.banned_until IS NULL OR u.banned_until < UTC_TIMESTAMP(6))
      LIMIT 1`,
    [id]
  )
  const r = rows[0]
  if (!r) return null
  const exp = new Date(fromMysqlDatetime(r.expires_at) ?? 0).getTime()
  if (exp - Date.now() < SESSION_SLIDE_MS) {
    await execute('UPDATE auth_sessions SET expires_at = ? WHERE id = ?', [
      toMysqlDatetime(new Date(Date.now() + SESSION_TTL_MS)),
      id,
    ]).catch(() => {})
  }
  return toAuthUser(r)
}

export async function deleteSession(token: string | null | undefined, scope: 'local' | 'global' | 'others' = 'local') {
  if (!token) return
  const id = sha256(token)
  if (scope === 'local') {
    await execute('DELETE FROM auth_sessions WHERE id = ?', [id])
    return
  }
  const rows = await query<{ user_id: string }>('SELECT user_id FROM auth_sessions WHERE id = ?', [id])
  if (!rows[0]) return
  if (scope === 'global') await execute('DELETE FROM auth_sessions WHERE user_id = ?', [rows[0].user_id])
  else await execute('DELETE FROM auth_sessions WHERE user_id = ? AND id <> ?', [rows[0].user_id, id])
}

// ── one-time tokens ──────────────────────────────────────────────────────────

async function issueToken(userId: string, kind: OneTimeKind, payload?: Record<string, unknown>): Promise<string> {
  const token = newToken()
  await execute(
    'INSERT INTO auth_one_time_tokens (token_hash, user_id, kind, payload, expires_at) VALUES (?, ?, ?, ?, ?)',
    [sha256(token), userId, kind, payload ? JSON.stringify(payload) : null, toMysqlDatetime(new Date(Date.now() + TOKEN_TTL_MS[kind]))]
  )
  return token
}

export function authLink(redirectTo: string | null | undefined, origin: string, tokenHash: string, type: string): string {
  let url: URL
  try {
    url = new URL(redirectTo ?? '/auth/callback', origin)
    if (url.origin !== new URL(origin).origin) url = new URL('/auth/callback', origin)
  } catch {
    url = new URL('/auth/callback', origin)
  }
  url.searchParams.set('token_hash', tokenHash)
  url.searchParams.set('type', type)
  return url.toString()
}

// ── flows (mirroring GoTrue responses the UI expects) ────────────────────────

export async function signUp(input: {
  email?: string
  password?: string
  data?: Record<string, unknown>
  emailRedirectTo?: string
  origin: string
  meta?: RequestMeta
}): Promise<{ user: AuthUser | null; created: Awaited<ReturnType<typeof createSession>> | null; error: AuthError | null }> {
  const email = String(input.email ?? '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { user: null, created: null, error: authError('Unable to validate email address: invalid format', 400, 'email_address_invalid') }
  const problem = passwordProblem(input.password)
  if (problem) return { user: null, created: null, error: authError(problem, 422, 'weak_password') }
  if (await userByEmail(email)) return { user: null, created: null, error: authError('User already registered', 422, 'user_already_exists') }
  const confirm = requireConfirmation()
  const id = uuid()
  await execute(
    'INSERT INTO auth_users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, email, await hashPassword(input.password as string), JSON.stringify(input.data ?? {}), JSON.stringify({}), confirm ? null : toMysqlDatetime(new Date())]
  )
  await onUserCreated(id)
  const row = (await userById(id))!
  if (confirm) {
    const t = await issueToken(id, 'signup')
    await sendAuthEmail('signup', email, authLink(input.emailRedirectTo, input.origin, t, 'signup'))
    return { user: toAuthUser(row), created: null, error: null }
  }
  return { user: toAuthUser(row), created: await createSession(row, input.meta), error: null }
}

export async function signInWithPassword(input: { email?: string; password?: string; meta?: RequestMeta }) {
  const row = await userByEmail(String(input.email ?? ''))
  const ok = !!row && (await verifyPassword(String(input.password ?? ''), row.encrypted_password))
  if (!row || !ok) return { created: null, error: authError('Invalid login credentials', 400, 'invalid_credentials') }
  if (row.banned_until && new Date(fromMysqlDatetime(row.banned_until)!).getTime() > Date.now())
    return { created: null, error: authError('User is banned', 403, 'user_banned') }
  if (!row.email_confirmed_at && requireConfirmation())
    return { created: null, error: authError('Email not confirmed', 400, 'email_not_confirmed') }
  return { created: await createSession(row, input.meta), error: null }
}

export async function requestPasswordRecovery(email: string, redirectTo: string | null | undefined, origin: string) {
  const row = await userByEmail(String(email ?? ''))
  if (!row?.email) return
  const t = await issueToken(row.id, 'recovery')
  await sendAuthEmail('recovery', row.email, authLink(redirectTo, origin, t, 'recovery'))
}

export async function sendInviteEmail(userId: string, email: string, redirectTo: string | null | undefined, origin: string) {
  const t = await issueToken(userId, 'invite')
  await sendAuthEmail('invite' as AuthEmailKind, email, authLink(redirectTo, origin, t, 'invite'))
}

export async function verifyEmailToken(type: string, tokenHash: string, meta?: RequestMeta) {
  const kind = type === 'email' || type === 'magiclink' ? 'signup' : type
  const hashed = sha256(tokenHash)
  const rows = await query<{ user_id: string; payload: unknown }>(
    `SELECT user_id, payload FROM auth_one_time_tokens
      WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP(6) LIMIT 1`,
    [hashed, kind]
  )
  if (!rows[0]) return { created: null, error: authError('Email link is invalid or has expired', 403, 'otp_expired') }
  await execute('UPDATE auth_one_time_tokens SET used_at = CURRENT_TIMESTAMP(6) WHERE token_hash = ?', [hashed])
  const payload = parseJson(rows[0].payload)
  if (kind === 'email_change' && typeof payload.email === 'string') {
    await execute('UPDATE auth_users SET email = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [payload.email, rows[0].user_id])
  }
  await execute(
    'UPDATE auth_users SET email_confirmed_at = COALESCE(email_confirmed_at, CURRENT_TIMESTAMP(6)) WHERE id = ?',
    [rows[0].user_id]
  )
  const row = await userById(rows[0].user_id)
  if (!row) return { created: null, error: authError('User not found', 404) }
  return { created: await createSession(row, meta), error: null }
}

export async function updateUser(
  userId: string,
  attrs: { email?: string; password?: string; data?: Record<string, unknown> },
  origin: string,
  redirectTo?: string
): Promise<{ user: AuthUser | null; error: AuthError | null }> {
  if (attrs.password !== undefined) {
    const problem = passwordProblem(attrs.password)
    if (problem) return { user: null, error: authError(problem, 422, 'weak_password') }
    await execute('UPDATE auth_users SET encrypted_password = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [
      await hashPassword(attrs.password),
      userId,
    ])
  }
  if (attrs.data) {
    const cur = await userById(userId)
    const merged = { ...parseJson(cur?.raw_user_meta_data), ...attrs.data }
    await execute('UPDATE auth_users SET raw_user_meta_data = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [
      JSON.stringify(merged),
      userId,
    ])
  }
  if (attrs.email) {
    const email = attrs.email.trim().toLowerCase()
    const other = await userByEmail(email)
    if (other && other.id !== userId) return { user: null, error: authError('A user with this email address has already been registered', 422, 'email_exists') }
    if (requireConfirmation()) {
      const t = await issueToken(userId, 'email_change', { email })
      await sendAuthEmail('email_change', email, authLink(redirectTo, origin, t, 'email_change'))
    } else {
      await execute('UPDATE auth_users SET email = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [email, userId])
    }
  }
  const row = await userById(userId)
  return { user: row ? toAuthUser(row) : null, error: row ? null : authError('User not found', 404) }
}

/** Admin: create a user without a password (invites) or with one. */
export async function adminCreateUser(input: {
  email: string
  password?: string
  data?: Record<string, unknown>
  emailConfirmed?: boolean
}): Promise<AuthUser> {
  const id = uuid()
  await execute(
    'INSERT INTO auth_users (id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at) VALUES (?, ?, ?, ?, ?, ?)',
    [
      id,
      input.email.trim().toLowerCase(),
      input.password ? await hashPassword(input.password) : '',
      JSON.stringify(input.data ?? {}),
      JSON.stringify({}),
      input.emailConfirmed ? toMysqlDatetime(new Date()) : null,
    ]
  )
  await onUserCreated(id)
  return (await getUserById(id))!
}

/** Equivalent of the on_auth_user_created trigger (handle_new_user). */
async function onUserCreated(id: string) {
  const { handleNewUser } = await import('./hooks')
  await handleNewUser(id)
}

// ── AuthCtx ──────────────────────────────────────────────────────────────────

/** Build the policy context for a signed-in user from profiles.account_id / account_role. */
export async function authCtxForUser(user: AuthUser | null): Promise<AuthCtx> {
  if (!user) return ANON_CTX
  const rows = await query<{ account_id: string | null; account_role: AccountRole | null }>(MEMBERSHIP_SQL, [user.id])
  const memberships: Record<string, AccountRole> = {}
  for (const r of rows) if (r.account_id) memberships[r.account_id] = (r.account_role ?? 'agent') as AccountRole
  return { role: 'authenticated', userId: user.id, email: user.email, memberships }
}
