
-- 1) Coluna gerada de categoria de duração em calls
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS duration_category text
  GENERATED ALWAYS AS (
    CASE
      WHEN duration_seconds IS NULL OR duration_seconds = 0 THEN 'sem_registro'
      WHEN duration_seconds < 4   THEN 'fantasma'
      WHEN duration_seconds < 60  THEN 'curta'
      WHEN duration_seconds < 180 THEN 'media'
      ELSE 'longa'
    END
  ) STORED;

-- 2) Índices para relatórios
CREATE INDEX IF NOT EXISTS idx_calls_broker_duration_category
  ON public.calls (broker_id, duration_category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_calls_broker_duration_seconds
  ON public.calls (broker_id, duration_seconds, created_at DESC);

-- 3) View de estatísticas diárias de duração (últimos 30 dias)
--    security_invoker garante que as policies de `calls` sejam aplicadas
--    ao leitor da view (corretor vê o próprio; admin vê tudo).
CREATE OR REPLACE VIEW public.call_duration_stats
  WITH (security_invoker = true)
AS
SELECT
  c.broker_id,
  b.name AS corretor_nome,
  (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,

  COUNT(*)::int AS total_ligacoes,
  COUNT(*) FILTER (WHERE c.duration_category = 'fantasma')::int    AS ligacoes_fantasma,
  COUNT(*) FILTER (WHERE c.duration_category = 'curta')::int       AS ligacoes_curtas,
  COUNT(*) FILTER (WHERE c.duration_category = 'media')::int       AS ligacoes_medias,
  COUNT(*) FILTER (WHERE c.duration_category = 'longa')::int       AS ligacoes_longas,
  COUNT(*) FILTER (WHERE c.duration_category = 'sem_registro')::int AS sem_registro,

  ROUND(
    COUNT(*) FILTER (WHERE c.duration_category = 'fantasma')::numeric
    / NULLIF(COUNT(*), 0) * 100, 1
  ) AS pct_fantasma,
  ROUND(
    COUNT(*) FILTER (WHERE c.duration_category = 'curta')::numeric
    / NULLIF(COUNT(*), 0) * 100, 1
  ) AS pct_curta,
  ROUND(
    COUNT(*) FILTER (WHERE c.duration_seconds >= 60)::numeric
    / NULLIF(COUNT(*), 0) * 100, 1
  ) AS pct_qualidade,

  ROUND(AVG(c.duration_seconds) FILTER (WHERE c.duration_seconds > 0))::int AS duracao_media_segundos,
  MAX(c.duration_seconds)                                                     AS duracao_maxima_segundos,
  MIN(c.duration_seconds) FILTER (WHERE c.duration_seconds > 0)              AS duracao_minima_segundos
FROM public.calls c
JOIN public.brokers b ON b.id = c.broker_id
WHERE c.created_at >= now() - interval '30 days'
GROUP BY c.broker_id, b.name, (c.created_at AT TIME ZONE 'America/Sao_Paulo')::date;

GRANT SELECT ON public.call_duration_stats TO authenticated;
