
-- 1) Nova coluna list_name
ALTER TABLE public.contacts_queue
  ADD COLUMN IF NOT EXISTS list_name text NOT NULL DEFAULT 'Geral';

CREATE INDEX IF NOT EXISTS idx_contacts_queue_list ON public.contacts_queue (list_name);
CREATE INDEX IF NOT EXISTS idx_contacts_queue_broker_list_status
  ON public.contacts_queue (broker_id, list_name, status, priority DESC, created_at ASC, id ASC);

-- 2) Limpeza em massa (server-side, sem URL limit)
CREATE OR REPLACE FUNCTION public.admin_clear_contacts(
  _broker_id uuid DEFAULT NULL,    -- NULL = qualquer corretor (admin); para corretor, força o próprio
  _list_name text DEFAULT NULL,    -- NULL = qualquer lista
  _only_done boolean DEFAULT false,
  _include_general boolean DEFAULT false  -- quando _broker_id é setado, incluir contatos sem dono (broker_id IS NULL)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_my_broker uuid := public.current_broker_id();
  v_target_broker uuid;
  v_deleted int := 0;
BEGIN
  IF NOT v_is_admin AND v_my_broker IS NULL THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  -- Corretor só pode limpar a própria fila
  IF v_is_admin THEN
    v_target_broker := _broker_id;
  ELSE
    v_target_broker := v_my_broker;
  END IF;

  WITH deleted AS (
    DELETE FROM public.contacts_queue q
    WHERE
      (_list_name IS NULL OR q.list_name = _list_name)
      AND (NOT _only_done OR q.status <> 'pending')
      AND (
        v_target_broker IS NULL
        OR q.broker_id = v_target_broker
        OR (_include_general AND q.broker_id IS NULL)
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM deleted;

  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_clear_contacts(uuid, text, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_clear_contacts(uuid, text, boolean, boolean) TO authenticated;

-- 3) Listas disponíveis por corretor
CREATE OR REPLACE FUNCTION public.broker_contact_lists(_broker uuid DEFAULT NULL)
RETURNS TABLE (
  list_name text,
  total int,
  pending int,
  done int,
  skipped int
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    q.list_name,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE q.status = 'pending')::int AS pending,
    COUNT(*) FILTER (WHERE q.status = 'done')::int AS done,
    COUNT(*) FILTER (WHERE q.status = 'skipped')::int AS skipped
  FROM public.contacts_queue q
  WHERE (_broker IS NULL OR q.broker_id = _broker OR q.broker_id IS NULL)
  GROUP BY q.list_name
  ORDER BY q.list_name
$$;

REVOKE EXECUTE ON FUNCTION public.broker_contact_lists(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.broker_contact_lists(uuid) TO authenticated;

-- 4) Próximo contato com filtro opcional por lista
CREATE OR REPLACE FUNCTION public.next_contact_for_broker(_broker uuid, _list_name text DEFAULT NULL)
RETURNS public.contacts_queue
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.contacts_queue;
  v_retry_id uuid;
BEGIN
  IF _broker IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT c.contact_id INTO v_retry_id
  FROM public.calls c
  JOIN public.contacts_queue q ON q.id = c.contact_id
  WHERE c.broker_id = _broker
    AND c.contact_id IS NOT NULL
    AND c.attended = false
    AND c.scheduled = false
    AND q.status = 'pending'
    AND q.call_attempts < 2
    AND (q.broker_id = _broker OR q.broker_id IS NULL)
    AND (_list_name IS NULL OR q.list_name = _list_name)
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_retry_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.contacts_queue WHERE id = v_retry_id;
    RETURN v_row;
  END IF;

  SELECT * INTO v_row
  FROM public.contacts_queue
  WHERE status = 'pending'
    AND call_attempts < 2
    AND (broker_id = _broker OR broker_id IS NULL)
    AND (_list_name IS NULL OR list_name = _list_name)
  ORDER BY
    (broker_id = _broker) DESC,
    priority DESC,
    created_at ASC,
    id ASC
  LIMIT 1;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.next_contact_for_broker(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_contact_for_broker(uuid, text) TO authenticated;
