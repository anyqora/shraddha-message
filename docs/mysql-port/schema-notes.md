# MySQL schema notes (0001_init.sql)

`db/mysql/migrations/0001_init.sql` and `src/lib/db/schema.generated.ts` are both **generated** by
`scripts/gen-schema.mjs` from `docs/mysql-port/pg-schema/schema.json`. Do not edit them by hand. Change the
generator and re-run it:

```sh
export PATH=$HOME/.local/node/bin:$PATH
node scripts/gen-schema.mjs               # writes both files and prints counts
node scripts/gen-schema.mjs --notes-json  # dumps every drop/rewrite as JSON (source for this file)
```

If a future schema.json contains something the generator cannot translate (a new type, default, index
expression or FK form), the generator throws instead of guessing.

## Scope
- 45 tables: 40 `public.*` tables, `auth.users`, `auth.sessions` and `auth.one_time_tokens` (as
  `auth_users`, `auth_sessions` and `auth_one_time_tokens`), and `storage.buckets` and `storage.objects` (as
  `storage_buckets` and `storage_objects`).
- `public.schema_migrations` is not created. The MySQL migrator owns its own `schema_migrations`.
- Not in this file: functions, triggers, RLS policies, grants and realtime. Those belong to `rpc/*`, `hooks.ts`,
  `policies.ts` and `events.ts`.
- Constraint and index names keep their pg names. For auth and storage tables the pg table prefix is replaced by
  the MySQL table name: `sessions_user_id_fkey` becomes `auth_sessions_user_id_fkey`, and
  `objects_bucket_id_name_key` becomes `storage_objects_bucket_id_name_key`. FK and CHECK names are unique across
  the database, which MySQL requires.

## File format (for `migrate.ts`)
- The file has one statement per `;`. No `;` appears inside comments or string literals, so a naive split on
  `;` followed by a newline is safe. That matters because the pool uses `multipleStatements: false`.
- Every statement is `CREATE TABLE IF NOT EXISTS`. Applying the file twice was tested on MySQL 8.4.3 and both
  runs were clean. The second run only gives "table already exists" notes and the `TINYINT(1)` display-width
  deprecation warning.
- Tables are in FK dependency order, so FKs are inline and no `ALTER TABLE` is needed. There are no FK cycles.
  Self-references (`automation_steps.parent_step_id`, `messages.reply_to_message_id`) are inline.
- **Run migrations with `SET time_zone = '+00:00'`.** `DEFAULT CURRENT_TIMESTAMP(6)` and `ON UPDATE` are
  evaluated in the session time zone. The pool already sets UTC. Any other connection that writes, such as the
  migrator or the data migration script, must set it too.

## Type mapping as applied
| pg | MySQL | where |
|---|---|---|
| uuid | `CHAR(36)`, with `DEFAULT (UUID())` where pg used `gen_random_uuid()` | all ids |
| text | `TEXT`. Where the column is in a PK, UNIQUE, index or FK it becomes `VARCHAR(255)` (see below) | |
| text default `'x'::text` | `TEXT ... DEFAULT ('x')` (an expression default, because MySQL refuses a literal default on TEXT), or `VARCHAR ... DEFAULT 'x'` | |
| timestamptz | `DATETIME(6)`, and `now()` becomes `DEFAULT CURRENT_TIMESTAMP(6)` | |
| boolean | `TINYINT(1)`, with defaults `0`/`1` | |
| jsonb | `JSON`. `'{}'` becomes `(JSON_OBJECT())` and `'[]'` becomes `(JSON_ARRAY())`. The `flows.fallback_policy` default is rendered as a nested `JSON_OBJECT(...)` | |
| text[] | `JSON` array, with `'{}'` / `ARRAY[]` becoming `(JSON_ARRAY())` | `api_keys.scopes`, `webhook_endpoints.events`, `profiles.beta_features`, `storage_buckets.allowed_mime_types` |
| vector(1536) | `JSON` (float array). `SCHEMA` type is `'vector'` | `ai_knowledge_chunks.embedding` |
| tsvector | **dropped**. A FULLTEXT index replaces it | `ai_knowledge_chunks.fts` |
| account_role_enum | `ENUM('owner','admin','agent','viewer')` | `profiles.account_role`, `account_invitations.role` |
| numeric | `DECIMAL(12,2)` for `deals.value` and `DECIMAL(14,2)` for `companies.annual_revenue` | schema.json has no precision, so these come from migrations 001 and 061. A bare numeric with no known precision would become `DECIMAL(20,6)` |
| int4 / int8 / float8 / date | `INT` / `BIGINT` / `DOUBLE` / `DATE` | |

### Text columns that became `VARCHAR` (strict mode rejects longer values)
`VARCHAR(255)` unless noted:
- `auth_users.email`, `auth_sessions.id`, `auth_one_time_tokens.token_hash`
- `account_invitations.token_hash`, `api_keys.key_hash`
- `automations.trigger_type`, `flows.trigger_type`
- `broadcast_recipients.status`, `broadcast_recipients.whatsapp_message_id`
- `companies.name`. **A company name longer than 255 characters is now rejected.**
- `contacts.phone`, `contacts.phone_normalized`, `contacts.wa_user_id`
- `flow_nodes.node_key`, `flow_run_events.event_type`, `message_reactions.actor_type`
- `message_templates.name`, `message_templates.language`, `message_templates.meta_template_id`
- `messages.message_id`, `pending_message_statuses.wamid`, `pending_message_statuses.status`
- `tasks.status`, `views.object`, `whatsapp_config.phone_number_id`
- `storage_buckets.id` is `VARCHAR(191)`, `storage_objects.bucket_id` is `VARCHAR(191)`, and
  `storage_objects.name` is `VARCHAR(512)`. **Object paths longer than 512 characters are rejected.**

## Collation (semantic change)
Tables default to `utf8mb4_unicode_ci`, which is **case-insensitive and accent-insensitive**. Postgres text
comparison was case-sensitive.
- These opaque identifiers are `utf8mb4_bin`, so they keep exact, case-sensitive pg semantics:
  `auth_sessions.id`, `auth_one_time_tokens.token_hash`, `account_invitations.token_hash`, `api_keys.key_hash`,
  `api_keys.key_prefix`, `accounts.default_currency`, `messages.message_id`, `messages.interactive_reply_id`,
  `broadcast_recipients.whatsapp_message_id`, `pending_message_statuses.wamid`, `contacts.wa_user_id`,
  `contacts.wa_parent_user_id`, `message_templates.meta_template_id`, `message_templates.header_handle`,
  `whatsapp_config.phone_number_id`, `whatsapp_config.waba_id`, `flow_nodes.node_key`,
  `flow_runs.current_node_key`, `flow_run_events.node_key`, `flows.entry_node_id`, `storage_buckets.id`,
  `storage_objects.bucket_id` and `storage_objects.name`.
- Related identifier columns all have the same collation, so column-to-column joins never mix collations. When
  a `_bin` column is compared with a `_ci` column of the same charset, MySQL uses `_bin`. This was verified on
  8.4 with `SUBSTRING_INDEX(storage_objects.name,'/',1) = accounts.id`.
- Every other text column is case-insensitive:
  - `eq` / `neq` / `in` on them ignore case and accents: `'Foo' = 'foo'` and `'é' = 'e'`.
  - pg `like` was case-sensitive, so the builder should emit `col LIKE ? COLLATE utf8mb4_bin` for `like`, and
    plain `LIKE` for `ilike`.
  - UNIQUE keys on ci columns are case- and accent-insensitive: `auth_users.email`,
    `message_templates (account_id, name, language)` and `contacts (account_id, phone_normalized)`. For email
    this matches the pg `lower(email)` unique index. For template names it is stricter than pg, which is
    harmless because Meta template names are lower case.
  - The CHECK lists on status/kind/type columns accept other casings. For example `conversations.status = 'OPEN'`
    passes `IN ('open','pending','closed')`. The app always writes the lower-case constants, so this is not a
    problem in practice, but the DB no longer rejects a wrong casing.
- Both `_bin` and `_unicode_ci` are PAD SPACE collations in MySQL and MariaDB, so trailing spaces are ignored in
  `=` comparisons and unique keys: `'abc' = 'abc '`.

## UNIQUE rules
### Partial UNIQUE indexes that MySQL cannot enforce. App hooks must enforce these.
Each one is created as a plain (non-unique) index, or skipped where a plain index on the same columns already
exists. They are listed in `SCHEMA.tables.<t>.partialUnique`.

| table | pg index | rule to enforce (insert and update, in the same tx) |
|---|---|---|
| `contacts` | `idx_contacts_account_phone_normalized` | `(account_id, phone_normalized)` unique **when `phone_normalized <> ''`**. NULL and `''` may repeat. Comparison is case-insensitive (digits only in practice). On conflict, raise `23505` so `normalize/dedup` callers behave as before |
| `flow_runs` | `idx_one_active_run_per_contact` | at most one row per `(account_id, contact_id)` **with `status = 'active'`**. Check both on insert and on any update that sets `status='active'`. Lock with `SELECT ... FOR UPDATE` on the active rows for that contact, or on the contact row. The flow engine relies on this to stop two runs racing |
| `message_reactions` | `idx_message_reactions_one_agent_reaction` | at most one row per `message_id` **with `actor_type = 'agent'`**. (The full `UNIQUE (message_id, actor_type, actor_id)` is kept.) |

### Partial UNIQUE indexes kept as real UNIQUE (same semantics)
`WHERE col IS NOT NULL` on a key column is what a MySQL UNIQUE index does anyway, because NULLs are distinct:
- `broadcast_recipients.idx_broadcast_recipients_wamid` becomes `UNIQUE (whatsapp_message_id)`.
- `contacts.idx_contacts_account_wa_user_id` becomes `UNIQUE (account_id, wa_user_id)`.

### Upsert targets
Every `onConflict` the app uses maps to a real MySQL UNIQUE key or PK:
- `messages (conversation_id, message_id)`
- `message_reactions (message_id, actor_type, actor_id)`
- `contact_custom_values (contact_id, custom_field_id)`
- `contact_tags (contact_id, tag_id)`
- `pending_message_statuses (account_id, wamid, status)`
- `id`

MySQL `ON DUPLICATE KEY UPDATE` fires on **any** unique key, not just the named target. Tables with more than
one unique key are `whatsapp_config` (`account_id`, `phone_number_id`), `contacts` (`wa_user_id`),
`auth_users`, `accounts` and `storage_objects`. The builder must not assume the conflict came from
`onConflict` columns.

## Indexes
- **Partial indexes made full:** 19 indexes. The WHERE clause was dropped and the columns kept. They are
  `idx_account_invitations_account_pending`, `idx_automation_pending_awaiting_reply`,
  `idx_automation_pending_due`, `idx_automation_pending_stalled`, `idx_automation_steps_parent`,
  `idx_automations_account_active_trigger`, `idx_automations_active_trigger`, `idx_broadcasts_scheduled_due`,
  `idx_contacts_account_opted_out`, `idx_conversations_account_awaiting`, `idx_conversations_account_closed`,
  `idx_deals_account_closed`, `idx_flow_runs_active_advanced`, `idx_flows_account_active`,
  `idx_flows_active_trigger`, `idx_message_templates_meta_template_id`, `idx_messages_reply_to`,
  `idx_notifications_user_unread` and `idx_whatsapp_config_registered_at`. With staging's data volume (about 600
  rows) this does not matter. If volumes grow, prepend the predicate column, for example
  `(status, run_at)` for `idx_automation_pending_due`.
- **Expression indexes rewritten:**
  - `auth_users_email_lower_idx` (`lower(email)`) is not created. The `UNIQUE (email)` on a ci column already
    gives the same guarantee.
  - `idx_companies_account_name` (`account_id, lower(name)`) becomes `(account_id, name)`.
- **Skipped because a key on the same columns already exists:**
  - `auth_users_email_lower_idx` is covered by `auth_users_email_key`.
  - `api_keys_key_hash_idx` is covered by `UNIQUE api_keys_key_hash_key`.
  - `idx_whatsapp_config_account` is covered by `UNIQUE whatsapp_config_account_id_key`.
  - `idx_contacts_account_opted_out` is covered by `idx_contacts_account`.
  - `idx_flows_account_active` is covered by `idx_flows_account`.
  - `idx_message_reactions_one_agent_reaction` is covered by `idx_message_reactions_message` (it is also
    app-enforced, as above).
- **Skipped (no MySQL equivalent):** `ai_knowledge_chunks_embedding_idx`, an `hnsw (embedding vector_cosine_ops)`
  index.
- **Replaced:** `ai_knowledge_chunks_fts_idx` (`gin (fts)`) becomes `FULLTEXT KEY ai_knowledge_chunks_fts_idx (content)`.
- `DESC` key parts are kept. MySQL 8 honours them. MariaDB 10.6 parses `DESC` but ignores it, which is harmless.

## tsvector and vector
- `ai_knowledge_chunks.fts` was `GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED`. It is dropped, so
  `SCHEMA` has no `fts` column (it is listed in `droppedColumns`).
- `match_ai_knowledge_fts` should use
  `MATCH(content) AGAINST (? IN NATURAL LANGUAGE MODE)` (or BOOLEAN MODE) for both the filter and the rank.
  Differences from pg `'simple'`:
  - InnoDB ignores words shorter than `innodb_ft_min_token_size`, which defaults to 3. This server setting
    usually cannot be changed on shared hosting.
  - InnoDB applies its default stopword list. `'simple'` had no stopwords and no stemming, which also holds for
    InnoDB.
  - In natural-language mode a term that appears in more than half the rows scores low.
  - Scores are not comparable with `ts_rank`.
  - For very small knowledge bases, fall back to `LIKE '%term%'` when `MATCH` returns nothing.
- `ai_knowledge_chunks.embedding` is a `JSON` array of 1536 floats. There is no vector index, and
  `match_ai_knowledge` must compute cosine similarity in TS. Load the account's chunks, which is fine at this
  scale. The staging table has 0 rows.

## CHECK constraints
All 40 pg CHECKs are kept and enforced (MySQL 8.0.16+ and MariaDB 10.2+). **None were dropped.** These were
rewritten:
- `x = ANY (ARRAY['a'::text, ...])` becomes `x IN ('a', ...)` in 31 checks.
- `accounts_default_currency_format`: `default_currency ~ '^[A-Z]{3}$'` becomes
  `` `default_currency` REGEXP '^[A-Z]{3}$' ``. The column is `utf8mb4_bin` so the regex stays case-sensitive.
  Verified on 8.4 that `'usd'` is rejected.
- `ai_configs_openai_compatible_base_url_check` and `quick_replies_content_matches_kind`: `btrim(x)` becomes
  `TRIM(x)`. Both strip spaces only.
- `message_templates_buttons_shape_check`: `jsonb_typeof(buttons) = 'array' AND jsonb_array_length(buttons) <= 10`
  becomes `JSON_TYPE(buttons) = 'ARRAY' AND JSON_LENGTH(buttons) <= 10`. Verified on 8.4 that an object is
  rejected.
- `account_invitations_role_check`: `role <> 'owner'::account_role_enum` becomes `role <> 'owner'`.
- `quick_replies_content_matches_kind` was `NOT VALID` in pg, meaning existing rows were not checked. MySQL has
  no NOT VALID, so the check is fully enforced. The staging table has 0 rows, so this is safe.
- The case-insensitivity caveat under "Collation" applies to the IN-list checks.

## Foreign keys
- All 107 FKs are kept, with pg `ON DELETE CASCADE / SET NULL / RESTRICT`.
- Three FKs had no action in pg (`NO ACTION`): `deals.conversation_id`, `deals.stage_id` and
  `storage_objects.bucket_id`. They are emitted as `ON DELETE RESTRICT`. In MySQL NO ACTION and RESTRICT are
  the same and are checked immediately, whereas pg checks NO ACTION at the end of the statement. There is no
  practical difference here.
- **Cascades happen inside InnoDB.** Rows deleted or nulled by `ON DELETE CASCADE/SET NULL` do not pass through
  `hooks.ts` and produce no `events.ts` realtime events. pg's `realtime_notify` triggers did fire for cascaded
  rows. For example, deleting a conversation cascades to `messages`, `message_reactions` and `notifications`, and
  sets `flow_runs.conversation_id` to NULL. Deleting a contact cascades to `conversations` and `tasks`. If a UI depends on DELETE events for
  those child rows, the delete hook must emit them itself, for instance by selecting the children before the
  delete.
- InnoDB limits cascades to 15 levels. The deepest chain here is about 5 levels.

## Timestamps and defaults
- `updated_at` columns that pg kept current with a `BEFORE UPDATE` trigger (`update_updated_at_column`,
  `update_ai_configs_updated_at`, `update_ai_knowledge_documents_updated_at`) now have
  `ON UPDATE CURRENT_TIMESTAMP(6)`. This applies to 16 tables: accounts, ai_configs, ai_knowledge_documents,
  automations, broadcasts, companies, contacts, conversations, deals, flows, message_templates, profiles,
  quick_replies, tasks, views and whatsapp_config. `SCHEMA` marks these columns `onUpdateNow: true`.
- Differences from the pg trigger:
  - An explicit `updated_at` in the UPDATE wins over `ON UPDATE`.
  - `ON UPDATE` fires only when some column value actually changes. pg's trigger fired on every UPDATE.
  - `hooks.ts` does not need to set these columns, but setting them is harmless.
- `auth_users.updated_at`, `storage_buckets.updated_at` and `storage_objects.updated_at` had no trigger, so they
  get no `ON UPDATE`. `auth.ts` and `storage.ts` set them.
- `DEFAULT (UUID())` generates **v1 (time-based)** UUIDs in MySQL. pg's `gen_random_uuid()` produced v4. They
  are still unique, but they reveal creation time and host. The builder should fill `id` with
  `crypto.randomUUID()` before INSERT, as DESIGN.md says, so the DB default is only a fallback.
- `DATETIME(6)` has no time zone. Values are UTC wall time, and the codec must append `Z`.
- `DATETIME` cannot hold years outside 1000–9999.

## Other semantic notes
- **JSON:**
  - MySQL normalises JSON: object keys are sorted and duplicate keys are removed, the same as pg jsonb.
  - MariaDB stores JSON as LONGTEXT verbatim, with a `json_valid` CHECK.
  - Read JSON columns back through the codec, since mysql2 returns parsed JSON on MySQL but a string on MariaDB.
- **Arrays as JSON:**
  - `contains` / `cs` becomes `JSON_CONTAINS(col, ?)`.
  - `overlaps` / `ov` needs `JSON_OVERLAPS`, which exists in MySQL 8.0.17+ but **not in MariaDB 10.6**. Emulate
    it with an `OR` of `JSON_CONTAINS` calls.
- **Booleans** are `TINYINT(1)`. The codec maps 0/1 to `false`/`true`, and the builder must convert JS booleans
  in filters to 0/1.
- **ENUM:** in strict mode an unknown value is an error, as in pg. Sorting uses declaration order (owner, admin,
  agent, viewer), the same as pg enums.
- **DECIMAL** comes back from mysql2 as a string unless the codec converts it. `deals.value` and
  `companies.annual_revenue` now have fixed scale 2.
- **`member_presence`**: its PK is `user_id` only, as in pg, so a user has one presence row whatever the account.

## Verification
On MySQL 8.4.3 at 127.0.0.1:3307, database `wacrm_test`:
- The file was applied to an empty database and then applied again: no errors, and 45 tables.
- The resulting schema has 486 columns, 45 PKs, 19 UNIQUE keys, 107 FKs and 40 CHECKs.
- Smoke tests:
  - The UUID and JSON defaults fill in.
  - `fallback_policy` defaults to the full object.
  - `ON UPDATE` advances `updated_at`.
  - The currency regex rejects `usd`.
  - The buttons check rejects an object.
  - The quick-reply check rejects blank text.
  - The storage FK is case-sensitive.
  - `MATCH ... AGAINST` works on `ai_knowledge_chunks`.

**MariaDB 10.6 was not available locally, so it is untested.** The file avoids MySQL-only syntax: no
functional key parts, no `CHECK` subqueries, no `utf8mb4_0900_*` collations and no `JSON_OVERLAPS`. Features it
relies on that MariaDB documents as supported in 10.2 or later:
- expression defaults `(UUID())`, `(JSON_OBJECT())` and `('x')` on TEXT columns
- named CHECKs using `REGEXP`, `JSON_TYPE`, `JSON_LENGTH` and `TRIM`
- InnoDB `FULLTEXT`
