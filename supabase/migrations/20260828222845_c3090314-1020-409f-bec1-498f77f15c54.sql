-- Período atual (America/Sao_Paulo): manha 9-14, tarde 14-22
CREATE OR REPLACE FUNCTION public.crm_current_period()
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Sao_Paulo')) BETWEEN 9 AND 13 THEN 'manha'
    WHEN EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Sao_Paulo')) BETWEEN 14 AND 21 THEN 'tarde'
    WHEN EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Sao_Paulo')) < 14 THEN 'manha'
    ELSE 'tarde'
  END
$$;