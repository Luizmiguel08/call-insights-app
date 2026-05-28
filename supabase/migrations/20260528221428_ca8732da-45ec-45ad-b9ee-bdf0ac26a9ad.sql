
CREATE TABLE public.brokers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.calls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  broker_id UUID NOT NULL REFERENCES public.brokers(id) ON DELETE CASCADE,
  client_name TEXT NOT NULL,
  phone TEXT,
  attended BOOLEAN NOT NULL DEFAULT false,
  scheduled BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_calls_broker_created ON public.calls(broker_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.brokers TO anon, authenticated;
GRANT ALL ON public.brokers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calls TO anon, authenticated;
GRANT ALL ON public.calls TO service_role;

ALTER TABLE public.brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read brokers" ON public.brokers FOR SELECT USING (true);
CREATE POLICY "public write brokers" ON public.brokers FOR INSERT WITH CHECK (true);
CREATE POLICY "public update brokers" ON public.brokers FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "public delete brokers" ON public.brokers FOR DELETE USING (true);

CREATE POLICY "public read calls" ON public.calls FOR SELECT USING (true);
CREATE POLICY "public write calls" ON public.calls FOR INSERT WITH CHECK (true);
CREATE POLICY "public update calls" ON public.calls FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "public delete calls" ON public.calls FOR DELETE USING (true);

INSERT INTO public.brokers (name, color) VALUES
  ('Jean', '#ef4444'),
  ('Maria', '#3b82f6'),
  ('Carlos', '#10b981');
