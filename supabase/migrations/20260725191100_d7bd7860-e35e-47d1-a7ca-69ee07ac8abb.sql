
-- Duplicate/redundant indexes on public.calls and public.contacts_queue.
-- Each pair kept the more complete/descriptive index and dropped the exact
-- duplicate (or the one that is a strict prefix of a larger composite).

-- calls: idx_calls_created is byte-for-byte the same as idx_calls_created_at
DROP INDEX IF EXISTS public.idx_calls_created;

-- calls: idx_calls_updated is the same as calls_updated_at_idx
DROP INDEX IF EXISTS public.idx_calls_updated;

-- contacts_queue: idx_contacts_queue_updated is the same as contacts_queue_updated_at_idx
DROP INDEX IF EXISTS public.idx_contacts_queue_updated;

-- contacts_queue: idx_contacts_queue_status is a strict prefix of
-- idx_contacts_queue_broker_status (status, broker_id, priority DESC, created_at)
DROP INDEX IF EXISTS public.idx_contacts_queue_status;
