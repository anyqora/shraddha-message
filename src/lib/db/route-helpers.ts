import 'server-only'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE } from './auth'
import { authCtxFromCookie } from './server-client'

export function sessionToken(req: NextRequest): string | undefined {
  return req.cookies.get(SESSION_COOKIE)?.value
}

export function ctxFromRequest(req: NextRequest) {
  return authCtxFromCookie(sessionToken(req))
}

/** Reject cross-site POSTs to the data endpoints (cookie auth → CSRF guard). */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true // same-origin fetch from older browsers / server-side
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  try {
    const o = new URL(origin)
    if (host && o.host === host) return true
    const site = process.env.NEXT_PUBLIC_SITE_URL
    return !!site && new URL(site).host === o.host
  } catch {
    return false
  }
}

export function requestMeta(req: NextRequest) {
  return {
    userAgent: req.headers.get('user-agent'),
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null,
  }
}

export function originOf(req: NextRequest): string {
  const fixed = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '')
  if (fixed) return fixed
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000'
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
