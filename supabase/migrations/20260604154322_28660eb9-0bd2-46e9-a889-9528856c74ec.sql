CREATE OR REPLACE FUNCTION public.sync_contact_queue_from_calls(_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      WHEN contacts_queue.status = 'skipped' AND NOT v_resolved AND v_total < 2 THEN 'skipped'
      WHEN v_resolved OR v_total >= 2 THEN 'done'
      ELSE 'pending'
    END
  WHERE id = _contact_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_contact_queue_from_calls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_contact_queue_from_calls(OLD.contact_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.contact_id IS DISTINCT FROM NEW.contact_id THEN
    PERFORM public.sync_contact_queue_from_calls(OLD.contact_id);
  END IF;

  PERFORM public.sync_contact_queue_from_calls(NEW.contact_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_contact_queue_from_calls_on_write ON public.calls;

CREATE TRIGGER sync_contact_queue_from_calls_on_write
AFTER INSERT OR UPDATE OR DELETE ON public.calls
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_contact_queue_from_calls();

DO $$
DECLARE
  v_contact_id uuid;
BEGIN
  FOR v_contact_id IN
    SELECT DISTINCT contact_id
    FROM public.calls
    WHERE contact_id IS NOT NULL
  LOOP
    PERFORM public.sync_contact_queue_from_calls(v_contact_id);
  END LOOP;
END;
$$;