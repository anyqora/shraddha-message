# Postgres functions and triggers → TypeScript (MySQL)

Every application plpgsql/sql function in `pg-schema/functions.sql` is re-implemented in TypeScript.
Callable RPCs are in `src/lib/db/rpc/*` (registry: `RPC` in `rpc/index.ts`). Trigger functions are
in `src/lib/db/hooks.ts` (registry: `HOOKS`).

Not ported:
- Extension functions: pgvector, pgcrypto, uuid-ossp (C language).
- `auth.uid/jwt/role/email`: replaced by `AuthCtx`.
- `storage.*` helpers.
- `realtime_notify`: `execute.ts` publishes builder writes itself.

## Conventions

- **Signature.** `RpcFn = (args, { auth, conn? }) => Promise<result>`.
  - `args` uses the pg argument names, the same object supabase-js sent.
  - Arguments can be JS values or JSON strings: `jsonArg`, `arrayArg` and `intArg` accept both. `uuid[]` also accepts the pg literal `{a,b}`.
- **Results.** Results have the PostgREST shape:
  - a scalar
  - an object (`json` / `jsonb`)
  - an array of row objects (`TABLE` / `SETOF`)
  - `null` for `void`
- **Timestamps.** Timestamps come back as `2026-11-19T10:05:00.123456+00:00`, via `codec.fromMysqlDatetime`, so microseconds are kept.
- **Errors.** Errors are thrown as `HookError(message, code)` with the pg SQLSTATE that callers check:
  - `42501` unauthorized / insufficient privilege
  - `22023` invalid parameter
  - `23505` conflict
  - `22P02` bad enum / int / array input

  `execute.ts` maps `name === 'HookError'` to a PostgREST error. An `/api/db/rpc` route should do the same, and `callRpc()` throws `PGRST202` for unknown names.
- **Transactions.** Functions that write run in `tx(fn, ctx.conn)`. If `ctx.conn` is passed, they join the caller's transaction. Read-only functions use `ctx.conn ?? pool`.
- **SECURITY DEFINER vs invoker.**
  - SECURITY DEFINER functions that check `auth.uid()` or `is_account_member()` run the same checks live against `profiles`. The `isAccountMember` helper does this, and `role: 'service'` bypasses it.
  - Functions that need the caller's identity require `ctx.auth.userId` even for service: `redeem_invitation`, `remove_account_member`, `set_member_role`, `transfer_account_ownership`, `touch_presence`, `dashboard_overview`.
  - Invoker functions, which were under RLS in pg, are restricted to `Object.keys(ctx.auth.memberships)`. Service sees everything.
- **Raw SQL skips hooks.** Raw SQL in RPCs does not go through `HOOKS`. This matches pg, where these were SECURITY DEFINER and the definer bypassed the privilege triggers. Where pg triggers still had side effects, the RPC does them itself:
  - `updated_at` is always set explicitly, and the 16 `ON UPDATE CURRENT_TIMESTAMP(6)` columns do it too.
  - Realtime events go through `emitRowChange()` (from `hooks.ts`) for tables that had `realtime_notify_trg`: conversations, flow_runs, member_presence, notifications.
- **Locking.** `SELECT … FOR UPDATE` works on MySQL 8 and MariaDB 10.6. These functions use no `SKIP LOCKED` and no advisory locks. The lease functions use a conditional `UPDATE` and check `affectedRows`.

## RPCs (`RPC`)

The **Browser** column marks functions that are in `BROWSER_RPC`, the set of RPCs exposed on `/api/db/rpc`.

| function | file | Browser | notes |
|---|---|---|---|
| `create_broadcast_with_recipients` | rpc/broadcasts.ts | | Validation errors are identical (22023). Inserts the parent and 500-row recipient batches in one tx, and returns `[{broadcast_id, recipient_id, contact_id}]` in input order. Recipients start as `pending`, which contributes nothing to the counters, so no aggregate bump is needed. **Added:** non-service callers must be an `agent` of `p_account_id` (pg had no check). The only caller is the v1 API route, which uses the service context. |
| `recompute_broadcast_counts` | rpc/broadcasts.ts | | Runs a SELECT aggregate, then an UPDATE. `recomputeBroadcastCounts(conn, bid)` is exported. |
| `acquire_broadcast_delivery_lease` | rpc/broadcasts.ts | ✓ | Agent membership check, then a conditional `UPDATE … SET delivery_lease_until = now+5min WHERE (lease null or past) AND (locked_at null or >30min old)`. A won race is detected by `affectedRows`, and the value is re-read in the same tx because MySQL has no RETURNING. Returns an ISO string or `null`. |
| `renew_broadcast_delivery_lease` | rpc/broadcasts.ts | ✓ | `WHERE delivery_lease_until = p_held`. `p_held` is parsed with `toMysqlDatetime`, which keeps microseconds, so the ISO string from acquire/renew round-trips exactly. The builder's `.eq('delivery_lease_until', lease)` relies on the same codec. |
| `broadcast_delivery_in_flight` | rpc/broadcasts.ts | ✓ | Invoker in pg. Returns `false` when the caller is not a member, which emulates RLS. |
| `bump_conversation_on_inbound` | rpc/engine.ts | | A single atomic UPDATE, plus a realtime UPDATE event for the conversation. |
| `claim_ai_reply_slot` | rpc/engine.ts | | A single conditional UPDATE. Returns `affectedRows > 0`, plus a realtime event when it claims a slot. |
| `increment_automation_execution_count`, `increment_flow_execution_count` | rpc/engine.ts | | Return `null`. |
| `record_webhook_failure` | rpc/engine.ts | | MySQL evaluates SET left to right, so `is_active` is assigned before `failure_count` and sees the old value, as in pg. |
| `list_timed_out_flow_runs` | rpc/engine.ts | | SQL selects active runs with `last_advanced_at <= p_now`. The per-flow timeout check (`fallback_policy.on_timeout_hours`: a JSON number > 0, capped at 87600, default 24) runs in TS, because `JSON_TYPE` names differ between MySQL and MariaDB. Ordering and limit are unchanged. |
| `replace_flow_nodes` | rpc/engine.ts | | Locks the flow `FOR UPDATE`, checks agent membership (service bypasses), deletes and re-inserts nodes, then cancels active runs whose `current_node_key` disappeared. Returns the cancelled count and emits realtime for each cancelled run. **Lenient:** a fractional `position_x/y` is rounded, where pg raised 22P02. |
| `replace_flow_graph` | rpc/engine.ts | | Runs `replace_flow_nodes` and the flow-row patch (only keys present in `p_flow`) in one tx. Text keys use `->>` semantics; `trigger_config` and `fallback_policy` are stored as JSON. |
| `merge_duplicate_contacts`, `merge_duplicate_conversations` | rpc/engine.ts | | Maintenance functions, used by migrations only and not called by the app. **Service role only.** Losers are re-pointed to the survivor, then deleted (cascades handle the rest). The pg tag / custom-value re-point could hit UNIQUE errors when 3+ duplicates shared a tag; this version moves one row per key. These functions emit no realtime events. |
| `is_account_member` | rpc/accounts.ts | | Exact pg semantics (`auth.uid()` only, so service gets `false`). The internal checks use the bypassing helper `util.isAccountMember`. |
| `peek_invitation` | rpc/accounts.ts | | Works for anon. Returns `{ok:false, reason:'not_found'\|'used'\|'expired'}` or `{ok:true, account_name, role, expires_at}`. Expiry is compared with the DB clock. |
| `redeem_invitation` | rpc/accounts.ts | | Same checks, messages and codes as pg. The invitation row is locked `FOR UPDATE`, and the profile + account rows are locked with `FOR UPDATE` on the join. The 26-table "old account has data" probe uses one `UNION ALL … LIMIT 1`. The emptied old account is deleted, and its children cascade. |
| `remove_account_member` | rpc/accounts.ts | | Both profiles are locked in `user_id` order. Creates the personal account, moves the profile, unassigns the target's conversations (with realtime events), and returns the new account id. |
| `set_member_role`, `transfer_account_ownership` | rpc/accounts.ts | | Same rules. An invalid role raises 22P02, like the enum cast did. |
| `touch_presence` | rpc/accounts.ts | ✓ | `INSERT … ON DUPLICATE KEY UPDATE`, using `VALUES()` for MariaDB compatibility, plus a realtime INSERT/UPDATE event on member_presence. |
| `dashboard_overview` | rpc/dashboard.ts | ✓ | See the next section. |
| `filter_contacts_by_tags` | rpc/search.ts | ✓ | Runs a COUNT query, then the page query (newest first, then id). Returns `[{contact: <decoded contacts row>, total_count}]`. ILIKE becomes `LOWER(x) LIKE LOWER(?)`, and the app's `\_` escapes still work because the default LIKE escape is `\`. RLS is applied through the caller's member accounts. |
| `match_ai_knowledge_fts` | rpc/search.ts | | `MATCH(content) AGAINST(? IN NATURAL LANGUAGE MODE)` (OR of words, relevance-ranked) on the FULLTEXT index. InnoDB drops stopwords and words shorter than 3 characters, and pg 'simple' did not. When MATCH returns fewer than `p_match_count` rows, a LIKE scan on the query's lexemes tops up the result, ranked below the MATCH hits. `rank` values are on a different scale from pg's `ts_rank`; callers only use the ordering. Rows inserted in a still-open transaction are not visible to FULLTEXT. |
| `match_ai_knowledge_semantic` | rpc/search.ts | | Loads the account's embeddings (JSON float arrays) and computes cosine distance (`1 - cos`, the same as pgvector `<=>`) in TS. Brute force, which is fine for per-account chunk counts. Raises if the query vector is not 1536-dimensional, like `::vector(1536)`. |

### dashboard_overview

The pg version was a single plpgsql function using `percentile_cont`, `generate_series`, `LATERAL`, `lag()` and `AT TIME ZONE`. The TS version:

- **Caller and arguments.**
  - The caller's account comes from `profiles` (via `auth.userId`). With no account it raises 42501.
  - `p_days` must be in {1, 7, 30, 90} (22023).
  - An invalid `p_tz` falls back to `'UTC'`; validity is checked with `Intl`.
- **Clock.** `now` is read from the DB (`CURRENT_TIMESTAMP(6)`).
- **Periods.**
  - `periodStart` is local midnight `p_days - 1` days ago, converted to UTC with Intl (DST-safe).
  - `previousStart` is `periodStart - p_days×24h`, and `previousEnd` is `now - p_days×24h`. pg used the same arithmetic because the session time zone was UTC.
- **Time-zone bucketing.** Done without MySQL tz tables, since `CONVERT_TZ` with named zones needs `mysql.time_zone*`, which is not guaranteed on Hostinger.
  - SQL groups rows into UTC 15-minute slots: `FLOOR(TIMESTAMPDIFF(SECOND,'1970-01-01',ts)/900)`. Every real UTC offset is a multiple of 15 minutes.
  - TS maps each slot to its local hour/day bucket and builds the naive wall-clock bucket series the way `generate_series` did.
- **Reply turns.** Messages since `previousStart - 1 day` are fetched, ordered by `(conversation_id, created_at, id)`. The human and AI streams, run starts (`lag`) and first replies are computed in TS. The reply must have a strictly later `created_at` and not be failed.
  - `median` is an exact `percentile_cont(0.5)` with linear interpolation, and `null` when there are no values.
- **Output.** The JSON keys and value types match the pg output and `lib/dashboard/overview.ts`. Counts and sums are numbers, timestamps are ISO strings, and booleans are real booleans.
  - jsonb key order (pg sorted keys) is not reproduced.
  - `stats` is ordered like `pipelines`; pg left that order unspecified.
  - pg's DESC-NULLS-FIRST / ASC-NULLS-LAST behaviour is emulated with `(x IS NULL)` sort keys.
  - The team is sorted by `full_name` with `localeCompare`, where pg used the DB collation.

## Triggers → `HOOKS` (`src/lib/db/hooks.ts`)

Order within a table follows pg (BEFORE triggers fire alphabetically by trigger name).

| table | hooks | pg trigger(s) |
|---|---|---|
| auth_users | afterInsert → `bootstrapNewUser`. Also `handleNewUser(userId, conn?)`, which `auth.ts` calls through `setUserCreatedHook`. | on_auth_user_created / handle_new_user. Creates the account, named full_name, else email, else 'My account', plus an owner profile. It runs inside a SAVEPOINT and swallows errors like pg's WARNING, but rethrows deadlock and lock-timeout errors. |
| accounts | beforeUpdate: identity columns, updated_at | enforce_account_identity_columns: raises 42501 when role = 'authenticated' changes owner_user_id, id or created_at. Plus set_updated_at. |
| profiles | beforeInsert/beforeUpdate: privilege columns, updated_at | enforce_profile_privilege_columns: 'authenticated' can neither insert nor change account_role/account_id (42501). |
| conversations | beforeInsert/Update: closed_at stamp, assignee membership, updated_at. afterInsert/Update: assignment notification. | stamp_conversation_closed_at, enforce_conversation_assignee_membership, set_updated_at, notify_conversation_assigned |
| deals | beforeInsert/Update: closed_at stamp, updated_at | stamp_deal_closed_at, set_updated_at |
| tasks | beforeInsert/Update: updated_at, completed_at stamp | set_updated_at, tasks_stamp_completed_at |
| messages | afterInsert/afterUpdate: `trackConversationMessageTimes` | messages_track_conversation_times. Maintains `conversations.last_inbound_at` / `last_reply_at`, emits a conversation realtime UPDATE, and bumps `updated_at`, as pg's set_updated_at did on that UPDATE. |
| broadcast_recipients | afterInsert/Update/Delete: `applyBroadcastAggregate` | broadcast_recipients_aggregate. It is one UPDATE with nested `GREATEST(0, COALESCE(col + d, 0))`, which applies the pg sequence of `_bcast_bump` calls exactly, including the clamp at 0 and NULL → 0. `_bcast_cols_for_status` is `bcastColsForStatus`. |
| ai_configs, ai_knowledge_documents, automations, broadcasts, companies, contacts, flows, message_templates, quick_replies, views, whatsapp_config | beforeUpdate: updated_at | set_updated_at, update_ai_*_updated_at |
| contacts | beforeInsert/Update | partial UNIQUE `idx_contacts_account_phone_normalized` (phone_normalized <> '') |
| flow_runs | beforeInsert/Update | partial UNIQUE `idx_one_active_run_per_contact` (status = 'active'; a NULL contact_id never conflicts) |
| message_reactions | beforeInsert/Update | partial UNIQUE `idx_message_reactions_one_agent_reaction`. A row with the same (message_id, actor_type, actor_id) is left to the real UNIQUE key, which is the upsert target. |

The three partial-unique hooks use a `SELECT … FOR UPDATE` probe. Under InnoDB REPEATABLE READ, next-key locks make two concurrent inserts serialise. On conflict the hooks raise `duplicate key value violates unique constraint "<name>"` with code 23505. `flows/engine.ts` matches on "duplicate key".

### Semantic differences in hooks

- **`UPDATE OF status` triggers** (conversation and deal closed_at stamps) run only when status actually changed. The executor passes the merged row, not the SET list. The only difference from pg: if a patch includes the unchanged status and an explicit `closed_at`, pg would overwrite that `closed_at` and we keep it.
- **`now()`** is JS `new Date()` (ms precision) in BEFORE hooks, and `CURRENT_TIMESTAMP(6)` in SQL side effects. pg used one transaction timestamp.
- **notify_conversation_assigned** swallows errors like pg did, except deadlock and lock-timeout errors.
- **Exported helpers for raw-SQL writers:**
  - `applyBroadcastAggregate(conn, broadcastId, oldStatus, newStatus)`: call it if you change `broadcast_recipients.status` with raw SQL.
  - `trackConversationMessageTimes(conn, row, oldRow)`: call it if you insert messages or fail them with raw SQL.
  - `notifyConversationAssigned(conn, auth, row, oldRow)`
  - `bootstrapNewUser(conn, userRow)`
  - `emitRowChange(conn, table, eventType, pk)`
- **FK cascades** happen inside MySQL with no hooks:
  - Deleting a broadcast does not bump counters, and that is moot because the broadcast is gone.
  - Deleting a conversation does not run the message hooks. pg had no delete triggers there either.
  - Cascaded deletes publish no realtime events. pg's realtime_notify did fire on cascaded deletes of messages, notifications and so on. A subscriber watching such a child table will not see a DELETE event when its parent is deleted.

## Open issues / not portable

1. **FTS ranking.** `match_ai_knowledge_fts` ranks differently from `ts_rank` (see the table above). Stopword and short-word gaps are covered by the LIKE top-up, but the LIKE path is a table scan per account.
2. **Semantic search** is brute force in Node, so cost grows with an account's chunk count, roughly 1536 floats per chunk. That is fine at the current scale.
3. **`dashboard_overview` scale.** It pulls every message since `previousStart - 1 day` for the account to compute reply turns. For 90 days that is up to 181 days of messages. This is fine for small accounts. If it gets slow, add a covering index on `messages(conversation_id, created_at, id, sender_type, status, ai_generated, sender_id)` or precompute turns.
4. **`create_broadcast_with_recipients` membership check.** The check for non-service callers is an addition that pg did not have.
5. **Merge functions.** `merge_duplicate_*` are service-only and emit no realtime events.
6. **Time-zone strings.** IANA names behave the same. POSIX-style strings such as `'+05:30'` are interpreted by Intl as a fixed offset east of UTC, while pg treated them as west of UTC. Browsers always send IANA names.
