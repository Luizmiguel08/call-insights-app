REVOKE EXECUTE ON FUNCTION public.crm_resolve_broker(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_register_lead_attempt(uuid, boolean, text, integer, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.crm_expire_cold_leads() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.crm_current_period() FROM anon;

GRANT EXECUTE ON FUNCTION public.crm_resolve_broker(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.crm_expire_cold_leads() TO service_role;