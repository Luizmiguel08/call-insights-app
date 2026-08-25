CREATE TABLE public.internal_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.internal_config TO service_role;

ALTER TABLE public.internal_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only internal config"
ON public.internal_config FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER update_internal_config_updated_at
BEFORE UPDATE ON public.internal_config
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();