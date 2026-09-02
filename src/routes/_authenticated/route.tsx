import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth" });
    }

    // Verifica modo de manutenção global.
    const { data: flagRow } = await supabase
      .from("system_flags")
      .select("value")
      .eq("key", "maintenance_mode")
      .single();

    if (flagRow?.value) {
      // Admins continuam com acesso normal durante a manutenção.
      const { data: isAdmin } = await supabase.rpc("has_role", {
        _uid: data.user.id,
        _role: "admin",
      });
      if (!isAdmin) {
        throw redirect({ to: "/manutencao" });
      }
    }

    return { user: data.user };
  },
  component: () => <Outlet />,
});
