import 'server-only'
/**
 * Server-side DbClient factories.
 *
 * - createUserClient(cookies, meta): acts as the signed-in user (policies apply), reads/writes the
 *   `aq_session` cookie for auth flows.
 * - createAdminClient(): service role (policies bypassed) for webhooks, cron, background jobs.
 */
import { SERVICE_CTX, type AuthCtx } from './auth-ctx'
import * as auth from './auth'
import { DbClient, type AuthApi, type StorageApi } from './client-core'
import { executeQuery } from './execute'
import { executeRpc } from './rpc-exec'
import { publicUrl, removeObjects, uploadObject } from './storage'

export interface CookieJar {
  get(name: string): { value: string } | undefined
  set(name: string, value: string, options: Record<string, unknown>): void
}

export interface RequestInfo {
  origin: string
  userAgent?: string | null
  ip?: string | null
}

export function sessionCookieOptions(expiresAtSec?: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.AUTH_INSECURE_COOKIES !== 'true',
    path: '/',
    ...(expiresAtSec ? { expires: new Date(expiresAtSec * 1000) } : { maxAge: 0 }),
  }
}

function toBuffer(body: unknown): Promise<Buffer> | Buffer {
  if (Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) return Buffer.from(body)
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body))
  if (body && typeof (body as Blob).arrayBuffer === 'function')
    return (body as Blob).arrayBuffer().then((b) => Buffer.from(new Uint8Array(b)))
  return Buffer.from(String(body ?? ''))
}

function storageFor(getCtx: () => Promise<AuthCtx>): StorageApi {
  return {
    from(bucket: string) {
      return {
        async upload(path, body, opts) {
          try {
            const buf = await toBuffer(body)
            const type = opts?.contentType ?? ((body as Blob)?.type || undefined)
            const data = await uploadObject(await getCtx(), bucket, path, buf, { ...opts, contentType: type })
            return { data, error: null }
          } catch (e: any) {
            return { data: null, error: { message: e?.message ?? String(e), statusCode: e?.statusCode } }
          }
        },
        async remove(paths) {
          try {
            return { data: await removeObjects(await getCtx(), bucket, paths), error: null }
          } catch (e: any) {
            return { data: null, error: { message: e?.message ?? String(e) } }
          }
        },
        getPublicUrl(path) {
          return { data: { publicUrl: publicUrl(bucket, path) } }
        },
      }
    },
  }
}

const notSupported = (name: string) => async () => ({
  data: { user: null, session: null },
  error: auth.authError(`${name} is not available on this client`, 400, 'not_supported'),
})

let admin: DbClient | null = null

export function createAdminClient(): DbClient {
  if (admin) return admin
  const getCtx = async () => SERVICE_CTX
  const authApi: AuthApi = {
    getUser: async () => ({ data: { user: null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
    signInWithPassword: notSupported('signInWithPassword') as any,
    signUp: notSupported('signUp') as any,
    signOut: async () => ({ error: null }),
    updateUser: notSupported('updateUser') as any,
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    verifyOtp: notSupported('verifyOtp') as any,
    exchangeCodeForSession: notSupported('exchangeCodeForSession') as any,
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  }
  admin = new DbClient({
    exec: (s) => executeQuery(s, SERVICE_CTX),
    rpc: (c) => executeRpc(c, SERVICE_CTX),
    auth: authApi,
    storage: storageFor(getCtx),
    realtime: null,
  })
  return admin
}

export function createUserClient(jar: CookieJar, info: RequestInfo): DbClient {
  let userP: Promise<auth.AuthUser | null> | null = null
  let ctxP: Promise<AuthCtx> | null = null
  const getUser = () => (userP ??= auth.userFromSessionToken(jar.get(auth.SESSION_COOKIE)?.value))
  const getCtx = () => (ctxP ??= getUser().then((u) => auth.authCtxForUser(u)))
  const reset = () => {
    userP = null
    ctxP = null
  }
  const meta = { userAgent: info.userAgent, ip: info.ip }
  const setSession = (created: { token: string; session: auth.AuthSession } | null) => {
    if (!created) return
    try {
      jar.set(auth.SESSION_COOKIE, created.token, sessionCookieOptions(created.session.expires_at))
    } catch {
      /* called from a Server Component; proxy refreshes on next request */
    }
    reset()
  }

  const authApi: AuthApi = {
    async getUser() {
      const user = await getUser()
      return user
        ? { data: { user }, error: null }
        : { data: { user: null }, error: auth.authError('Auth session missing!', 401, 'session_missing') }
    },
    async getSession() {
      const user = await getUser()
      return { data: { session: user ? { user, access_token: 'cookie', token_type: 'bearer' } : null }, error: null }
    },
    async signInWithPassword({ email, password }) {
      const { created, error } = await auth.signInWithPassword({ email, password, meta })
      if (error || !created) return { data: { user: null, session: null }, error }
      setSession(created)
      return { data: { user: created.session.user, session: created.session }, error: null }
    },
    async signUp({ email, password, options }) {
      const { user, created, error } = await auth.signUp({
        email,
        password,
        data: options?.data,
        emailRedirectTo: options?.emailRedirectTo,
        origin: info.origin,
        meta,
      })
      if (error) return { data: { user: null, session: null }, error }
      setSession(created)
      return { data: { user, session: created?.session ?? null }, error: null }
    },
    async signOut(opts) {
      await auth.deleteSession(jar.get(auth.SESSION_COOKIE)?.value, opts?.scope ?? 'local')
      if (!opts?.scope || opts.scope !== 'others') {
        try {
          jar.set(auth.SESSION_COOKIE, '', sessionCookieOptions())
        } catch {
          /* ignore */
        }
      }
      reset()
      return { error: null }
    },
    async updateUser(attrs, opts) {
      const user = await getUser()
      if (!user) return { data: { user: null }, error: auth.authError('Auth session missing!', 401, 'session_missing') }
      const res = await auth.updateUser(user.id, attrs, info.origin, opts?.emailRedirectTo)
      reset()
      return { data: { user: res.user }, error: res.error }
    },
    async resetPasswordForEmail(email, opts) {
      await auth.requestPasswordRecovery(email, opts?.redirectTo, info.origin)
      return { data: {}, error: null }
    },
    async verifyOtp({ type, token_hash }) {
      const { created, error } = await auth.verifyEmailToken(type, token_hash ?? '', meta)
      if (error || !created) return { data: { user: null, session: null }, error }
      setSession(created)
      return { data: { user: created.session.user, session: created.session }, error: null }
    },
    async exchangeCodeForSession() {
      // PKCE codes are a GoTrue concept; links here carry token_hash (verifyOtp)
      return { data: { user: null, session: null }, error: auth.authError('Use token_hash links', 400, 'not_supported') }
    },
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } }
    },
  }

  return new DbClient({
    exec: async (s) => executeQuery(s, await getCtx()),
    rpc: async (c) => executeRpc(c, await getCtx()),
    auth: authApi,
    storage: storageFor(getCtx),
    realtime: null,
  })
}

/** Resolve the AuthCtx for a request's cookies (used by /api/db, /api/realtime, storage routes). */
export async function authCtxFromCookie(token: string | undefined | null): Promise<AuthCtx> {
  return auth.authCtxForUser(await auth.userFromSessionToken(token))
}
