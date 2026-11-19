import 'server-only'
import { createAdminClient } from '@/lib/db/server-client'
import type { SupabaseClient } from '@/lib/db/client-core'

/**
 * Service-role client (row policies bypassed). Drop-in for
 * `createClient(SUPABASE_URL, SERVICE_ROLE_KEY, opts)` from '@supabase/supabase-js':
 * the arguments are accepted and ignored.
 */
export function createClient(_url?: string, _key?: string, _opts?: unknown): SupabaseClient {
  return createAdminClient()
}

export { createAdminClient }
export type { SupabaseClient }
