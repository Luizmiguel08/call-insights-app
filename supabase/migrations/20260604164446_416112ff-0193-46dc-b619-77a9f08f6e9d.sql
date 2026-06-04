
CREATE TABLE public.dialer_error_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  user_email text,
  broker_id uuid,
  broker_name text,
  list_name text,
  contact_id uuid,
  contact_name text,
  action text,
  error_message text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.dialer_error_log TO authenticated;
GRANT ALL ON public.dialer_error_log TO service_role;

ALTER TABLE public.dialer_error_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read dialer errors"
  ON public.dialer_error_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "auth insert own dialer errors"
  ON public.dialer_error_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE INDEX dialer_error_log_created_at_idx ON public.dialer_error_log (created_at DESC);

CREATE OR REPLACE FUNCTION public.log_dialer_error(
  _action text,
  _error_message text,
  _list_name text DEFAULT NULL,
  _contact_id uuid DEFAULT NULL,
  _contact_name text DEFAULT NULL,
  _details jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_broker_id uuid;
  v_broker_name text;
  v_id uuid;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  SELECT id, name INTO v_broker_id, v_broker_name FROM public.brokers WHERE user_id = v_uid LIMIT 1;

  INSERT INTO public.dialer_error_log (
    user_id, user_email, broker_id, broker_name,
    list_name, contact_id, contact_name, action, error_message, details
  ) VALUES (
    v_uid, v_email, v_broker_id, v_broker_name,
    _list_name, _contact_id, _contact_name, _action, _error_message, _details
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recent_dialer_errors(_limit integer DEFAULT 200)
RETURNS SETOF public.dialer_error_log
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem consultar o log de erros';
  END IF;
  RETURN QUERY
    SELECT * FROM public.dialer_error_log
    ORDER BY created_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 1000));
END;
$$;
