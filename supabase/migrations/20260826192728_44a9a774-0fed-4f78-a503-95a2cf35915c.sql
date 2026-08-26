CREATE OR REPLACE FUNCTION public.dialer_prefetch_queue(_broker uuid, _limit integer DEFAULT 10, _list_name text DEFAULT NULL::text)
RETURNS TABLE(id uuid, name text, phone text, list_name text, broker_id uuid, attempt_count integer, priority integer, created_at timestamp with time zone, last_attempt_result text, last_attempt_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT * FROM public.dialer_prefetch_queue(_limit, _list_name);
$function$;

GRANT EXECUTE ON FUNCTION public.dialer_prefetch_queue(uuid, integer, text) TO authenticated;