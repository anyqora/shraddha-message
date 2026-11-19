import 'server-only'
import { cookies, headers } from 'next/headers'
import { createUserClient } from '@/lib/db/server-client'

/**
 * Request-scoped client acting as the signed-in user (row policies apply).
 * Same call signature as the old Supabase SSR client; backed by MySQL.
 */
export function requestOrigin(h: { get(name: string): string | null }): string {
  const fixed = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '')
  if (fixed) return fixed
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  return `${proto}://${host}`
}

export function requestIp(h: { get(name: string): string | null }): string | null {
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null
}

export async function createClient() {
  const cookieStore = await cookies()
  const h = await headers()
  return createUserClient(
    {
      get: (name) => cookieStore.get(name),
      set: (name, value, options) => {
        try {
          cookieStore.set(name, value, options)
        } catch {
          // Called from a Server Component — cookies are read-only there.
        }
      },
    },
    { origin: requestOrigin(h), userAgent: h.get('user-agent'), ip: requestIp(h) }
  )
}
