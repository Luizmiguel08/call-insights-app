import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/async-resilience";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    let authResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;
    try {
      authResult = await withTimeout(supabase.auth.getUser(), 8_000, "A validação da sessão");
    } catch {
      throw redirect({ to: "/auth" });
    }
    const { data, error } = authResult;
    if (error || !data.user) {
      throw redirect({ to: "/auth" });
    }

    // Verifica modo de manutenção global.
    let maintenanceEnabled = false;
    try {
      const { data: flagRow } = await withTimeout(
        supabase.from("system_flags").select("value").eq("key", "maintenance_mode").maybeSingle(),
        5_000,
        "A verificação de manutenção",
      );
      maintenanceEnabled = flagRow?.value ?? false;
    } catch {
      // Falha de telemetria/manutenção não pode derrubar o app inteiro.
    }

    if (maintenanceEnabled) {
      // Admins continuam com acesso normal durante a manutenção.
      let isAdmin = false;
      try {
        const result = await withTimeout(
          supabase.rpc("has_role", { _uid: data.user.id, _role: "admin" }),
          5_000,
          "A validação de acesso",
        );
        isAdmin = result.data ?? false;
      } catch {
        // Em manutenção, falhar fechado é mais seguro para usuários comuns.
      }
      if (!isAdmin) {
        throw redirect({ to: "/manutencao" });
      }
    }

    return { user: data.user };
  },
  component: () => <Outlet />,
});
