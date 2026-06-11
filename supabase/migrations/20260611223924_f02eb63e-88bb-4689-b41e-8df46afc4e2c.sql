CREATE OR REPLACE FUNCTION public.get_idle_gaps(p_user_id uuid, p_date date)
RETURNS TABLE(gap_start timestamptz, gap_end timestamptz, gap_minutes int)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH gaps AS (
    SELECT
      called_at AS gap_start,
      lead(called_at) OVER (ORDER BY called_at) AS gap_end,
      extract(epoch from (lead(called_at) OVER (ORDER BY called_at) - called_at)) / 60 AS gap_minutes
    FROM contact_attempts
    WHERE user_id = p_user_id
      AND called_at >= timezone('America/Sao_Paulo', p_date::timestamp)
      AND called_at < timezone('America/Sao_Paulo', (p_date + 1)::timestamp)
  )
  SELECT gap_start, gap_end, gap_minutes::int
  FROM gaps
  WHERE gap_end IS NOT NULL
    AND gap_minutes > 10;
$$;

GRANT EXECUTE ON FUNCTION public.get_idle_gaps(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_idle_gaps(uuid, date) TO service_role;