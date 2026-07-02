
CREATE INDEX IF NOT EXISTS idx_calls_broker_created ON public.calls (broker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_created ON public.calls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_updated ON public.calls (updated_at);
CREATE INDEX IF NOT EXISTS idx_calls_contact ON public.calls (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contacts_queue_updated ON public.contacts_queue (updated_at);
CREATE INDEX IF NOT EXISTS idx_contacts_queue_broker_status ON public.contacts_queue (broker_id, status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_contacts_queue_pending ON public.contacts_queue (status, priority DESC, created_at) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_contact_attempts_contact_called ON public.contact_attempts (contact_id, called_at DESC);
