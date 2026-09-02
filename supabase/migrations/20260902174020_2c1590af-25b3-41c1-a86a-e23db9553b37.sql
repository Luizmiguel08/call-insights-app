ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS cycle_started_at timestamptz;

CREATE OR REPLACE FUNCTION public.crm_register_lead_attempt(_lead_id uuid, _attended boolean, _result text DEFAULT NULL::text, _duration_seconds integer DEFAULT 0, _observation text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_broker uuid := public.current_broker_id();
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_lead public.crm_leads;
  v_period text := public.crm_current_period();
  v_total int;
  v_status text;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_has_manha boolean;
  v_has_tarde boolean;
  v_marker text;
  v_counted boolean := false;
  v_day_attended boolean;
  v_day_duration int;
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

  INSERT INTO public.crm_lead_attempts (lead_id, broker_id, user_id, period, result, duration_seconds, observation)
  VALUES (
    _lead_id,
    COALESCE(v_broker, v_lead.broker_id),
    auth.uid(),
    v_period,
    COALESCE(NULLIF(_result, ''), CASE WHEN _attended THEN 'atendeu' ELSE 'nao_atendeu' END),
    GREATEST(COALESCE(_duration_seconds, 0), 0),
    NULLIF(_observation, '')
  );

  SELECT COUNT(*) INTO v_total
  FROM public.crm_lead_attempts
  WHERE lead_id = _lead_id
    AND called_at >= COALESCE(v_lead.cycle_started_at, '-infinity'::timestamptz);

  v_status := v_lead.status;

  IF _attended THEN
    UPDATE public.crm_leads
    SET status = 'atendido', attended_at = now()
    WHERE id = _lead_id;
    v_status := 'atendido';
  ELSIF v_total >= 7 AND v_lead.status = 'novo' THEN
    UPDATE public.crm_leads
    SET status = 'fria', cold_at = now()
    WHERE id = _lead_id;
    v_status := 'fria';
  END IF;

  SELECT
    bool_or(period = 'manha'),
    bool_or(period = 'tarde'),
    bool_or(result = 'atendeu'),
    COALESCE(SUM(GREATEST(duration_seconds, 0)), 0)::int
  INTO v_has_manha, v_has_tarde, v_day_attended, v_day_duration
  FROM public.crm_lead_attempts
  WHERE lead_id = _lead_id AND attempt_date = v_today;

  IF COALESCE(v_has_manha, false) AND COALESCE(v_has_tarde, false) THEN
    v_marker := 'crm_lead:' || _lead_id::text || ':' || v_today::text;
    IF NOT EXISTS (SELECT 1 FROM public.calls WHERE notes = v_marker) THEN
      INSERT INTO public.calls (broker_id, client_name, phone, attended, scheduled, notes, duration_seconds, started_at, ended_at, created_by)
      VALUES (
        COALESCE(v_broker, v_lead.broker_id),
        v_lead.name,
        v_lead.phone,
        COALESCE(v_day_attended, false),
        false,
        v_marker,
        COALESCE(v_day_duration, 0),
        now(),
        now(),
        auth.uid()
      );
      v_counted := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'lead_id', _lead_id,
    'period', v_period,
    'attempts', v_total,
    'status', v_status,
    'counted_call', v_counted
  );
END;
$function$;

UPDATE public.crm_leads
SET status = 'novo', cold_at = NULL, cycle_started_at = now(), updated_at = now()
WHERE status = 'fria';