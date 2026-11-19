/**
 * Who is making a data request. Replaces Postgres RLS's auth.uid() / auth.role().
 *
 * - `role: 'service'`  → trusted server code (webhooks, cron, admin client). Policies are bypassed.
 * - `role: 'authenticated'` → a signed-in user. Policies in policies.ts apply.
 * - `role: 'anon'` → no session. Only policies that allow anon apply.
 */
export type AccountRole = 'owner' | 'admin' | 'agent' | 'viewer'

export interface AuthCtx {
  role: 'service' | 'authenticated' | 'anon'
  userId: string | null
  email?: string | null
  /** accountId → role, for every account the user belongs to (profiles.account_id/account_role). */
  memberships: Record<string, AccountRole>
}

export const SERVICE_CTX: AuthCtx = { role: 'service', userId: null, memberships: {} }
export const ANON_CTX: AuthCtx = { role: 'anon', userId: null, memberships: {} }

export function accountIds(ctx: AuthCtx): string[] {
  return Object.keys(ctx.memberships)
}

export function hasRole(ctx: AuthCtx, accountId: string, roles: AccountRole[]): boolean {
  const r = ctx.memberships[accountId]
  return !!r && roles.includes(r)
}
