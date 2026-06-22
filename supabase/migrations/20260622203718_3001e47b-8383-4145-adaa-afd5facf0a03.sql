
-- Add updated_at to contacts_queue and calls to enable incremental refetch.
ALTER TABLE public.contacts_queue
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill so existing rows have a coherent timestamp.
UPDATE public.contacts_queue SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL;
UPDATE public.calls           SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL;

-- Auto-touch updated_at on UPDATE (function already exists in this project).
DROP TRIGGER IF EXISTS trg_contacts_queue_set_updated_at ON public.contacts_queue;
CREATE TRIGGER trg_contacts_queue_set_updated_at
  BEFORE UPDATE ON public.contacts_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_calls_set_updated_at ON public.calls;
CREATE TRIGGER trg_calls_set_updated_at
  BEFORE UPDATE ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes to make "where updated_at > $cursor" instantaneous.
CREATE INDEX IF NOT EXISTS contacts_queue_updated_at_idx ON public.contacts_queue (updated_at);
CREATE INDEX IF NOT EXISTS calls_updated_at_idx           ON public.calls (updated_at);
