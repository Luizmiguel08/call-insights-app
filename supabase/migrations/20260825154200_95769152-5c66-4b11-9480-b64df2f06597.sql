-- ============ CRM C2S integration ============

CREATE TABLE public.crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  c2s_lead_id text NOT NULL,
  name text NOT NULL DEFAULT 'Sem nome',
  phone text NOT NULL DEFAULT '',
  email text,
  source text,
  c2s_broker_alias text,
  c2s_broker_email text,
  broker_id uuid REFERENCES public.brokers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'novo',
  received_at timestamptz NOT NULL DEFAULT now(),
  attended_at timestamptz,
  cold_at timestamptz,
  notes text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uniq_crm_leads_c2s_id ON public.crm_leads (c2s_lead_id);
CREATE INDEX idx_crm_leads_broker_status ON public.crm_leads (broker_id, status, received_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_leads TO authenticated;
GRANT ALL ON public.crm_leads TO service_role;
ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brokers read own crm leads" ON public.crm_leads
  FOR SELECT TO authenticated
  USING (broker_id = public.current_broker_id() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "brokers update own crm leads" ON public.crm_leads
  FOR UPDATE TO authenticated
  USING (broker_id = public.current_broker_id() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (broker_id = public.current_broker_id() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin manage crm leads" ON public.crm_leads
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_crm_leads_updated_at BEFORE UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tentativas por período (manhã / tarde)
CREATE TABLE public.crm_lead_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  broker_id uuid REFERENCES public.brokers(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  period text NOT NULL,
  result text NOT NULL,
  attempt_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  duration_seconds integer NOT NULL DEFAULT 0,
  observation text,
  called_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_crm_lead_attempts_lead ON public.crm_lead_attempts (lead_id, attempt_date);

GRANT SELECT, INSERT ON public.crm_lead_attempts TO authenticated;
GRANT ALL ON public.crm_lead_attempts TO service_role;
ALTER TABLE public.crm_lead_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own crm attempts" ON public.crm_lead_attempts
  FOR SELECT TO authenticated
  USING (broker_id = public.current_broker_id() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "insert own crm attempts" ON public.crm_lead_attempts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Apelidos do C2S -> corretor daqui
CREATE TABLE public.crm_broker_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  c2s_alias text,
  c2s_email text,
  broker_id uuid NOT NULL REFERENCES public.brokers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uniq_crm_alias_email ON public.crm_broker_aliases (lower(c2s_email)) WHERE c2s_email IS NOT NULL;
CREATE UNIQUE INDEX uniq_crm_alias_name ON public.crm_broker_aliases (lower(c2s_alias)) WHERE c2s_alias IS NOT NULL;

GRANT SELECT ON public.crm_broker_aliases TO authenticated;
GRANT ALL ON public.crm_broker_aliases TO service_role;
ALTER TABLE public.crm_broker_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read crm aliases" ON public.crm_broker_aliases
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin manage crm aliases" ON public.crm_broker_aliases
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_crm_aliases_updated_at BEFORE UPDATE ON public.crm_broker_aliases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Período atual (America/Sao_Paulo): manha 9-12, tarde 14-19
CREATE OR REPLACE FUNCTION public.crm_current_period()
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Sao_Paulo')) BETWEEN 9 AND 11 THEN 'manha'
    WHEN EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Sao_Paulo')) BETWEEN 14 AND 18 THEN 'tarde'
    WHEN EXTRACT(HOUR FROM (now() AT TIME ZONE 'America/Sao_Paulo')) < 12 THEN 'manha'
    ELSE 'tarde'
  END
$$;

-- Vincula corretor por e-mail (ou apelido) do C2S
CREATE OR REPLACE FUNCTION public.crm_resolve_broker(_email text, _alias text)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_broker uuid;
BEGIN
  IF _email IS NOT NULL AND _email <> '' THEN
    SELECT broker_id INTO v_broker FROM public.crm_broker_aliases
      WHERE lower(c2s_email) = lower(_email) LIMIT 1;
    IF v_broker IS NOT NULL THEN RETURN v_broker; END IF;

    SELECT id INTO v_broker FROM public.brokers
      WHERE lower(COALESCE(email, '')) = lower(_email) LIMIT 1;
    IF v_broker IS NOT NULL THEN RETURN v_broker; END IF;
  END IF;

  IF _alias IS NOT NULL AND _alias <> '' THEN
    SELECT broker_id INTO v_broker FROM public.crm_broker_aliases
      WHERE lower(c2s_alias) = lower(_alias) LIMIT 1;
    IF v_broker IS NOT NULL THEN RETURN v_broker; END IF;

    SELECT id INTO v_broker FROM public.brokers
      WHERE lower(name) = lower(_alias) LIMIT 1;
  END IF;

  RETURN v_broker;
END;
$$;

-- Registra tentativa de ligação em um lead do C2S
CREATE OR REPLACE FUNCTION public.crm_register_lead_attempt(
  _lead_id uuid,
  _attended boolean,
  _result text DEFAULT NULL,
  _duration_seconds integer DEFAULT 0,
  _observation text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_broker uuid := public.current_broker_id();
  v_is_admin boolean := public.has_role(auth.uid(), 'admin');
  v_lead public.crm_leads;
  v_period text := public.crm_current_period();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_lead FROM public.crm_leads WHERE id = _lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_admin AND v_lead.broker_id IS DISTINCT FROM v_broker THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.crm_lead_attempts (lead_id, broker_id, user_id, period, result, duration_seconds, observation)
  VALUES (
    _lead_id,
    COALESCE(v_broker, v_lead.broker_id),
    auth.uid(),
    v_period,
    COALESCE(NULLIF(_result, ''), CASE WHEN _attended THEN 'atendeu' ELSE 'nao_atendeu' END),
    GREATEST(COALESCE(_duration_seconds, 0), 0),
    NULLIF(_observation, '')
  );

  IF _attended THEN
    UPDATE public.crm_leads
    SET status = 'atendido', attended_at = now()
    WHERE id = _lead_id;
  END IF;

  RETURN jsonb_build_object(
    'lead_id', _lead_id,
    'period', v_period,
    'status', CASE WHEN _attended THEN 'atendido' ELSE v_lead.status END
  );
END;
$$;

-- Move para "fria" leads com mais de 7 dias sem atendimento
CREATE OR REPLACE FUNCTION public.crm_expire_cold_leads()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_moved int := 0;
BEGIN
  WITH u AS (
    UPDATE public.crm_leads
    SET status = 'fria', cold_at = now()
    WHERE status = 'novo'
      AND received_at < now() - interval '7 days'
    RETURNING 1
  ) SELECT COUNT(*) INTO v_moved FROM u;

  RETURN jsonb_build_object('moved', v_moved);
END;
$$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_leads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_lead_attempts;