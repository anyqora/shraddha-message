import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, userFromSessionToken } from '@/lib/db/auth'

/**
 * Next 16 Proxy (formerly middleware), Node.js runtime.
 * Resolves the `aq_session` cookie against MySQL and applies the same redirects
 * the Supabase middleware did.
 */

// Every top-level route under src/app/(dashboard)/ belongs here —
// proxy.test.ts reads that directory and fails on a missing one.
export const PROTECTED_PATHS = [
  '/dashboard',
  '/inbox',
  '/contacts',
  '/companies',
  '/pipelines',
  '/tasks',
  '/broadcasts',
  '/automations',
  '/flows',
  '/agents',
  '/notifications',
  '/settings',
]

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  const token = request.cookies.get(SESSION_COOKIE)?.value
  const user = token ? await userFromSessionToken(token).catch(() => null) : null

  // Auth pages - redirect to dashboard if already logged in.
  // With an invite token in the query string, send the signed-in user to /join/<token>.
  if (user && (path === '/login' || path === '/signup' || path === '/forgot-password')) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (inviteToken && (path === '/login' || path === '/signup')) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
    } else {
      url.pathname = '/dashboard'
    }
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (!user && PROTECTED_PATHS.some((p) => path === p || path.startsWith(p + '/'))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    const res = NextResponse.redirect(url)
    if (token) res.cookies.delete(SESSION_COOKIE)
    return res
  }

  // API routes that need auth (not webhooks)
  if (!user && path.startsWith('/api/whatsapp/') && !path.includes('/webhook')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.next({ request })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/realtime|api/storage/public|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
