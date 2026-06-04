
-- ============================================================
-- Server-authoritative dialer: queue lock + accurate counters
-- ============================================================

-- 1) Helpful indexes for queue & counters
CREATE INDEX IF NOT EXISTS idx_contacts_queue_broker_status
  ON public.contacts_queue (broker_id, status, priority DESC, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_contacts_queue_unassigned_status
  ON public.contacts_queue (status, priority DESC, created_at ASC, id ASC)
  WHERE broker_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_calls_broker_created
  ON public.calls (broker_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_contact
  ON public.calls (contact_id);

-- 2) Next contact for a broker (retry-aware, 1-pending-at-a-time view)
CREATE OR REPLACE FUNCTION public.next_contact_for_broker(_broker uuid)
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

  -- Retry: most recent unresolved call whose contact still has attempts < 2
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
  ORDER BY c.created_at DESC
  LIMIT 1;

  IF v_retry_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.contacts_queue WHERE id = v_retry_id;
    RETURN v_row;
  END IF;

  -- Otherwise: next pending (assigned first, then unassigned), oldest first
  SELECT * INTO v_row
  FROM public.contacts_queue
  WHERE status = 'pending'
    AND call_attempts < 2
    AND (broker_id = _broker OR broker_id IS NULL)
  ORDER BY
    (broker_id = _broker) DESC,
    priority DESC,
    created_at ASC,
    id ASC
  LIMIT 1;

  RETURN v_row;
END;
$$;

-- 3) Atomic call recording: inserts call, updates queue, returns next contact
CREATE OR REPLACE FUNCTION public.record_call_outcome(
  _contact_id uuid,
  _attended boolean,
  _scheduled boolean,
  _notes text DEFAULT NULL,
  _started_at timestamptz DEFAULT NULL,
  _ended_at timestamptz DEFAULT NULL,
  _duration_seconds integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broker uuid;
  v_contact public.contacts_queue;
  v_call_id uuid;
  v_next public.contacts_queue;
  v_attempts_after int;
BEGIN
  v_broker := public.current_broker_id();
  IF v_broker IS NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Sem corretor associado ao usuário';
  END IF;

  SELECT * INTO v_contact FROM public.contacts_queue WHERE id = _contact_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contato % não encontrado', _contact_id;
  END IF;

  -- Claim if unassigned
  IF v_contact.broker_id IS NULL AND v_broker IS NOT NULL THEN
    UPDATE public.contacts_queue SET broker_id = v_broker WHERE id = _contact_id;
    v_contact.broker_id := v_broker;
  END IF;

  -- Block extra clicks if already finalized
  IF v_contact.status <> 'pending' OR v_contact.call_attempts >= 2 THEN
    SELECT * INTO v_next FROM public.next_contact_for_broker(v_broker);
    RETURN jsonb_build_object(
      'inserted', false,
      'contact_id', v_contact.id,
      'attempts', v_contact.call_attempts,
      'status', v_contact.status,
      'next', CASE WHEN v_next.id IS NULL THEN NULL ELSE to_jsonb(v_next) END
    );
  END IF;

  INSERT INTO public.calls (
    broker_id, client_name, phone, attended, scheduled, notes,
    contact_id, created_by, started_at, ended_at, duration_seconds
  ) VALUES (
    COALESCE(v_contact.broker_id, v_broker),
    v_contact.name, v_contact.phone,
    COALESCE(_attended, false), COALESCE(_scheduled, false),
    NULLIF(_notes, ''),
    v_contact.id, auth.uid(),
    _started_at, _ended_at, COALESCE(_duration_seconds, 0)
  ) RETURNING id INTO v_call_id;

  -- Trigger sync_contact_queue_from_calls already updated attempts/status.
  SELECT call_attempts INTO v_attempts_after FROM public.contacts_queue WHERE id = _contact_id;

  SELECT * INTO v_next FROM public.next_contact_for_broker(v_broker);

  RETURN jsonb_build_object(
    'inserted', true,
    'call_id', v_call_id,
    'contact_id', _contact_id,
    'attempts', v_attempts_after,
    'next', CASE WHEN v_next.id IS NULL THEN NULL ELSE to_jsonb(v_next) END
  );
END;
$$;

-- 4) Accurate broker daily counters (server-side truth)
CREATE OR REPLACE FUNCTION public.broker_daily_counts(_broker uuid, _date date DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'attempts',  COUNT(*),
    'attended',  COUNT(*) FILTER (WHERE attended),
    'scheduled', COUNT(*) FILTER (WHERE scheduled),
    'unique_contacts', COUNT(DISTINCT contact_id)
  )
  FROM public.calls
  WHERE broker_id = _broker
    AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date = _date
$$;

-- 5) Permissions
REVOKE EXECUTE ON FUNCTION public.record_call_outcome(uuid, boolean, boolean, text, timestamptz, timestamptz, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_contact_for_broker(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.broker_daily_counts(uuid, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_call_outcome(uuid, boolean, boolean, text, timestamptz, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_contact_for_broker(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.broker_daily_counts(uuid, date) TO authenticated;
