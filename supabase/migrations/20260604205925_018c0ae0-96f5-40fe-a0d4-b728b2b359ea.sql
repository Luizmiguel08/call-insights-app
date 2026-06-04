
CREATE TABLE public.active_calls (
  broker_id uuid PRIMARY KEY,
  contact_id uuid,
  contact_name text NOT NULL,
  phone text,
  device_label text NOT NULL DEFAULT 'Dispositivo',
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.active_calls TO authenticated;
GRANT ALL ON public.active_calls TO service_role;

ALTER TABLE public.active_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rw own active call"
  ON public.active_calls
  FOR ALL
  TO authenticated
  USING (broker_id = public.current_broker_id() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (broker_id = public.current_broker_id() OR public.has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE public.active_calls REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.active_calls;
