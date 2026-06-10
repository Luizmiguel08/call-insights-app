
WITH ranked AS (
  SELECT
    id,
    contact_id,
    created_by,
    created_at,
    LAG(created_at) OVER (PARTITION BY contact_id, created_by ORDER BY created_at) AS prev_at
  FROM public.calls
  WHERE contact_id IS NOT NULL
),
dupes AS (
  SELECT id, contact_id
  FROM ranked
  WHERE prev_at IS NOT NULL
    AND created_at - prev_at < interval '5 seconds'
),
deleted AS (
  DELETE FROM public.calls c
  USING dupes d
  WHERE c.id = d.id
  RETURNING c.contact_id
),
affected AS (
  SELECT DISTINCT contact_id FROM deleted
)
SELECT public.sync_contact_queue_from_calls(contact_id) FROM affected;
