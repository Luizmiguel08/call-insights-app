CREATE INDEX IF NOT EXISTS idx_calls_created_at ON public.calls USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_broker_sessions_started_at ON public.broker_sessions USING btree (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_broker_pauses_started_at ON public.broker_pauses USING btree (started_at DESC);