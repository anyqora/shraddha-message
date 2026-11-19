# wacrm on MySQL — port design

Goal: run this app (upstream `ArnasDon/wacrm` @ `c81299d`, the base the staging fork was built on) on
**MySQL 8.0+ / MariaDB 10.6+** (Hostinger shared hosting) with **no Supabase**. It must keep the same UI and
features as the staging fork (staging2.shikshaforall.com), including the staging-only features (Companies,
Tasks, opt-out, scheduled broadcasts, Excel import, SMTP mail, invitation tables).

## Sources of truth
- `docs/mysql-port/pg-schema/schema.json`: the live staging Postgres schema (tables, columns, constraints,
  indexes, triggers, RLS policies, row counts). `functions.sql` holds all function bodies and
  `triggers_policies.sql` holds all triggers and policies.
- `docs/mysql-port/staging-ref/db/migrations/*.sql`: the staging fork's Postgres migrations, including
  060–062, which are not in upstream.
- `docs/mysql-port/staging-ref/messages/*.json`: staging UI strings. They are a superset of upstream: +64 keys
  under Contacts, Broadcasts, Sidebar and Workspace.
- `/Users/keval/kk-projects/wacrm-staging-build/`: the staging compiled Next build (minified). Use it only as
  a behaviour reference for the staging-only features; it has no source.

## Architecture

```
browser components ──(supabase-js-like client shim)──► /api/db        (query JSON)  ─┐
                                                       /api/db/rpc    (rpc calls)    │
                                                       /api/auth/[action]            ├─► src/lib/db/* ──► MySQL
                                                       /api/storage/...              │
                                                       /api/realtime  (SSE)  ◄──event bus
server code ─────────(same builder, direct)──────────────────────────────────────────┘
```

Upstream code keeps calling `createClient()` from `@/lib/supabase/{client,server}`. Those modules now return
**our** client, which implements the subset of the supabase-js API the code actually uses, so the 200+ call
sites change very little.

### `src/lib/db/` (server only, `import 'server-only'`)
| file | role |
|---|---|
| `pool.ts` | mysql2/promise pool from `DATABASE_URL` (`mysql://user:pass@host:3306/db`). `query(sql, params)`, `tx(fn)`. Session `time_zone='+00:00'`. |
| `schema.generated.ts` | table → columns `{name, type, nullable, default}`, pk, foreign keys (for embeds). Generated from schema.json. |
| `types.ts` | value codecs: MySQL row ↔ the JSON shape supabase-js returned (ISO timestamps with `Z`, booleans as `true/false`, JSON columns parsed, numerics as numbers). |
| `builder.ts` | PostgREST-compatible query builder → parameterised SQL. Supports: `select` (columns, aliases `a:b`, embeds `rel(cols)`, `rel!inner(...)`, `{count:'exact', head:true}`), `insert` / `upsert({onConflict, ignoreDuplicates})` / `update` / `delete` + `.select()` returning, filters `eq neq gt gte lt lte like ilike is in contains or not match filter`, `order({ascending, nullsFirst, foreignTable})`, `limit`, `range`, `single`, `maybeSingle`. Returns `{ data, error, count, status }`, the same as supabase-js. Errors carry `code`. Use the PostgREST codes the app checks: `PGRST116` for no or many rows on `single()`, `23505` for unique violations. |
| `policies.ts` | replaces RLS. For each table: `read / insert / update / delete` → a SQL predicate plus params given an `AuthCtx {userId, accountIds, roles}`. `bypass` for admin/service code. |
| `hooks.ts` | replaces triggers. Per-table `beforeInsert / beforeUpdate / afterInsert / afterUpdate / afterDelete` in the same transaction as the write. |
| `rpc/*.ts` | TS versions of the plpgsql functions the app calls via `.rpc()`, plus internal ones the triggers used. |
| `events.ts` | in-process EventEmitter. The builder emits `{schema:'public', table, eventType, new, old}` after commit. Hostinger runs one Node process, so in-process is enough. |
| `auth.ts` | `auth_users` (scrypt `scrypt$N$r$p$salt$hash`, the same format staging used, so existing passwords keep working), `auth_sessions` (opaque token in an httpOnly cookie `sb-session`), sign up / in / out, password reset and email confirm tokens, `getUser()`. |
| `storage.ts` | files on disk under `STORAGE_DIR` (outside the deploy dir), metadata in `storage_objects`, buckets in `storage_buckets`. `upload / remove / getPublicUrl / createSignedUrl` as used. |

### Client shim: `src/lib/supabase/client.ts` (browser) and `server.ts` (server)
- Browser `from()` serialises the builder state to JSON and POSTs it to `/api/db`. The route rebuilds it with
  the server builder under the caller's AuthCtx, so policies always apply on the server.
- `rpc(name, args)` → `/api/db/rpc` (allow-listed names only).
- `auth.*` → `/api/auth/[action]`. `onAuthStateChange` is emulated client-side.
- `channel(name).on('postgres_changes', {event, schema, table, filter}, cb).subscribe()` → one shared
  `EventSource('/api/realtime')`. The server filters events by the subscriber's read policy and the
  `filter` (`col=eq.value`). `presence` / `broadcast` channel types are emulated through the same SSE plus POST.
- `admin.ts` / `createAdminClient()` → the server builder with `bypass` policies, for webhooks, cron and the
  service role.

## Type mapping (Postgres → MySQL)
| pg | mysql | note |
|---|---|---|
| uuid | `CHAR(36)` | default `(UUID())` (MySQL 8.0.13+ and MariaDB 10.2+ expression defaults); the builder also fills ids in JS when missing |
| text | `TEXT`, or `VARCHAR(n)` when indexed/unique (use 191 for utf8mb4 index-safe) | |
| varchar(n) | `VARCHAR(n)` | |
| timestamptz / timestamp | `DATETIME(6)` stored as UTC | `now()` → `CURRENT_TIMESTAMP(6)` |
| date | `DATE` | |
| boolean | `TINYINT(1)` | codec → bool |
| int4 / int8 / numeric | `INT` / `BIGINT` / `DECIMAL(p,s)` | |
| jsonb / json | `JSON` | MariaDB: JSON = LONGTEXT + CHECK; codec parses |
| text[] / uuid[] | `JSON` (array) | `contains` → `JSON_CONTAINS` |
| enum account_role_enum | `ENUM('owner','admin','agent','viewer')` | |
| vector(n) | `JSON` (float array) | cosine similarity computed in TS |
| tsvector / FTS | `FULLTEXT` index or `LIKE` fallback | |

Partial indexes are not supported in MySQL. Use full indexes, and enforce partial-unique rules in hooks.
Check constraints are kept where MySQL supports them.

Schemas: `auth.users` → `auth_users`, `auth.sessions` → `auth_sessions`, `storage.objects` →
`storage_objects`, `storage.buckets` → `storage_buckets`. Every `public.*` table keeps its name.

## Migrations
`db/mysql/migrations/NNNN_name.sql`, applied at startup by `src/lib/db/migrate.ts`, which tracks
`schema_migrations`. They must be idempotent and must run on MySQL 8.0 and MariaDB 10.6.

## Data migration
`scripts/migrate-from-postgres.mjs`: reads the staging Postgres (`OLD_DATABASE_URL`), converts the values and
inserts them into MySQL in FK order. It verifies row counts per table. The staging DB holds 582 rows, and
media files are copied from cPanel `~/anyqora-storage`.

## Env (Hostinger web app)
`DATABASE_URL` (mysql), `ENCRYPTION_KEY` (must be the staging one, because WhatsApp tokens in the DB are
encrypted with it), `META_APP_SECRET`, `AUTOMATION_CRON_SECRET`, `BROADCAST_CRON_SECRET`, `STORAGE_DIR`,
`NEXT_PUBLIC_SITE_URL`, `SMTP_URL`, `SMTP_FROM` (optional), `NEXT_PUBLIC_APP_LOCALE`.
