-- Habilita extensões necessárias (idempotente)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Função que será chamada pelo cron a cada 5 minutos
CREATE OR REPLACE FUNCTION public.c2s_sync_cron_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _secret text;
BEGIN
  -- Lê o segredo do vault (view descriptografada)
  SELECT decrypted_secret INTO _secret
    FROM vault.decrypted_secrets
   WHERE name = 'c2s_sync_shared_secret'
   LIMIT 1;

  IF _secret IS NULL OR _secret = '' THEN
    RAISE WARNING '[c2s_sync_cron_tick] Segredo c2s_sync_shared_secret não encontrado no vault. Pulando.';
    RETURN;
  END IF;

  -- Dispara a requisição HTTP via pg_net
  PERFORM net.http_post(
    url := 'https://call-insights-app.lovable.app/api/public/c2s-sync?horas=3',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', _secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

-- Restringe execução apenas a service_role e postgres
REVOKE ALL ON FUNCTION public.c2s_sync_cron_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.c2s_sync_cron_tick() TO service_role;

-- Remove job anterior se existir (idempotente)
SELECT cron.unschedule(jobid)
  FROM cron.job
 WHERE jobname = 'c2s-sync-periodico';

-- Agenda a cada 5 minutos
SELECT cron.schedule(
  'c2s-sync-periodico',
  '*/5 * * * *',
  $$SELECT public.c2s_sync_cron_tick()$$
);
