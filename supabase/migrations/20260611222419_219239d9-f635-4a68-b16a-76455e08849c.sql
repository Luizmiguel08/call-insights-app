
CREATE TABLE public.call_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id uuid NOT NULL REFERENCES public.brokers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid,
  contact_name text NOT NULL,
  contact_phone text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending',
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_reminders_status_check CHECK (status IN ('pending','done','snoozed','dismissed'))
);

CREATE INDEX call_reminders_broker_status_time_idx
  ON public.call_reminders (broker_id, status, scheduled_for);
CREATE INDEX call_reminders_user_idx ON public.call_reminders (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_reminders TO authenticated;
GRANT ALL ON public.call_reminders TO service_role;

ALTER TABLE public.call_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Brokers manage own reminders"
  ON public.call_reminders
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_call_reminders_updated_at
  BEFORE UPDATE ON public.call_reminders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
