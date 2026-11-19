-- ============================================================
-- 061_companies_tasks_views
--
-- Objects behind the Twenty-style workspace:
--
--   companies       Organisations; contacts and deals can link to one.
--   tasks           To-dos with status / due date / assignee, linked to
--                   a contact, company and/or deal.
--   views           Saved record-table / kanban views per object
--                   (visible fields + order + widths, filters, sorts).
--
-- Same tenancy model as every other table (migration 017): rows carry
-- account_id, members read, agents+ write.
-- ============================================================

CREATE TABLE IF NOT EXISTS companies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  domain          TEXT,
  industry        TEXT,
  employees       INTEGER CHECK (employees IS NULL OR employees >= 0),
  annual_revenue  NUMERIC(14, 2),
  phone           TEXT,
  city            TEXT,
  country         TEXT,
  address         TEXT,
  linkedin_url    TEXT,
  website         TEXT,
  ideal_customer  BOOLEAN NOT NULL DEFAULT false,
  owner_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_companies_account ON companies(account_id);
CREATE INDEX IF NOT EXISTS idx_companies_account_name ON companies(account_id, lower(name));

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS city TEXT;
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);

ALTER TABLE deals ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id);

CREATE TABLE IF NOT EXISTS tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  status        TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  due_at        TIMESTAMPTZ,
  assignee_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_id    UUID REFERENCES contacts(id) ON DELETE CASCADE,
  company_id    UUID REFERENCES companies(id) ON DELETE CASCADE,
  deal_id       UUID REFERENCES deals(id) ON DELETE CASCADE,
  position      DOUBLE PRECISION NOT NULL DEFAULT 0,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_account ON tasks(account_id);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deal ON tasks(deal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(account_id, assignee_id, status);

-- completed_at follows status.
CREATE OR REPLACE FUNCTION public.tasks_stamp_completed_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'done' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'done') THEN
    NEW.completed_at := now();
  ELSIF NEW.status <> 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS tasks_stamp_completed_at ON tasks;
CREATE TRIGGER tasks_stamp_completed_at
  BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp_completed_at();

CREATE TABLE IF NOT EXISTS views (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  object        TEXT NOT NULL CHECK (object IN ('contacts', 'companies', 'tasks', 'deals')),
  name          TEXT NOT NULL,
  icon          TEXT,
  kind          TEXT NOT NULL DEFAULT 'table' CHECK (kind IN ('table', 'kanban')),
  -- [{ "key": "name", "visible": true, "width": 180 }, …] in display order
  fields        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{ "field": "status", "op": "is", "value": "todo" }, …] (ANDed)
  filters       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{ "field": "created_at", "direction": "desc" }, …]
  sorts         JSONB NOT NULL DEFAULT '[]'::jsonb,
  kanban_field  TEXT,
  position      DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_views_account_object ON views(account_id, object, position);

-- updated_at maintenance (function from migration 001).
DROP TRIGGER IF EXISTS set_updated_at ON companies;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at ON tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at ON views;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON views
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- RLS -------------------------------------------------------
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companies_select ON companies;
DROP POLICY IF EXISTS companies_insert ON companies;
DROP POLICY IF EXISTS companies_update ON companies;
DROP POLICY IF EXISTS companies_delete ON companies;
CREATE POLICY companies_select ON companies FOR SELECT USING (is_account_member(account_id));
CREATE POLICY companies_insert ON companies FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY companies_update ON companies FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY companies_delete ON companies FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS tasks_select ON tasks;
DROP POLICY IF EXISTS tasks_insert ON tasks;
DROP POLICY IF EXISTS tasks_update ON tasks;
DROP POLICY IF EXISTS tasks_delete ON tasks;
CREATE POLICY tasks_select ON tasks FOR SELECT USING (is_account_member(account_id));
CREATE POLICY tasks_insert ON tasks FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY tasks_update ON tasks FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY tasks_delete ON tasks FOR DELETE USING (is_account_member(account_id, 'agent'));

-- Views are shared workspace configuration: any member can read, and
-- (like Twenty) any agent+ can create or tweak them.
DROP POLICY IF EXISTS views_select ON views;
DROP POLICY IF EXISTS views_insert ON views;
DROP POLICY IF EXISTS views_update ON views;
DROP POLICY IF EXISTS views_delete ON views;
CREATE POLICY views_select ON views FOR SELECT USING (is_account_member(account_id));
CREATE POLICY views_insert ON views FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY views_update ON views FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY views_delete ON views FOR DELETE USING (is_account_member(account_id, 'agent'));

-- Realtime for the task list / boards.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
  END IF;
END
$$;
