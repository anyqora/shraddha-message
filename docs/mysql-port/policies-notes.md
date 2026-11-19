# RLS → `src/lib/db/policies.ts`

The source is `pg-schema/triggers_policies.sql` (125 policies, all PERMISSIVE, 3 limited to `{authenticated}`
and the rest `{public}`) and `pg-schema/schema.json` (`rls`). `POLICIES` covers 46 tables: 41 that had RLS
enabled (40 `public` tables plus `storage_objects`) and the 5 tables that had RLS disabled.

## Rules
- `service` bypasses everything. `policyFor()` also returns allow for service, as a safety net.
- On an RLS table, a command with no policy is denied. An unknown table is denied.
- Permissive policies are OR-ed. No restrictive policies exist.
- `anon` has no `auth.uid()`, so every policy is false for it (including the `{public}` ones).
- `is_account_member(acc, min)` means `acc` is in `memberAccountIds(ctx, min)`. Role ranks: owner 4, admin 3,
  agent 2, viewer 1. In SQL this becomes `alias.account_id IN (?, …)` with one `?` per id. With no
  qualifying membership the result is `false`, and `toPredicate()` turns that into `1=0`.
- An UPDATE with no explicit WITH CHECK uses USING as the check on the new row. Postgres does the same, and it
  stops a row from being moved into another account.
- Child tables use `EXISTS (SELECT 1 FROM parent __rls_parent WHERE … AND __rls_parent.account_id IN (…))`.
  Their insert and update checks run that lookup through `query()`. Pass the transaction connection as `ex`,
  so a parent row inserted in the same transaction is visible.

## AuthCtx.memberships
`profiles.user_id` is UNIQUE and `profiles.account_id` is NOT NULL, so each user has 0 or 1 membership. Load
it per request with `MEMBERSHIP_SQL` = `SELECT account_id, account_role FROM profiles WHERE user_id = ?` and
build `{ [account_id]: account_role }`. Use `{}` when there is no row.

## Tables
| table | select | insert | update (using / check) | delete |
|---|---|---|---|---|
| account_invitations | admin | admin | admin / admin | admin |
| accounts | member (`id`) | **deny** | admin (`id`) / admin | **deny** |
| ai_configs, ai_knowledge_chunks, ai_knowledge_documents, api_keys, custom_fields, message_templates, pipelines, tags, webhook_endpoints, whatsapp_config | member | admin | admin / admin | admin |
| automations, broadcasts, companies, contact_notes, contacts, conversations, deals, flows, quick_replies, tasks, views | member | agent | agent / agent | agent |
| ai_usage_log | admin | deny | deny | deny |
| automation_logs, flow_runs, member_presence | member | deny | deny | deny |
| automation_pending_executions, pending_message_statuses | deny (RLS, no policies) | deny | deny | deny |
| automation_steps (→automations.automation_id) | parent member | parent agent | parent agent | parent agent |
| broadcast_recipients (→broadcasts.broadcast_id) | parent member | parent agent | parent agent | parent agent |
| contact_custom_values, contact_tags (→contacts.contact_id) | parent member | parent agent | parent agent | parent agent |
| flow_nodes (→flows.flow_id) | parent member | parent agent | parent agent | parent agent |
| messages (→conversations.conversation_id) | parent member | parent agent | parent agent | parent agent |
| message_reactions (→messages JOIN conversations, via message_id) | parent member | parent agent | parent agent | parent agent |
| pipeline_stages (→pipelines.pipeline_id) | parent member | parent **admin** | parent admin | parent admin |
| flow_run_events (→flow_runs.flow_run_id) | parent member | deny | deny | deny |
| notifications | `user_id = uid` | deny | own / own | deny |
| profiles | `user_id = uid OR account member` | deny | own / own | deny |
| storage_objects | authenticated only: avatars `uid/…`; chat-media `account-<id>/…` (any role); flow-media `account-<id>/…` or `uid/…` | avatars own; chat-media agent+ account folder; flow-media agent+ (account folder or uid folder) | same as insert / same | same as insert |
| auth_users, auth_sessions, auth_one_time_tokens (no RLS) | deny | deny | deny | deny |
| schema_migrations, storage_buckets (no RLS) | authenticated: allow | deny | deny | deny |

## Not translated 1:1 (deliberate or unavoidable)
1. **Tables without RLS.** Postgres fell back to GRANTs, which the dump does not include. Supabase grants would
   have let authenticated users (and anon) write `schema_migrations` and `storage.buckets`. Here they are
   read-only for authenticated users. The `auth_*` tables are denied outright: PostgREST never exposed the
   auth schema, and they hold password hashes and session tokens. `auth.ts` must use the service ctx.
2. **Membership snapshot.** `is_account_member` read `profiles` live inside each statement. Here it reads
   `ctx.memberships`, loaded once per request. A role change takes effect on the next request.
3. **Collation.** MySQL `utf8mb4_*_ci` makes `=` and `IN` case-insensitive. Storage folder matching in SQL is
   therefore case-insensitive, while Postgres `text =` was case-sensitive. For example, `ACCOUNT-<id>/x` is
   visible to members of `<id>`. No cross-tenant exposure is possible, because the folder still has to equal
   the user's own uid or account id. The JS checks (insert and update) stay case-sensitive, like Postgres.
   UUID comparisons ignore case, which matches the Postgres uuid type.
4. **SELECT policy on UPDATE/DELETE and RETURNING.** Postgres also applies SELECT policies to rows read by
   UPDATE/DELETE WHERE clauses and RETURNING. Every UPDATE/DELETE/INSERT policy here implies the table's SELECT
   policy, so nothing is lost. The builder should still filter `.select()` after a write with the select
   predicate.
5. **Child update check shortcut.** When the parent FK does not change, `update.check` returns true without a
   query. CHECK equals USING for these policies, and `oldRow` is required to have matched `using`. This
   requires the builder to call `check` only on rows that it selected with `using`.
6. **Trigger-enforced rules are not policies.** These go in `hooks.ts`, not here:
   - `enforce_profile_privilege_columns`: authenticated users cannot INSERT profiles or change
     `account_id` / `account_role`.
   - `enforce_account_identity_columns`: authenticated users cannot change `accounts.id`, `owner_user_id` or
     `created_at`.
   - `enforce_conversation_assignee_membership`.
7. **JSON/array operators.** No policy uses arrays or JSON, so JSON_CONTAINS / JSON_OVERLAPS are not needed.
8. **Unknown or new MySQL-only tables** are denied to non-service callers until they are added to `POLICIES`.

## Builder contract (summary)
- select/delete: AND the predicate into WHERE.
- update: AND `using` into WHERE. Then call `check(ctx, newRow, oldRow, ex)` per row, after the BEFORE hooks.
- insert: call `insert(ctx, row, ex)` per row, after defaults and BEFORE hooks.
- A failed insert or update check raises error `42501`, `new row violates row-level security policy for table "<t>"`.
