ALTER TABLE public.dialer_sessions
  ADD COLUMN IF NOT EXISTS device_id uuid;