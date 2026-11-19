import { NextResponse, type NextRequest } from 'next/server'
import * as auth from '@/lib/db/auth'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { originOf, requestMeta, sameOrigin, sessionToken } from '@/lib/db/route-helpers'
import { sessionCookieOptions } from '@/lib/db/server-client'

export const dynamic = 'force-dynamic'

type Json = Record<string, any>

function json(body: Json, status = 200) {
  return NextResponse.json(body, { status })
}

function withSession(body: Json, created: { token: string; session: auth.AuthSession } | null) {
  const res = json(body)
  if (created) res.cookies.set(auth.SESSION_COOKIE, created.token, sessionCookieOptions(created.session.expires_at))
  return res
}

/**
 * Auth endpoint used by the browser client (replaces GoTrue):
 *   user | session | login | signup | logout | update | recover | verify
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params
  if (!sameOrigin(req)) return json({ error: auth.authError('Forbidden', 403, 'forbidden') }, 403)
  const body: Json = await req.json().catch(() => ({}))
  const token = sessionToken(req)
  const meta = requestMeta(req)
  const origin = originOf(req)

  if (['login', 'signup', 'recover'].includes(action)) {
    const rl = checkRateLimit(`auth:${action}:${getClientIp(req)}`, { limit: 10, windowMs: 60_000 })
    if (!rl.success) return json({ data: { user: null, session: null }, error: auth.authError('Too many requests', 429, 'over_request_rate_limit') })
  }

  switch (action) {
    case 'user': {
      const user = await auth.userFromSessionToken(token)
      return json({
        data: { user },
        error: user ? null : auth.authError('Auth session missing!', 401, 'session_missing'),
      })
    }
    case 'session': {
      const user = await auth.userFromSessionToken(token)
      return json({ data: { session: user ? { user, access_token: 'cookie', token_type: 'bearer' } : null }, error: null })
    }
    case 'login': {
      const { created, error } = await auth.signInWithPassword({ email: body.email, password: body.password, meta })
      if (error || !created) return json({ data: { user: null, session: null }, error })
      return withSession({ data: { user: created.session.user, session: created.session }, error: null }, created)
    }
    case 'signup': {
      const { user, created, error } = await auth.signUp({
        email: body.email,
        password: body.password,
        data: body.options?.data,
        emailRedirectTo: body.options?.emailRedirectTo,
        origin,
        meta,
      })
      if (error) return json({ data: { user: null, session: null }, error })
      return withSession({ data: { user, session: created?.session ?? null }, error: null }, created)
    }
    case 'logout': {
      await auth.deleteSession(token, body.scope ?? 'local')
      const res = json({ error: null })
      if (body.scope !== 'others') res.cookies.set(auth.SESSION_COOKIE, '', sessionCookieOptions())
      return res
    }
    case 'update': {
      const user = await auth.userFromSessionToken(token)
      if (!user) return json({ data: { user: null }, error: auth.authError('Auth session missing!', 401, 'session_missing') })
      const r = await auth.updateUser(user.id, body.attrs ?? {}, origin, body.opts?.emailRedirectTo)
      return json({ data: { user: r.user }, error: r.error })
    }
    case 'recover': {
      await auth.requestPasswordRecovery(body.email, body.redirectTo, origin)
      return json({ data: {}, error: null })
    }
    case 'verify': {
      const { created, error } = await auth.verifyEmailToken(body.type, body.token_hash ?? '', meta)
      if (error || !created) return json({ data: { user: null, session: null }, error })
      return withSession({ data: { user: created.session.user, session: created.session }, error: null }, created)
    }
    default:
      return json({ error: auth.authError('Not found', 404, 'not_found') }, 404)
  }
}
