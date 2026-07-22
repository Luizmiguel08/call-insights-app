import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";

export type InviteErrorReason = "invalid_or_expired" | "failed_to_join";

const messages: Record<InviteErrorReason, { title: string; description: string }> = {
  invalid_or_expired: {
    title: "Este convite não é mais válido",
    description:
      "O link pode ter expirado ou já foi usado. Peça ao administrador para enviar um novo convite.",
  },
  failed_to_join: {
    title: "Não foi possível entrar na equipe",
    description:
      "Houve um erro ao processar seu convite. Tente novamente ou contate o administrador.",
  },
};

export function InviteErrorPage({ reason }: { reason: InviteErrorReason }) {
  const { title, description } = messages[reason];
  return (
    <div
      className="min-h-[100dvh] flex items-center justify-center bg-[#0c0e14] text-zinc-100 px-4"
      style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}
    >
      <div className="max-w-md w-full text-center rounded-2xl border border-zinc-800 bg-[#13151e] p-8 space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-[#c9a84c]/15 flex items-center justify-center">
          <AlertTriangle className="h-6 w-6 text-[#c9a84c]" />
        </div>
        <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
        <p className="text-sm text-zinc-400 leading-relaxed">{description}</p>
        <Link
          to="/auth"
          className="inline-flex items-center justify-center rounded-md border border-zinc-700 px-4 py-2 text-xs uppercase tracking-[0.2em] text-zinc-300 hover:border-[#c9a84c] hover:text-[#c9a84c] transition"
        >
          Ir para o login
        </Link>
      </div>
    </div>
  );
}
