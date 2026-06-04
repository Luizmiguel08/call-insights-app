REVOKE ALL ON FUNCTION public.sync_contact_queue_from_calls(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_contact_queue_from_calls() FROM PUBLIC, anon, authenticated;