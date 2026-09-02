CREATE OR REPLACE FUNCTION public.crm_expire_cold_leads()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_moved int := 0;
BEGIN
  WITH u AS (
    UPDATE public.crm_leads l
    SET status = 'fria', cold_at = now(), updated_at = now()
    WHERE l.status = 'novo'
      AND (
        SELECT count(*) FROM public.crm_lead_attempts a
        WHERE a.lead_id = l.id
          AND (l.cycle_started_at IS NULL OR a.called_at >= l.cycle_started_at)
      ) >= 7
    RETURNING 1
  ) SELECT COUNT(*) INTO v_moved FROM u;

  RETURN jsonb_build_object('moved', v_moved);
END;
$function$;