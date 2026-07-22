import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { InviteErrorPage, type InviteErrorReason } from "@/components/InviteErrorPage";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/convite/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Convite — FORTAL" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: InvitePage,
});

const PENDING_KEY = "pending_invite_token";

type Status = "loading" | "joining" | "error";

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("loading");
  const [reason, setReason] = useState<InviteErrorReason>("invalid_or_expired");
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // 1. Validar o token
      const { data: inviteRows, error: inviteErr } = await supabase.rpc("get_invite_by_token", {
        _token: token,
      });
      if (cancelled) return;

      const invite = Array.isArray(inviteRows) ? inviteRows[0] : null;
      if (inviteErr || !invite || invite.status !== "pending" || new Date(invite.expires_at) <= new Date()) {
        setReason("invalid_or_expired");
        setStatus("error");
        return;
      }
      setOrgName(invite.organization_name ?? null);

      // 2. Se não logado, guarda token e manda pro /auth
      const { data: userData } = await supabase.auth.getUser();
      if (cancelled) return;

      if (!userData.user) {
        try {
          sessionStorage.setItem(PENDING_KEY, token);
        } catch {
          /* storage indisponível, segue com query string */
        }
        navigate({ to: "/auth", search: { invite: token } as never, replace: true });
        return;
      }

      // 3. Aceitar convite
      setStatus("joining");
      const { error: acceptErr } = await supabase.rpc("accept_organization_invite", { _token: token });
      if (cancelled) return;

      if (acceptErr) {
        console.error("[invite] accept failed", acceptErr);
        setReason("failed_to_join");
        setStatus("error");
        return;
      }

      // 4. Sucesso — limpa token e vai pro discador
      try { sessionStorage.removeItem(PENDING_KEY); } catch { /* noop */ }
      navigate({ to: "/", replace: true });
    }

    void run();
    return () => { cancelled = true; };
  }, [token, navigate]);

  if (status === "error") return <InviteErrorPage reason={reason} />;

  return (
    <div
      className="min-h-[100dvh] flex items-center justify-center bg-[#0c0e14] text-zinc-100 px-4"
      style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}
    >
      <div className="max-w-sm w-full text-center rounded-2xl border border-zinc-800 bg-[#13151e] p-8 space-y-4">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#c9a84c]" />
        <div className="text-sm text-zinc-300">
          {status === "joining" ? "Entrando na equipe..." : "Validando convite..."}
        </div>
        {orgName && (
          <div className="text-xs text-zinc-500">
            Organização: <span className="text-zinc-300">{orgName}</span>
          </div>
        )}
      </div>
    </div>
  );
}
