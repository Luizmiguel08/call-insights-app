
CREATE OR REPLACE FUNCTION public.record_call_outcome(_contact_id uuid, _attended boolean, _scheduled boolean, _notes text DEFAULT NULL::text, _started_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _ended_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _duration_seconds integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_broker uuid;
  v_contact public.contacts_queue;
  v_call_id uuid;
  v_next public.contacts_queue;
  v_attempts_after int;
  v_recent_call_id uuid;
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

  -- DEDUPE: bloqueia inserção dupla se já existe uma chamada para este contato
  -- pelo mesmo usuário nos últimos 5 segundos (defesa contra duplo clique /
  -- cliques simultâneos em múltiplos dispositivos).
  SELECT id INTO v_recent_call_id
  FROM public.calls
  WHERE contact_id = _contact_id
    AND created_by = auth.uid()
    AND created_at > now() - interval '5 seconds'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_recent_call_id IS NOT NULL THEN
    SELECT * INTO v_next FROM public.next_contact_for_broker(v_broker);
    SELECT call_attempts INTO v_attempts_after FROM public.contacts_queue WHERE id = _contact_id;
    RETURN jsonb_build_object(
      'inserted', false,
      'deduped', true,
      'call_id', v_recent_call_id,
      'contact_id', _contact_id,
      'attempts', v_attempts_after,
      'next', CASE WHEN v_next.id IS NULL THEN NULL ELSE to_jsonb(v_next) END
    );
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
$function$;
