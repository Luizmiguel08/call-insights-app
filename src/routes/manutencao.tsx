import { createFileRoute } from "@tanstack/react-router";
import { Construction, Clock } from "lucide-react";
import fortalLogo from "@/assets/fortal-logo.png.asset.json";

export const Route = createFileRoute("/manutencao")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Em manutenção — FORTAL" },
      { name: "description", content: "O FORTAL está em manutenção temporária. Volte em breve." },
    ],
  }),
  component: MaintenancePage,
});

const fontDisplay = { fontFamily: "'Fraunces', Georgia, serif", fontOpticalSizing: "auto" } as const;

function MaintenancePage() {
  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#0c0e14] text-zinc-100 px-4"
      style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}
    >
      <div className="w-full max-w-md text-center">
        <div className="flex flex-col items-center mb-8">
          <img
            src={fortalLogo.url}
            alt="Fortal"
            width={80}
            height={80}
            className="h-20 w-20 object-contain mb-4 opacity-90"
          />
          <div className="text-2xl text-[#c9a84c] tracking-[0.28em] font-medium" style={fontDisplay}>
            FORTAL
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-[#13151e] p-8 sm:p-10 space-y-6">
          <div className="mx-auto h-16 w-16 rounded-full bg-[#c9a84c]/15 flex items-center justify-center">
            <Construction className="h-8 w-8 text-[#c9a84c]" />
          </div>

          <div className="space-y-2">
            <h1 className="text-lg font-semibold text-zinc-100">Estamos em manutenção</h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              O sistema está sendo ajustado para todos os usuários. Em breve voltaremos com tudo funcionando.
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-zinc-500">
            <Clock className="h-3.5 w-3.5" />
            <span>Tente novamente daqui a pouco</span>
          </div>
        </div>

        <div className="mt-8 text-[10px] uppercase tracking-[0.3em] text-zinc-600">
          Inteligência Imobiliária
        </div>
      </div>
    </div>
  );
}
