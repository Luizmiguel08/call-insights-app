
-- dialer_sessions: single source of truth for live dialer state per user
CREATE TABLE public.dialer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  current_contact_id uuid,
  call_status text NOT NULL DEFAULT 'idle' CHECK (call_status IN ('idle','calling','answered','ended')),
  call_started_at timestamptz,
  observation text NOT NULL DEFAULT '',
  device_origin text CHECK (device_origin IN ('mobile','desktop')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dialer_sessions TO authenticated;
GRANT ALL ON public.dialer_sessions TO service_role;

ALTER TABLE public.dialer_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own session" ON public.dialer_sessions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.dialer_sessions_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dialer_sessions_touch
  BEFORE UPDATE ON public.dialer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.dialer_sessions_touch();

ALTER PUBLICATION supabase_realtime ADD TABLE public.dialer_sessions;
ALTER TABLE public.dialer_sessions REPLICA IDENTITY FULL;

-- contact_attempts: immutable history of every dialer action
CREATE TABLE public.contact_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker_id uuid,
  result text NOT NULL CHECK (result IN ('no_answer','answered','scheduled','skipped','return_later')),
  attempt_number int NOT NULL,
  observation text,
  called_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contact_attempts_contact ON public.contact_attempts(contact_id);
CREATE INDEX idx_contact_attempts_user ON public.contact_attempts(user_id, called_at DESC);

GRANT SELECT, INSERT ON public.contact_attempts TO authenticated;
GRANT ALL ON public.contact_attempts TO service_role;

ALTER TABLE public.contact_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own attempts" ON public.contact_attempts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users read own attempts" ON public.contact_attempts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- RPC: prefetch next N contacts with attempt_count JOIN
CREATE OR REPLACE FUNCTION public.dialer_prefetch_queue(_limit int DEFAULT 10, _list_name text DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  list_name text,
  broker_id uuid,
  attempt_count int,
  priority int,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broker uuid;
BEGIN
  v_broker := public.current_broker_id();
  IF v_broker IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    q.id,
    q.name,
    q.phone,
    q.list_name,
    q.broker_id,
    COALESCE(q.call_attempts, 0)::int AS attempt_count,
    q.priority,
    q.created_at
  FROM public.contacts_queue q
  WHERE q.status = 'pending'
    AND q.call_attempts < 2
    AND (q.broker_id = v_broker OR q.broker_id IS NULL)
    AND (_list_name IS NULL OR q.list_name = _list_name)
  ORDER BY
    (q.broker_id = v_broker) DESC,
    q.priority DESC,
    q.created_at ASC,
    q.id ASC
  LIMIT GREATEST(1, LEAST(_limit, 50));
END;
$$;

GRANT EXECUTE ON FUNCTION public.dialer_prefetch_queue(int, text) TO authenticated;
