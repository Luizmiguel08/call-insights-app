
-- 1) app_settings: only admins can insert/update
DROP POLICY IF EXISTS "authenticated upsert app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "authenticated update app_settings" ON public.app_settings;

CREATE POLICY "admin insert app_settings" ON public.app_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin update app_settings" ON public.app_settings
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) user_roles: remove self-insert privilege escalation
DROP POLICY IF EXISTS "self insert corretor role" ON public.user_roles;

CREATE POLICY "admin manage user_roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Server-side gated role claim: a user gets the 'corretor' role only if an
-- admin has already linked a broker row to their auth user id.
CREATE OR REPLACE FUNCTION public.claim_corretor_role_if_eligible()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_has_broker boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'not_authenticated');
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.brokers WHERE user_id = v_uid)
    INTO v_has_broker;

  IF NOT v_has_broker THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'no_broker_link');
  END IF;

  INSERT INTO public.user_roles(user_id, role)
  VALUES (v_uid, 'corretor')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN jsonb_build_object('granted', true);
END;
$$;

-- 3) Fix mutable search_path on dialer_sessions_touch
CREATE OR REPLACE FUNCTION public.dialer_sessions_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 4) Lock down SECURITY DEFINER function EXECUTE perms.
--    By default Postgres grants EXECUTE to PUBLIC. Revoke from PUBLIC + anon,
--    then grant only the client-facing RPCs to authenticated.
REVOKE EXECUTE ON FUNCTION public.admin_clear_contacts(uuid, text, boolean, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_run_queue_reconciliation() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.broker_contact_lists(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.broker_daily_counts(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_broker_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dialer_prefetch_queue(integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_dialer_error(text, text, text, uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.next_contact_for_broker(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recent_dialer_errors(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recent_queue_mismatches(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reconcile_contact_queue() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_call_outcome(uuid, boolean, boolean, text, timestamptz, timestamptz, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_contact_queue_from_calls(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_sync_contact_queue_from_calls() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_corretor_role_if_eligible() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_clear_contacts(uuid, text, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_run_queue_reconciliation() TO authenticated;
GRANT EXECUTE ON FUNCTION public.broker_contact_lists(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.broker_daily_counts(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_broker_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_prefetch_queue(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_dialer_error(text, text, text, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_contact_for_broker(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recent_dialer_errors(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recent_queue_mismatches(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_contact_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_call_outcome(uuid, boolean, boolean, text, timestamptz, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_corretor_role_if_eligible() TO authenticated;

-- 5) Realtime channel authorization: scope subscriptions per-user/broker.
--    The app subscribes to channels named:
--      - dialer_session:<auth_uid>
--      - active_calls:<broker_id>
--      - postgres_changes filtered by user_id/broker_id (handled by RLS on the
--        underlying tables, not realtime.messages)
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth scoped realtime read" ON realtime.messages;
CREATE POLICY "auth scoped realtime read" ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    -- own dialer session channel
    realtime.topic() = 'dialer_session:' || auth.uid()::text
    OR
    -- active_calls channel for a broker linked to this user
    realtime.topic() IN (
      SELECT 'active_calls:' || b.id::text
        FROM public.brokers b
       WHERE b.user_id = auth.uid()
    )
    OR
    -- postgres_changes channels for tables governed by RLS
    realtime.topic() LIKE 'realtime:%'
  );

DROP POLICY IF EXISTS "auth scoped realtime write" ON realtime.messages;
CREATE POLICY "auth scoped realtime write" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    realtime.topic() = 'dialer_session:' || auth.uid()::text
  );
