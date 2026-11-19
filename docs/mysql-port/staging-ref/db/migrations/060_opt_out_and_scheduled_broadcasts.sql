-- ============================================================
-- 060_opt_out_and_scheduled_broadcasts
--
-- Two features from the Anyqora panel spec:
--
--   1. Opt-out handling. A contact who replies STOP / UNSUBSCRIBE (or
--      is flagged manually from the contact page) is excluded from
--      every broadcast path: the dashboard wizard, the public API, and
--      the server-side resume / scheduled sender. START / SUBSCRIBE
--      clears the flag. Inbox conversations are unaffected — a customer
--      who opted out of marketing can still talk to an agent.
--
--   2. Scheduled broadcasts. `broadcasts.scheduled_at` and the
--      'scheduled' status have existed since 001 but nothing used them.
--      The wizard now writes a 'scheduled' row with frozen per-recipient
--      params, and GET /api/broadcasts/cron sends it when due.
--      `header_media_url` persists the image/video/document URL chosen
--      in the wizard so a deferred send of a media-header template uses
--      it (the browser that picked it is long gone by then).
--
-- Every statement is guarded so the file is safe to re-run.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS opted_out BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ,
  -- 'keyword' (customer replied STOP), 'manual' (agent toggled it),
  -- 'import' (CSV/Excel column). Free text, display only.
  ADD COLUMN IF NOT EXISTS opt_out_source TEXT;

-- Opted-out contacts are a small minority; a partial index keeps the
-- "who is opted out on this account" lookup cheap without bloating
-- the index for everyone else.
CREATE INDEX IF NOT EXISTS idx_contacts_account_opted_out
  ON contacts(account_id)
  WHERE opted_out;

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS header_media_url TEXT;

-- The cron sender's due-scan: status = 'scheduled' AND scheduled_at <= now().
CREATE INDEX IF NOT EXISTS idx_broadcasts_scheduled_due
  ON broadcasts(scheduled_at)
  WHERE status = 'scheduled';
