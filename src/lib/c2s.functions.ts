import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Sincroniza os leads do C2S sob demanda (somente admin). */
export const syncC2sNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sinceHours?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _uid: context.userId,
      _role: "admin",
    } as never);
    if (!isAdmin) throw new Error("Forbidden");

    const { syncC2sLeads } = await import("@/lib/c2s.server");
    return syncC2sLeads({ sinceHours: data.sinceHours ?? 72 });
  });
