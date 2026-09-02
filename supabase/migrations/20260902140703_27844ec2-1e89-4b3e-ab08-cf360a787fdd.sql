CREATE OR REPLACE VIEW public.crm_lead_attempt_totals
WITH (security_invoker = on) AS
  SELECT
    a.lead_id,
    COUNT(*)::int AS total_attempts,
    MAX(a.called_at) AS last_called_at
  FROM public.crm_lead_attempts a
  GROUP BY a.lead_id;

GRANT SELECT ON public.crm_lead_attempt_totals TO authenticated;
GRANT SELECT ON public.crm_lead_attempt_totals TO service_role;

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

  SELECT COUNT(*) INTO v_total FROM public.crm_lead_attempts WHERE lead_id = _lead_id;

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

  RETURN jsonb_build_object(
    'lead_id', _lead_id,
    'period', v_period,
    'attempts', v_total,
    'status', v_status
  );
END;
$function$;