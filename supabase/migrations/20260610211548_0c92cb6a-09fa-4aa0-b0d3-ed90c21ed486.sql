CREATE OR REPLACE FUNCTION public.next_contact_for_broker(_broker uuid, _list_name text DEFAULT NULL)
RETURNS public.contacts_queue
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
    AND (q.broker_id = _broker OR q.broker_id IS NULL)
    AND (_list_name IS NULL OR q.list_name = _list_name)
  ORDER BY
    (q.broker_id = _broker) DESC,
    COALESCE(q.call_attempts, 0) ASC,
    q.priority DESC,
    q.created_at ASC,
    q.id ASC
  LIMIT 1;

  RETURN v_row;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.next_contact_for_broker(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_contact_for_broker(uuid, text) TO authenticated;