import 'server-only'
/**
 * Adapter between the query executor and the RLS-replacement policies (policies.ts).
 * Policy checks that look up parent rows receive the transaction connection so rows
 * written earlier in the same transaction are visible.
 */
import type { AuthCtx } from './auth-ctx'
import { policyFor, type Predicate } from './policies'
import type { Executor } from './pool'

export type SqlFrag = Predicate | boolean

export function readPredicate(ctx: AuthCtx, table: string, alias: string): SqlFrag {
  return policyFor(table, 'select')(ctx, alias)
}

export function updatePredicate(ctx: AuthCtx, table: string, alias: string): SqlFrag {
  return policyFor(table, 'update').using(ctx, alias)
}

export function deletePredicate(ctx: AuthCtx, table: string, alias: string): SqlFrag {
  return policyFor(table, 'delete')(ctx, alias)
}

export function canInsert(ctx: AuthCtx, table: string, row: Record<string, unknown>, ex?: Executor): Promise<boolean> {
  return policyFor(table, 'insert')(ctx, row, ex)
}

export function updateCheck(
  ctx: AuthCtx,
  table: string,
  newRow: Record<string, unknown>,
  oldRow: Record<string, unknown>,
  ex?: Executor
): Promise<boolean> {
  return policyFor(table, 'update').check(ctx, newRow, oldRow, ex)
}
