-- 1) Marca telefones inválidos (fora da fila, sem apagar nada)
UPDATE public.contacts_queue
SET status = 'invalido'
WHERE status = 'pending'
  AND (phone IS NULL OR length(regexp_replace(phone, '\D', '', 'g')) < 10);

-- 2) Deduplica pendentes por corretor + telefone (mantém o mais relevante)
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY COALESCE(broker_id, '00000000-0000-0000-0000-000000000000'::uuid),
                        regexp_replace(phone, '\D', '', 'g')
           ORDER BY call_attempts DESC, last_called_at DESC NULLS LAST, created_at ASC, id ASC
         ) AS rn
  FROM public.contacts_queue
  WHERE status = 'pending'
)
UPDATE public.contacts_queue q
SET status = 'duplicado'
FROM ranked r
WHERE q.id = r.id AND r.rn > 1;

-- 3) Impede novas duplicatas pendentes
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contacts_queue_pending_broker_phone
  ON public.contacts_queue (
    COALESCE(broker_id, '00000000-0000-0000-0000-000000000000'::uuid),
    regexp_replace(phone, '\D', '', 'g')
  )
  WHERE status = 'pending';

-- 4) A sincronização a partir das ligações não pode ressuscitar duplicados/inválidos
CREATE OR REPLACE FUNCTION public.sync_contact_queue_from_calls(_contact_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer := 0;
  v_resolved boolean := false;
  v_last_called_at timestamptz := null;
BEGIN
  IF _contact_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(BOOL_OR(attended OR scheduled), false),
    MAX(created_at)
  INTO v_total, v_resolved, v_last_called_at
  FROM public.calls
  WHERE contact_id = _contact_id;

  UPDATE public.contacts_queue
  SET
    call_attempts = LEAST(v_total, 2),
    last_called_at = v_last_called_at,
    status = CASE
      WHEN contacts_queue.status IN ('duplicado', 'invalido') THEN contacts_queue.status
      WHEN contacts_queue.status = 'skipped' AND NOT v_resolved AND v_total < 2 THEN 'skipped'
      WHEN v_resolved OR v_total >= 2 THEN 'done'
      ELSE 'pending'
    END
  WHERE id = _contact_id;
END;
$function$;

-- 5) Fila: ignora telefone inválido
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
    AND (q.broker_id = _broker OR q.broker_id IS NULL)
    AND (_list_name IS NULL OR q.list_name = _list_name)
    AND NOT EXISTS (
      SELECT 1 FROM public.contacts_queue d
      WHERE d.phone = q.phone
        AND d.id <> q.id
        AND d.status = 'done'
        AND d.broker_id IS NOT DISTINCT FROM _broker
    )
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
    AND (q.broker_id = v_broker OR q.broker_id IS NULL)
    AND (_list_name IS NULL OR q.list_name = _list_name)
    AND NOT EXISTS (
      SELECT 1 FROM public.contacts_queue d
      WHERE d.phone = q.phone
        AND d.id <> q.id
        AND d.status = 'done'
        AND d.broker_id IS NOT DISTINCT FROM v_broker
    )
  ORDER BY
    (q.broker_id = v_broker) DESC,
    COALESCE(q.call_attempts, 0) ASC,
    q.priority DESC,
    q.created_at ASC,
    q.id ASC
  LIMIT GREATEST(1, LEAST(_limit, 50));
END;
$function$;

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
  WHERE (_broker IS NULL OR q.broker_id = _broker OR q.broker_id IS NULL)
  GROUP BY q.list_name
  ORDER BY q.list_name
$function$;

-- 6) Rotina de limpeza (presença travada, sessões abandonadas, lembretes vencidos)
CREATE OR REPLACE FUNCTION public.dialer_housekeeping()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_presence int := 0;
  v_sessions int := 0;
  v_reminders int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  WITH d AS (
    DELETE FROM public.active_calls WHERE updated_at < now() - interval '5 minutes' RETURNING 1
  ) SELECT COUNT(*) INTO v_presence FROM d;

  WITH d AS (
    DELETE FROM public.dialer_sessions WHERE updated_at < now() - interval '1 day' RETURNING 1
  ) SELECT COUNT(*) INTO v_sessions FROM d;

  WITH u AS (
    UPDATE public.call_reminders
    SET status = 'expired'
    WHERE status = 'pending' AND scheduled_for < now() - interval '1 day'
    RETURNING 1
  ) SELECT COUNT(*) INTO v_reminders FROM u;

  RETURN jsonb_build_object('presence', v_presence, 'sessions', v_sessions, 'reminders', v_reminders);
END;
$function$;