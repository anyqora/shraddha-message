/**
 * Type exports that used to come from '@supabase/supabase-js'.
 * The app now runs on MySQL through a supabase-js compatible client (src/lib/db).
 */
export type {
  SupabaseClient,
  User,
  Session,
  AuthChangeEvent,
  AuthError,
  RealtimePostgresChangesPayload,
} from '@/lib/db/client-core'
export { RealtimeChannel } from '@/lib/db/client-core'
export type { PostgrestError, PostgrestResponse } from '@/lib/db/query-state'

export type EmailOtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'
