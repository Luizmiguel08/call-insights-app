
-- 1. Drop overly permissive public policies
DROP POLICY IF EXISTS "public all broker_pauses" ON public.broker_pauses;
DROP POLICY IF EXISTS "public all broker_sessions" ON public.broker_sessions;
DROP POLICY IF EXISTS "public read brokers" ON public.brokers;
DROP POLICY IF EXISTS "public write brokers" ON public.brokers;
DROP POLICY IF EXISTS "public update brokers" ON public.brokers;
DROP POLICY IF EXISTS "public delete brokers" ON public.brokers;
DROP POLICY IF EXISTS "public read calls" ON public.calls;
DROP POLICY IF EXISTS "public write calls" ON public.calls;
DROP POLICY IF EXISTS "public update calls" ON public.calls;
DROP POLICY IF EXISTS "public delete calls" ON public.calls;
DROP POLICY IF EXISTS "public all contacts_queue" ON public.contacts_queue;

-- 2. Add audit column for who created each row (shared workspace)
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.contacts_queue ADD COLUMN IF NOT EXISTS created_by uuid;

-- 3. Revoke anon, grant authenticated on shared tables
REVOKE ALL ON public.brokers FROM anon;
REVOKE ALL ON public.calls FROM anon;
REVOKE ALL ON public.contacts_queue FROM anon;
REVOKE ALL ON public.broker_sessions FROM anon;
REVOKE ALL ON public.broker_pauses FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brokers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calls TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broker_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.broker_pauses TO authenticated;

GRANT ALL ON public.brokers TO service_role;
GRANT ALL ON public.calls TO service_role;
GRANT ALL ON public.contacts_queue TO service_role;
GRANT ALL ON public.broker_sessions TO service_role;
GRANT ALL ON public.broker_pauses TO service_role;

-- 4. Shared-workspace policies: any authenticated user has full access
CREATE POLICY "authenticated full access brokers" ON public.brokers
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full access calls" ON public.calls
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full access contacts_queue" ON public.contacts_queue
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full access broker_sessions" ON public.broker_sessions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated full access broker_pauses" ON public.broker_pauses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. App-wide settings (shared meta diária etc.)
CREATE TABLE IF NOT EXISTS public.app_settings (
  id text PRIMARY KEY DEFAULT 'global',
  meta_daily integer NOT NULL DEFAULT 50,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read app_settings" ON public.app_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated upsert app_settings" ON public.app_settings
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "authenticated update app_settings" ON public.app_settings
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.app_settings (id, meta_daily) VALUES ('global', 50)
  ON CONFLICT (id) DO NOTHING;
