
-- Required extensions for scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1) Reconciliation log table
CREATE TABLE IF NOT EXISTS public.queue_reconciliation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  contact_id uuid NOT NULL,
  broker_id uuid,
  contact_name text,
  expected_attempts int NOT NULL,
  stored_attempts int NOT NULL,
  expected_status text NOT NULL,
  stored_status text NOT NULL,
  resolved boolean NOT NULL,
  total_calls int NOT NULL,
  auto_fixed boolean NOT NULL DEFAULT true,
  details jsonb
);

CREATE INDEX IF NOT EXISTS idx_queue_recon_ran_at ON public.queue_reconciliation_log (ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_queue_recon_contact ON public.queue_reconciliation_log (contact_id, ran_at DESC);

GRANT SELECT ON public.queue_reconciliation_log TO authenticated;
GRANT ALL ON public.queue_reconciliation_log TO service_role;

ALTER TABLE public.queue_reconciliation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read recon log"
  ON public.queue_reconciliation_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2) Reconciliation function: scan, log mismatches, auto-fix
CREATE OR REPLACE FUNCTION public.reconcile_contact_queue()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scanned int := 0;
  v_mismatches int := 0;
  v_fixed int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT
      q.id              AS contact_id,
      q.broker_id,
      q.name            AS contact_name,
      q.call_attempts   AS stored_attempts,
      q.status          AS stored_status,
      COALESCE(c.total, 0)            AS total_calls,
      COALESCE(c.resolved, false)     AS resolved,
      LEAST(COALESCE(c.total, 0), 2)  AS expected_attempts,
      CASE
        WHEN q.status = 'skipped'
             AND NOT COALESCE(c.resolved, false)
             AND COALESCE(c.total, 0) < 2 THEN 'skipped'
        WHEN COALESCE(c.resolved, false) OR COALESCE(c.total, 0) >= 2 THEN 'done'
        ELSE 'pending'
      END AS expected_status,
      c.last_called_at
    FROM public.contacts_queue q
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS total,
        BOOL_OR(attended OR scheduled) AS resolved,
        MAX(created_at) AS last_called_at
      FROM public.calls
      WHERE contact_id = q.id
    ) c ON true
  LOOP
    v_scanned := v_scanned + 1;

    IF r.expected_attempts <> r.stored_attempts
       OR r.expected_status <> r.stored_status THEN
      v_mismatches := v_mismatches + 1;

      INSERT INTO public.queue_reconciliation_log (
        contact_id, broker_id, contact_name,
        expected_attempts, stored_attempts,
        expected_status, stored_status,
        resolved, total_calls, auto_fixed,
        details
      ) VALUES (
        r.contact_id, r.broker_id, r.contact_name,
        r.expected_attempts, r.stored_attempts,
        r.expected_status, r.stored_status,
        r.resolved, r.total_calls, true,
        jsonb_build_object('last_called_at', r.last_called_at)
      );

      -- Auto-fix via existing sync function (single source of truth)
      PERFORM public.sync_contact_queue_from_calls(r.contact_id);
      v_fixed := v_fixed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ran_at', now(),
    'scanned', v_scanned,
    'mismatches', v_mismatches,
    'fixed', v_fixed
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_contact_queue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_contact_queue() TO service_role;

-- 3) Admin-only RPC to trigger manually
CREATE OR REPLACE FUNCTION public.admin_run_queue_reconciliation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem rodar a reconciliação';
  END IF;
  RETURN public.reconcile_contact_queue();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_run_queue_reconciliation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_run_queue_reconciliation() TO authenticated;

-- 4) Admin-only RPC to read latest mismatches
CREATE OR REPLACE FUNCTION public.recent_queue_mismatches(_limit int DEFAULT 100)
RETURNS SETOF public.queue_reconciliation_log
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Apenas administradores podem consultar o log';
  END IF;
  RETURN QUERY
    SELECT * FROM public.queue_reconciliation_log
    ORDER BY ran_at DESC
    LIMIT GREATEST(1, LEAST(_limit, 500));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recent_queue_mismatches(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recent_queue_mismatches(int) TO authenticated;

-- 5) Schedule the job (every 10 minutes)
DO $$
BEGIN
  PERFORM cron.unschedule('queue-reconciliation');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'queue-reconciliation',
  '*/10 * * * *',
  $$ SELECT public.reconcile_contact_queue(); $$
);

-- 6) Cleanup of old log entries (older than 30 days), once a day
DO $$
BEGIN
  PERFORM cron.unschedule('queue-reconciliation-cleanup');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'queue-reconciliation-cleanup',
  '15 3 * * *',
  $$ DELETE FROM public.queue_reconciliation_log WHERE ran_at < now() - INTERVAL '30 days'; $$
);

-- 7) Run once immediately to populate baseline
SELECT public.reconcile_contact_queue();
