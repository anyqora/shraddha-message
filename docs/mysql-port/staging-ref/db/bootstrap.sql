-- ============================================================
-- Plain-PostgreSQL bootstrap.
--
-- Anyqora runs on stock PostgreSQL (no Supabase). The schema in
-- db/migrations/ was written against Supabase's conventions, so this
-- file — applied once, before any migration, by `npm run db:migrate` —
-- provides the handful of objects those migrations expect:
--
--   * roles  anon / authenticated / service_role  (NOLOGIN). The app
--     connects as the database owner and, per request, runs
--     `SET LOCAL ROLE authenticated` with the user's id in
--     `request.jwt.claims` — so the 164 RLS policies keep enforcing
--     tenancy exactly as before.
--   * auth.users + auth.uid() / auth.role() / auth.jwt(), plus our own
--     auth.sessions and auth.one_time_tokens (src/lib/auth-core).
--   * storage.buckets / storage.objects / storage.foldername() — file
--     bytes live on disk (STORAGE_DIR); these rows carry the metadata
--     and let the existing storage RLS policies gate access.
--   * an empty `supabase_realtime` publication so `ALTER PUBLICATION
--     … ADD TABLE` statements apply; db:migrate then attaches a NOTIFY
--     trigger to every table in it (src/lib/realtime).
--
-- Idempotent: safe to re-run.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

-- The connecting (owner) role must be able to SET ROLE to these.
DO $$
BEGIN
  EXECUTE format('GRANT anon, authenticated, service_role TO %I', current_user);
END
$$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

GRANT USAGE ON SCHEMA public, extensions, auth, storage TO anon, authenticated, service_role;

-- Supabase grants table/sequence/function privileges on `public` to the
-- API roles by default and relies on RLS for row access. Mirror that for
-- every object the migrations create.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- auth
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth.users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT UNIQUE,
  encrypted_password  TEXT,
  email_confirmed_at  TIMESTAMPTZ,
  raw_user_meta_data  JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_app_meta_data   JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_sign_in_at     TIMESTAMPTZ,
  banned_until        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_lower_idx ON auth.users (lower(email));

-- Session id is the SHA-256 of the cookie token; the token itself is
-- never stored.
CREATE TABLE IF NOT EXISTS auth.sessions (
  id           TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  user_agent   TEXT,
  ip           TEXT
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth.sessions (user_id);

-- Email confirmation / password recovery / invite links.
CREATE TABLE IF NOT EXISTS auth.one_time_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('signup', 'recovery', 'invite', 'email_change')),
  payload     JSONB,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_one_time_tokens_user_idx ON auth.one_time_tokens (user_id);

-- auth tables are never reachable through the API roles.
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM anon, authenticated;
GRANT SELECT ON auth.users TO service_role;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(auth.jwt() ->> 'role', 'service_role')
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT auth.jwt() ->> 'email'
$$;

GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid(), auth.role(), auth.email()
  TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- storage (metadata only — bytes live in STORAGE_DIR)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS storage.buckets (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  owner               UUID,
  public              BOOLEAN NOT NULL DEFAULT false,
  file_size_limit     BIGINT,
  allowed_mime_types  TEXT[],
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id   TEXT NOT NULL REFERENCES storage.buckets(id),
  name        TEXT NOT NULL,
  owner       UUID,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
GRANT ALL ON storage.objects TO authenticated, service_role;
GRANT SELECT ON storage.objects TO anon;

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;

CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;

CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT reverse(split_part(reverse(storage.filename(name)), '.', 1))
$$;

GRANT EXECUTE ON FUNCTION storage.foldername(text), storage.filename(text), storage.extension(text)
  TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- realtime
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

-- Row-change fan-out for src/lib/realtime: the payload carries the
-- table, operation and primary key; the SSE broker re-reads the row
-- under each subscriber's RLS before delivering it.
CREATE OR REPLACE FUNCTION public.realtime_notify() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec   jsonb;
  pk    jsonb := '{}'::jsonb;
  col   text;
BEGIN
  rec := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  FOREACH col IN ARRAY TG_ARGV LOOP
    pk := pk || jsonb_build_object(col, rec -> col);
  END LOOP;
  PERFORM pg_notify(
    'anyqora_realtime',
    jsonb_build_object(
      'table', TG_TABLE_NAME,
      'type', TG_OP,
      -- Only the primary key travels: INSERT/UPDATE rows are re-read
      -- under each subscriber's RLS, and a DELETE (which can't be
      -- re-read) exposes nothing beyond its key — same as Supabase.
      'pk', pk
    )::text
  );
  RETURN NULL;
END
$$;

-- Bookkeeping for scripts/db-migrate.mjs.
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON public.schema_migrations FROM anon, authenticated;
