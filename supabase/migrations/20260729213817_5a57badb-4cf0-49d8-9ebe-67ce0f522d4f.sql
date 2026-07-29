-- 1. Realtime nas tabelas que faltavam
ALTER TABLE public.call_reminders REPLICA IDENTITY FULL;
ALTER TABLE public.contact_attempts REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='call_reminders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_reminders;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='contact_attempts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_attempts;
  END IF;
END $$;

-- 2. Presença da equipe: todos autenticados podem VER quem está ligando
DROP POLICY IF EXISTS "read team active calls" ON public.active_calls;
CREATE POLICY "read team active calls"
  ON public.active_calls FOR SELECT
  TO authenticated
  USING (true);

-- 3. Limpa presenças travadas (rows antigas do discador anterior)
DELETE FROM public.active_calls WHERE updated_at < now() - interval '10 minutes';

-- 4. Upsert de presença ("estou ligando para X neste aparelho")
CREATE OR REPLACE FUNCTION public.dialer_presence_set(
  _contact_id uuid,
  _contact_name text,
  _phone text DEFAULT NULL,
  _device_label text DEFAULT 'Dispositivo'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_broker uuid := public.current_broker_id();
BEGIN
  IF v_broker IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.active_calls (broker_id, contact_id, contact_name, phone, device_label, started_at, updated_at)
  VALUES (v_broker, _contact_id, COALESCE(NULLIF(_contact_name,''), 'Contato'), _phone, COALESCE(NULLIF(_device_label,''), 'Dispositivo'), now(), now())
  ON CONFLICT (broker_id) DO UPDATE
    SET contact_id   = EXCLUDED.contact_id,
        contact_name = EXCLUDED.contact_name,
        phone        = EXCLUDED.phone,
        device_label = EXCLUDED.device_label,
        started_at   = CASE
                         WHEN public.active_calls.contact_id IS DISTINCT FROM EXCLUDED.contact_id
                         THEN now() ELSE public.active_calls.started_at
                       END,
        updated_at   = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.dialer_presence_clear()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_broker uuid := public.current_broker_id();
BEGIN
  IF v_broker IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM public.active_calls WHERE broker_id = v_broker;
END;
$function$;

REVOKE ALL ON FUNCTION public.dialer_presence_set(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dialer_presence_clear() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dialer_presence_set(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dialer_presence_clear() TO authenticated;