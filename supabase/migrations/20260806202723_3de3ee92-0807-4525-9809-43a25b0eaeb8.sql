CREATE OR REPLACE FUNCTION public.broker_contact_lists(_broker uuid DEFAULT NULL::uuid)
 RETURNS TABLE(list_name text, total integer, pending integer, done integer, skipped integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    q.list_name,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (
      WHERE q.status = 'pending'
        AND q.call_attempts < 2
        AND length(regexp_replace(COALESCE(q.phone, ''), '\D', '', 'g')) >= 10
        AND NOT EXISTS (
          SELECT 1 FROM public.contacts_queue d
          WHERE d.phone = q.phone
            AND d.id <> q.id
            AND d.status = 'done'
            AND d.broker_id IS NOT DISTINCT FROM _broker
        )
    )::int AS pending,
    COUNT(*) FILTER (WHERE q.status = 'done')::int AS done,
    COUNT(*) FILTER (WHERE q.status = 'skipped')::int AS skipped
  FROM public.contacts_queue q
  WHERE (_broker IS NULL OR q.broker_id = _broker)
  GROUP BY q.list_name
  ORDER BY q.list_name
$function$;

CREATE OR REPLACE FUNCTION public.dialer_prefetch_queue(_limit integer DEFAULT 10, _list_name text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, name text, phone text, list_name text, broker_id uuid, attempt_count integer, priority integer, created_at timestamp with time zone, last_attempt_result text, last_attempt_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_broker uuid;
BEGIN
  v_broker := public.current_broker_id();
  IF v_broker IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    q.id,
    q.name,
    q.phone,
    q.list_name,
    q.broker_id,
    COALESCE(q.call_attempts, 0)::int AS attempt_count,
    q.priority,
    q.created_at,
    la.result    AS last_attempt_result,
    la.called_at AS last_attempt_at
  FROM public.contacts_queue q
  LEFT JOIN LATERAL (
    SELECT ca.result, ca.called_at
    FROM public.contact_attempts ca
    WHERE ca.contact_id = q.id
    ORDER BY ca.called_at DESC
    LIMIT 1
  ) la ON true
  WHERE q.status = 'pending'
    AND q.call_attempts < 2
    AND length(regexp_replace(COALESCE(q.phone, ''), '\D', '', 'g')) >= 10
    AND q.broker_id = v_broker
    AND (_list_name IS NULL OR q.list_name = _list_name)
    AND NOT EXISTS (
      SELECT 1 FROM public.contacts_queue d
      WHERE d.phone = q.phone
        AND d.id <> q.id
        AND d.status = 'done'
        AND d.broker_id IS NOT DISTINCT FROM v_broker
    )
  ORDER BY
    COALESCE(q.call_attempts, 0) ASC,
    q.priority DESC,
    q.created_at ASC,
    q.id ASC
  LIMIT GREATEST(1, LEAST(_limit, 50));
END;
$function$;

CREATE OR REPLACE FUNCTION public.next_contact_for_broker(_broker uuid, _list_name text DEFAULT NULL::text)
 RETURNS contacts_queue
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.contacts_queue;
BEGIN
  IF _broker IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row
  FROM public.contacts_queue q
  WHERE q.status = 'pending'
    AND q.call_attempts < 2
    AND length(regexp_replace(COALESCE(q.phone, ''), '\D', '', 'g')) >= 10
    AND q.broker_id = _broker
    AND (_list_name IS NULL OR q.list_name = _list_name)
    AND NOT EXISTS (
      SELECT 1 FROM public.contacts_queue d
      WHERE d.phone = q.phone
        AND d.id <> q.id
        AND d.status = 'done'
        AND d.broker_id IS NOT DISTINCT FROM _broker
    )
  ORDER BY
    COALESCE(q.call_attempts, 0) ASC,
    q.priority DESC,
    q.created_at ASC,
    q.id ASC
  LIMIT 1;

  RETURN v_row;
END;
$function$;