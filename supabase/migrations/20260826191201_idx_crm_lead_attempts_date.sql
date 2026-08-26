-- Índice para acelerar queries com filtro gte(attempt_date, ...)
CREATE INDEX IF NOT EXISTS idx_crm_lead_attempts_attempt_date
  ON public.crm_lead_attempts (attempt_date DESC);
