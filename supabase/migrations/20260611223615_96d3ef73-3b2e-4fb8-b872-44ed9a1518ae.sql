CREATE MATERIALIZED VIEW IF NOT EXISTS public.hourly_call_stats AS
SELECT
  user_id,
  broker_id,
  date_trunc('hour', called_at) AS hour_bucket,
  count(*) AS total_calls,
  count(*) FILTER (WHERE result = 'answered') AS answered_calls,
  count(*) FILTER (WHERE result = 'no_answer') AS no_answer_calls,
  count(*) FILTER (WHERE result = 'scheduled') AS scheduled_calls,
  round(
    count(*) FILTER (WHERE result = 'answered')::numeric / nullif(count(*), 0) * 100
  ) AS answer_rate
FROM public.contact_attempts
GROUP BY user_id, broker_id, date_trunc('hour', called_at);

GRANT SELECT ON public.hourly_call_stats TO authenticated;
GRANT SELECT ON public.hourly_call_stats TO service_role;

CREATE INDEX IF NOT EXISTS idx_hourly_call_stats_user_hour ON public.hourly_call_stats (user_id, hour_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_hourly_call_stats_broker_hour ON public.hourly_call_stats (broker_id, hour_bucket DESC);

REFRESH MATERIALIZED VIEW public.hourly_call_stats;