
-- View 1: KPIs diários por corretor, já deduplicados
CREATE OR REPLACE VIEW public.broker_kpis_daily
WITH (security_invoker=on) AS
WITH dedup AS (
  SELECT
    broker_id,
    (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS day,
    CASE
      WHEN regexp_replace(coalesce(phone,''), '\D', '', 'g') <> ''
        THEN 'p:' || regexp_replace(phone, '\D', '', 'g')
      WHEN lower(trim(coalesce(client_name,''))) <> ''
        THEN 'n:' || lower(trim(client_name))
      ELSE 'id:' || coalesce(contact_id::text, id::text)
    END AS contact_key,
    bool_or(attended)  AS attended,
    bool_or(scheduled) AS scheduled,
    sum(duration_seconds)                                    AS total_seconds,
    sum(duration_seconds) FILTER (WHERE attended)            AS attended_seconds,
    count(*) FILTER (WHERE attended)                         AS attended_attempts,
    count(*)                                                 AS attempts
  FROM public.calls
  GROUP BY 1, 2, 3
)
SELECT
  broker_id,
  day,
  count(*)::int                                                          AS calls,
  count(*) FILTER (WHERE attended)::int                                  AS attended,
  count(*) FILTER (WHERE scheduled)::int                                 AS scheduled,
  coalesce(sum(attempts), 0)::int                                        AS attempts,
  coalesce(sum(total_seconds), 0)::int                                   AS total_seconds,
  coalesce(sum(attended_seconds), 0)::int                                AS attended_seconds,
  coalesce(sum(attended_attempts), 0)::int                               AS attended_attempts
FROM dedup
GROUP BY broker_id, day;

GRANT SELECT ON public.broker_kpis_daily TO authenticated;
GRANT SELECT ON public.broker_kpis_daily TO service_role;

-- View 2: Distribuição horária pré-agregada
CREATE OR REPLACE VIEW public.broker_calls_hourly
WITH (security_invoker=on) AS
SELECT
  broker_id,
  (created_at AT TIME ZONE 'America/Sao_Paulo')::date              AS day,
  extract(hour FROM (created_at AT TIME ZONE 'America/Sao_Paulo'))::int AS hour,
  count(*)::int                                                    AS attempts
FROM public.calls
GROUP BY 1, 2, 3;

GRANT SELECT ON public.broker_calls_hourly TO authenticated;
GRANT SELECT ON public.broker_calls_hourly TO service_role;
