CREATE TABLE public.c2s_sync_state (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_run_at timestamptz,
  running_since timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  next_allowed_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  last_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.c2s_sync_state TO authenticated;
GRANT ALL ON public.c2s_sync_state TO service_role;

ALTER TABLE public.c2s_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view c2s sync state"
ON public.c2s_sync_state FOR SELECT TO authenticated USING (true);

INSERT INTO public.c2s_sync_state (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TRIGGER update_c2s_sync_state_updated_at
BEFORE UPDATE ON public.c2s_sync_state
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.c2s_sync_begin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  st public.c2s_sync_state;
BEGIN
  SELECT * INTO st FROM public.c2s_sync_state WHERE id = 1 FOR UPDATE;
  IF st IS NULL THEN
    INSERT INTO public.c2s_sync_state (id, running_since) VALUES (1, now());
    RETURN true;
  END IF;

  -- respeita janela de espera apos erros
  IF st.next_allowed_at > now() THEN
    RETURN false;
  END IF;

  -- evita execucoes simultaneas (lock de 5 minutos)
  IF st.running_since IS NOT NULL AND st.running_since > now() - interval '5 minutes' THEN
    RETURN false;
  END IF;

  UPDATE public.c2s_sync_state
     SET running_since = now()
   WHERE id = 1;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.c2s_sync_end(_ok boolean, _error text DEFAULT NULL, _result jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fails integer;
  backoff interval;
BEGIN
  SELECT consecutive_failures INTO fails FROM public.c2s_sync_state WHERE id = 1 FOR UPDATE;

  IF _ok THEN
    UPDATE public.c2s_sync_state
       SET running_since = NULL,
           last_run_at = now(),
           consecutive_failures = 0,
           next_allowed_at = now(),
           last_error = NULL,
           last_result = COALESCE(_result, last_result)
     WHERE id = 1;
  ELSE
    fails := COALESCE(fails, 0) + 1;
    backoff := make_interval(mins => LEAST(15, POWER(2, LEAST(fails, 4))::int));
    UPDATE public.c2s_sync_state
       SET running_since = NULL,
           last_run_at = now(),
           consecutive_failures = fails,
           next_allowed_at = now() + backoff,
           last_error = _error
     WHERE id = 1;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.c2s_sync_begin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.c2s_sync_end(boolean, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.c2s_sync_begin() TO service_role;
GRANT EXECUTE ON FUNCTION public.c2s_sync_end(boolean, text, jsonb) TO service_role;