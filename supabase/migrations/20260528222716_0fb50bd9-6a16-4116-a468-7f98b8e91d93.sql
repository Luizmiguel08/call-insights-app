
-- Add outcome enum and column to calls
CREATE TYPE public.call_outcome AS ENUM (
  'attended', 'no_answer', 'voicemail', 'wrong_number', 'callback', 'not_interested', 'scheduled'
);

ALTER TABLE public.calls
  ADD COLUMN outcome public.call_outcome,
  ADD COLUMN contact_id uuid;

-- Contact queue
CREATE TABLE public.contacts_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL,
  broker_id uuid REFERENCES public.brokers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  priority int NOT NULL DEFAULT 0,
  notes text,
  last_called_at timestamptz,
  call_attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts_queue TO anon, authenticated;
GRANT ALL ON public.contacts_queue TO service_role;

ALTER TABLE public.contacts_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public all contacts_queue" ON public.contacts_queue FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_contacts_queue_status ON public.contacts_queue(status, broker_id, priority DESC, created_at);

-- Broker sessions
CREATE TABLE public.broker_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  broker_id uuid NOT NULL REFERENCES public.brokers(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.broker_sessions TO anon, authenticated;
GRANT ALL ON public.broker_sessions TO service_role;

ALTER TABLE public.broker_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public all broker_sessions" ON public.broker_sessions FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_broker_sessions_broker ON public.broker_sessions(broker_id, started_at DESC);

-- Broker pauses
CREATE TABLE public.broker_pauses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.broker_sessions(id) ON DELETE CASCADE,
  broker_id uuid NOT NULL REFERENCES public.brokers(id) ON DELETE CASCADE,
  reason text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.broker_pauses TO anon, authenticated;
GRANT ALL ON public.broker_pauses TO service_role;

ALTER TABLE public.broker_pauses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public all broker_pauses" ON public.broker_pauses FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_broker_pauses_session ON public.broker_pauses(session_id);
CREATE INDEX idx_broker_pauses_broker ON public.broker_pauses(broker_id, started_at DESC);
