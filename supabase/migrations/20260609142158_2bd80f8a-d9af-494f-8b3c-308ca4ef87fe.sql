
-- Reattach the missing trigger that keeps contacts_queue.call_attempts/status
-- in sync with the calls table. Without it, record_call_outcome never caps
-- attempts and the dialer overcounts tentativas.
DROP TRIGGER IF EXISTS sync_contact_queue_from_calls_trg ON public.calls;
CREATE TRIGGER sync_contact_queue_from_calls_trg
AFTER INSERT OR UPDATE OR DELETE ON public.calls
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_contact_queue_from_calls();

-- One-shot reconcile so every existing contact reflects the calls already logged.
SELECT public.reconcile_contact_queue();
