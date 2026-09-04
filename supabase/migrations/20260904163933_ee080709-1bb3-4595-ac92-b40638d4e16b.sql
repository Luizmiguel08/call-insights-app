
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

  IF v_open.id IS NOT NULL AND (v_open.first_period IS DISTINCT FROM v_period OR _attended) THEN
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
      _lead_id, COALESCE(v_broker, v_lead.broker_id),
      CASE WHEN _attended THEN 'COBERTURA_CONCLUIDA' ELSE 'COBERTURA_INICIADA' END,
      v_attempt_id, v_period, v_now, v_now + interval '24 hours', v_lead.cycle_started_at
    ) RETURNING id INTO v_cov_id;
    v_cov_status := CASE WHEN _attended THEN 'COBERTURA_CONCLUIDA' ELSE 'COBERTURA_INICIADA' END;
    v_first_at := v_now;
  ELSE
    v_cov_id := v_open.id;
    v_cov_status := 'COBERTURA_INICIADA';
    v_first_at := v_open.first_called_at;
  END IF;

  -- Atendimento conta imediatamente na meta diária (1 ligação registrada).
  IF _attended AND NOT v_counted THEN
    IF NOT EXISTS (SELECT 1 FROM public.calls WHERE notes = 'atendido:' || v_attempt_id::text) THEN
      INSERT INTO public.calls (broker_id, client_name, phone, attended, scheduled, notes, duration_seconds, started_at, ended_at, created_by)
      VALUES (
        COALESCE(v_broker, v_lead.broker_id),
        v_lead.name, v_lead.phone,
        true, false,
        'atendido:' || v_attempt_id::text,
        GREATEST(COALESCE(_duration_seconds, 0), 0),
        v_now, v_now, auth.uid()
      ) RETURNING id INTO v_call_id;
      IF v_cov_id IS NOT NULL THEN
        UPDATE public.crm_lead_coverages
        SET counted_call_id = COALESCE(counted_call_id, v_call_id)
        WHERE id = v_cov_id;
      END IF;
      v_counted := true;
    END IF;
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
$function$;

-- Recupera as ligações atendidas dos últimos 7 dias que não geraram registro em calls.
INSERT INTO public.calls (broker_id, client_name, phone, attended, scheduled, notes, duration_seconds, started_at, ended_at, created_by)
SELECT a.broker_id, l.name, l.phone, true, false, 'atendido:' || a.id::text,
       GREATEST(COALESCE(a.duration_seconds, 0), 0), a.called_at, a.called_at, a.user_id
FROM public.crm_lead_attempts a
JOIN public.crm_leads l ON l.id = a.lead_id
WHERE a.result = 'atendeu'
  AND a.called_at >= now() - interval '7 days'
  AND a.broker_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.notes = 'atendido:' || a.id::text)
  AND NOT EXISTS (
    SELECT 1 FROM public.crm_lead_coverages cv
    JOIN public.calls c2 ON c2.notes = 'cobertura:' || cv.id::text
    WHERE cv.second_attempt_id = a.id
  );
