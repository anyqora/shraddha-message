import 'server-only'
/* eslint-disable @typescript-eslint/no-explicit-any -- rows/args are dynamic PostgREST-shaped values */
/**
 * TypeScript re-implementations of the Postgres functions the app calls with `.rpc()`.
 * Keyed by the pg function name; each takes the named args object supabase-js would have
 * sent and returns what PostgREST returned (scalar / object / array of rows / null for void).
 * Errors are thrown as HookError (`code` = SQLSTATE). See docs/mysql-port/functions-notes.md.
 */
import {
  is_account_member,
  peek_invitation,
  redeem_invitation,
  remove_account_member,
  set_member_role,
  touch_presence,
  transfer_account_ownership,
} from './accounts'
import {
  acquire_broadcast_delivery_lease,
  broadcast_delivery_in_flight,
  create_broadcast_with_recipients,
  recompute_broadcast_counts,
  renew_broadcast_delivery_lease,
} from './broadcasts'
import { dashboard_overview } from './dashboard'
import {
  bump_conversation_on_inbound,
  claim_ai_reply_slot,
  increment_automation_execution_count,
  increment_flow_execution_count,
  list_timed_out_flow_runs,
  merge_duplicate_contacts,
  merge_duplicate_conversations,
  record_webhook_failure,
  replace_flow_graph,
  replace_flow_nodes,
} from './engine'
import { filter_contacts_by_tags, match_ai_knowledge_fts, match_ai_knowledge_semantic } from './search'
import type { RpcCtx, RpcFn } from './util'

export type { RpcCtx, RpcFn } from './util'
export { RpcError } from './util'

export const RPC: Record<string, RpcFn> = {
  // broadcasts
  create_broadcast_with_recipients,
  recompute_broadcast_counts,
  acquire_broadcast_delivery_lease,
  renew_broadcast_delivery_lease,
  broadcast_delivery_in_flight,
  // conversations / engines / webhooks
  bump_conversation_on_inbound,
  claim_ai_reply_slot,
  increment_automation_execution_count,
  increment_flow_execution_count,
  record_webhook_failure,
  list_timed_out_flow_runs,
  replace_flow_nodes,
  replace_flow_graph,
  merge_duplicate_contacts,
  merge_duplicate_conversations,
  // accounts / members / invitations / presence
  is_account_member,
  peek_invitation,
  redeem_invitation,
  remove_account_member,
  set_member_role,
  transfer_account_ownership,
  touch_presence,
  // read models
  dashboard_overview,
  filter_contacts_by_tags,
  match_ai_knowledge_fts,
  match_ai_knowledge_semantic,
}

/**
 * RPCs called from 'use client' code (exposed on /api/db/rpc). Everything else is server-only:
 *   filter_contacts_by_tags   app/(dashboard)/contacts/page.tsx
 *   touch_presence            components/presence/presence-heartbeat.tsx
 *   dashboard_overview        app/(dashboard)/dashboard/page.tsx → lib/dashboard/overview.ts
 *   acquire/renew lease       hooks/use-broadcast-sending.ts → lib/whatsapp/broadcast-delivery-lease.ts
 *   broadcast_delivery_in_flight  app/(dashboard)/broadcasts/[id]/page.tsx
 */
export const BROWSER_RPC: ReadonlySet<string> = new Set([
  'filter_contacts_by_tags',
  'touch_presence',
  'dashboard_overview',
  'acquire_broadcast_delivery_lease',
  'renew_broadcast_delivery_lease',
  'broadcast_delivery_in_flight',
])

/** Convenience: run an RPC by name (throws PGRST202 like PostgREST for unknown names). */
export async function callRpc(name: string, args: Record<string, any>, ctx: RpcCtx): Promise<unknown> {
  const fn = RPC[name]
  if (!fn) {
    const e: any = new Error(`Could not find the function public.${name} in the schema cache`)
    e.code = 'PGRST202'
    throw e
  }
  return fn(args ?? {}, ctx)
}
