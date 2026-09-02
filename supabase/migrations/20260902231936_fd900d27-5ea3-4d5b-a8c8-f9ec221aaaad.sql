CREATE TABLE IF NOT EXISTS public.crm_lead_coverages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  broker_id uuid REFERENCES public.brokers(id),
  status text NOT NULL DEFAULT 'COBERTURA_INICIADA',
  first_attempt_id uuid,
  first_period text NOT NULL,
  first_called_at timestamptz NOT NULL,
  second_attempt_id uuid,
  second_period text,
  second_called_at timestamptz,
  expires_at timestamptz NOT NULL,
  attempt_number integer,
  cycle_started_at timestamptz,
  counted_call_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.crm_lead_coverages TO authenticated;
GRANT ALL ON public.crm_lead_coverages TO service_role;

ALTER TABLE public.crm_lead_coverages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coverages_select_own_or_admin" ON public.crm_lead_coverages;
CREATE POLICY "coverages_select_own_or_admin"
ON public.crm_lead_coverages FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR broker_id = public.current_broker_id());

CREATE INDEX IF NOT EXISTS idx_crm_lead_coverages_lead ON public.crm_lead_coverages(lead_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_lead_coverages_open ON public.crm_lead_coverages(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_crm_lead_coverages_broker ON public.crm_lead_coverages(broker_id);

DROP TRIGGER IF EXISTS trg_crm_lead_coverages_updated_at ON public.crm_lead_coverages;
CREATE TRIGGER trg_crm_lead_coverages_updated_at
BEFORE UPDATE ON public.crm_lead_coverages
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.crm_expire_coverages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_n int := 0;
BEGIN
  WITH u AS (
    UPDATE public.crm_lead_coverages
    SET status = 'COBERTURA_EXPIRADA', updated_at = now()
    WHERE status = 'COBERTURA_INICIADA' AND expires_at <= now()
    RETURNING 1
  ) SELECT COUNT(*) INTO v_n FROM u;
  RETURN v_n;
END;
$$;

DO $$
DECLARE
  r record;
  v_open public.crm_lead_coverages;
  v_num int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.crm_lead_coverages LIMIT 1) THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT a.id, a.lead_id, a.broker_id, a.period, a.called_at, l.cycle_started_at
    FROM public.crm_lead_attempts a
    JOIN public.crm_leads l ON l.id = a.lead_id
    ORDER BY a.lead_id, a.called_at ASC
  LOOP
    UPDATE public.crm_lead_coverages
    SET status = 'COBERTURA_EXPIRADA'
    WHERE lead_id = r.lead_id AND status = 'COBERTURA_INICIADA' AND expires_at <= r.called_at;

    v_open := NULL;
    SELECT * INTO v_open FROM public.crm_lead_coverages
    WHERE lead_id = r.lead_id AND status = 'COBERTURA_INICIADA' AND expires_at > r.called_at
    ORDER BY first_called_at ASC LIMIT 1;

    IF v_open.id IS NOT NULL AND v_open.first_period IS DISTINCT FROM r.period THEN
      SELECT COUNT(*) + 1 INTO v_num
      FROM public.crm_lead_coverages
      WHERE lead_id = r.lead_id
        AND status = 'COBERTURA_CONCLUIDA'
        AND second_called_at >= COALESCE(r.cycle_started_at, '-infinity'::timestamptz);

      UPDATE public.crm_lead_coverages
      SET status = 'COBERTURA_CONCLUIDA',
          second_attempt_id = r.id,
          second_period = r.period,
          second_called_at = r.called_at,
          attempt_number = v_num,
          cycle_started_at = r.cycle_started_at
      WHERE id = v_open.id;
    ELSIF v_open.id IS NULL THEN
      INSERT INTO public.crm_lead_coverages (
        lead_id, broker_id, status, first_attempt_id, first_period, first_called_at, expires_at, cycle_started_at
      ) VALUES (
        r.lead_id, r.broker_id, 'COBERTURA_INICIADA', r.id, r.period, r.called_at,
        r.called_at + interval '24 hours', r.cycle_started_at
      );
    END IF;
  END LOOP;

  UPDATE public.crm_lead_coverages
  SET status = 'COBERTURA_EXPIRADA'
  WHERE status = 'COBERTURA_INICIADA' AND expires_at <= now();
END;
$$;

CREATE OR REPLACE VIEW public.crm_lead_coverage_state
WITH (security_invoker = on) AS
SELECT
  l.id AS lead_id,
  l.broker_id,
  COALESCE(done.total, 0)::int AS attempts_done,
  oc.id AS open_coverage_id,
  oc.first_period AS open_first_period,
  oc.first_called_at AS open_first_called_at,
  oc.expires_at AS open_expires_at,
  last_c.first_called_at AS last_first_called_at,
  last_c.second_called_at AS last_second_called_at,
  last_c.attempt_number AS last_attempt_number
FROM public.crm_leads l
LEFT JOIN LATERAL (
  SELECT COUNT(*)::int AS total
  FROM public.crm_lead_coverages c
  WHERE c.lead_id = l.id
    AND c.status = 'COBERTURA_CONCLUIDA'
    AND c.second_called_at >= COALESCE(l.cycle_started_at, '-infinity'::timestamptz)
) done ON true
LEFT JOIN LATERAL (
  SELECT c.* FROM public.crm_lead_coverages c
  WHERE c.lead_id = l.id AND c.status = 'COBERTURA_INICIADA' AND c.expires_at > now()
  ORDER BY c.first_called_at ASC LIMIT 1
) oc ON true
LEFT JOIN LATERAL (
  SELECT c.* FROM public.crm_lead_coverages c
  WHERE c.lead_id = l.id AND c.status = 'COBERTURA_CONCLUIDA'
  ORDER BY c.second_called_at DESC LIMIT 1
) last_c ON true;

GRANT SELECT ON public.crm_lead_coverage_state TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_register_lead_attempt(
  _lead_id uuid,
  _attended boolean,
  _result text DEFAULT NULL::text,
  _duration_seconds integer DEFAULT 0,
  _observation text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_broker uuid := public.current_broker_id();
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_lead public.crm_leads;
  v_period text := public.crm_current_period();
  v_attempt_id uuid;
  v_now timestamptz := now();
  v_open public.crm_lead_coverages;
  v_cov_id uuid;
  v_cov_status text;
  v_attempts int;
  v_status text;
  v_counted boolean := false;
  v_call_id uuid;
  v_first_at timestamptz;
  v_second_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_lead FROM public.crm_leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_admin AND v_lead.broker_id IS DISTINCT FROM v_broker THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.crm_lead_attempts (lead_id, broker_id, user_id, period, result, duration_seconds, observation, called_at)
  VALUES (
    _lead_id,
    COALESCE(v_broker, v_lead.broker_id),
    auth.uid(),
    v_period,
    COALESCE(NULLIF(_result, ''), CASE WHEN _attended THEN 'atendeu' ELSE 'nao_atendeu' END),
    GREATEST(COALESCE(_duration_seconds, 0), 0),
    NULLIF(_observation, ''),
    v_now
  ) RETURNING id INTO v_attempt_id;

  UPDATE public.crm_lead_coverages
  SET status = 'COBERTURA_EXPIRADA'
  WHERE lead_id = _lead_id AND status = 'COBERTURA_INICIADA' AND expires_at <= v_now;

  v_open := NULL;
  SELECT * INTO v_open FROM public.crm_lead_coverages
  WHERE lead_id = _lead_id AND status = 'COBERTURA_INICIADA' AND expires_at > v_now
  ORDER BY first_called_at ASC LIMIT 1 FOR UPDATE;

  IF v_open.id IS NOT NULL AND v_open.first_period IS DISTINCT FROM v_period THEN
    SELECT COUNT(*) + 1 INTO v_attempts
    FROM public.crm_lead_coverages
    WHERE lead_id = _lead_id
      AND status = 'COBERTURA_CONCLUIDA'
      AND second_called_at >= COALESCE(v_lead.cycle_started_at, '-infinity'::timestamptz);

    UPDATE public.crm_lead_coverages
    SET status = 'COBERTURA_CONCLUIDA',
        second_attempt_id = v_attempt_id,
        second_period = v_period,
        second_called_at = v_now,
        attempt_number = v_attempts,
        cycle_started_at = v_lead.cycle_started_at,
        updated_at = now()
    WHERE id = v_open.id;

    v_cov_id := v_open.id;
    v_cov_status := 'COBERTURA_CONCLUIDA';
    v_first_at := v_open.first_called_at;
    v_second_at := v_now;

    IF NOT EXISTS (SELECT 1 FROM public.calls WHERE notes = 'cobertura:' || v_open.id::text) THEN
      INSERT INTO public.calls (broker_id, client_name, phone, attended, scheduled, notes, duration_seconds, started_at, ended_at, created_by)
      VALUES (
        COALESCE(v_broker, v_lead.broker_id),
        v_lead.name, v_lead.phone,
        _attended, false,
        'cobertura:' || v_open.id::text,
        GREATEST(COALESCE(_duration_seconds, 0), 0),
        v_now, v_now, auth.uid()
      ) RETURNING id INTO v_call_id;
      UPDATE public.crm_lead_coverages SET counted_call_id = v_call_id WHERE id = v_open.id;
      v_counted := true;
    END IF;
  ELSIF v_open.id IS NULL THEN
    INSERT INTO public.crm_lead_coverages (
      lead_id, broker_id, status, first_attempt_id, first_period, first_called_at, expires_at, cycle_started_at
    ) VALUES (
      _lead_id, COALESCE(v_broker, v_lead.broker_id), 'COBERTURA_INICIADA',
      v_attempt_id, v_period, v_now, v_now + interval '24 hours', v_lead.cycle_started_at
    ) RETURNING id INTO v_cov_id;
    v_cov_status := 'COBERTURA_INICIADA';
    v_first_at := v_now;
  ELSE
    v_cov_id := v_open.id;
    v_cov_status := 'COBERTURA_INICIADA';
    v_first_at := v_open.first_called_at;
  END IF;

  SELECT COUNT(*) INTO v_attempts
  FROM public.crm_lead_coverages
  WHERE lead_id = _lead_id
    AND status = 'COBERTURA_CONCLUIDA'
    AND second_called_at >= COALESCE(v_lead.cycle_started_at, '-infinity'::timestamptz);

  v_status := v_lead.status;

  IF _attended THEN
    UPDATE public.crm_leads SET status = 'atendido', attended_at = now() WHERE id = _lead_id;
    v_status := 'atendido';
  ELSIF v_attempts >= 7 AND v_lead.status = 'novo' THEN
    UPDATE public.crm_leads SET status = 'fria', cold_at = now() WHERE id = _lead_id;
    v_status := 'fria';
  END IF;

  RETURN jsonb_build_object(
    'lead_id', _lead_id,
    'period', v_period,
    'attempts', v_attempts,
    'status', v_status,
    'counted_call', v_counted,
    'coverage_id', v_cov_id,
    'coverage_status', v_cov_status,
    'coverage_first_called_at', v_first_at,
    'coverage_second_called_at', v_second_at,
    'coverage_expires_at', CASE WHEN v_cov_status = 'COBERTURA_INICIADA' THEN v_first_at + interval '24 hours' ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_expire_cold_leads()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_moved int := 0;
BEGIN
  PERFORM public.crm_expire_coverages();

  WITH u AS (
    UPDATE public.crm_leads l
    SET status = 'fria', cold_at = now(), updated_at = now()
    WHERE l.status = 'novo'
      AND (
        SELECT count(*) FROM public.crm_lead_coverages c
        WHERE c.lead_id = l.id
          AND c.status = 'COBERTURA_CONCLUIDA'
          AND c.second_called_at >= COALESCE(l.cycle_started_at, '-infinity'::timestamptz)
      ) >= 7
    RETURNING 1
  ) SELECT COUNT(*) INTO v_moved FROM u;

  RETURN jsonb_build_object('moved', v_moved);
END;
$$;
