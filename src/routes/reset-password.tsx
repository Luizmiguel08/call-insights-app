import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Lock, KeyRound } from "lucide-react";
import fortalLogo from "@/assets/fortal-logo.png.asset.json";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Redefinir senha — FORTAL" }],
  }),
  component: ResetPasswordPage,
});

const fontDisplay = { fontFamily: "'Fraunces', Georgia, serif", fontOpticalSizing: "auto" } as const;

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Supabase handles recovery token in URL hash and emits PASSWORD_RECOVERY
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    // If session already established from the recovery link
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return toast.error("A senha precisa ter pelo menos 8 caracteres");
    if (password !== confirm) return toast.error("As senhas não coincidem");
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Senha atualizada! Entrando...");
      navigate({ to: "/", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar senha");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-[100dvh] flex items-center justify-center bg-[#0f1117] text-zinc-100 px-4"
      style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}
    >
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src={fortalLogo.url} alt="Fortal" width={96} height={96} className="h-24 w-24 object-contain mb-4" />
          <div className="text-2xl text-[#c9a24c] tracking-[0.28em] font-medium" style={fontDisplay}>FORTAL</div>
          <div className="text-[10px] uppercase tracking-[0.34em] text-zinc-500 mt-2 italic" style={fontDisplay}>
            Redefinir senha
          </div>
        </div>

        {!ready ? (
          <div className="rounded-2xl border border-zinc-800 bg-[#171a23] p-6 text-center text-sm text-zinc-400">
            Validando link de recuperação...
            <button
              onClick={() => navigate({ to: "/auth" })}
              className="block mx-auto mt-4 text-xs text-[#c9a24c] hover:underline"
            >
              Voltar para o login
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="rounded-2xl border border-zinc-800 bg-[#171a23] p-6 sm:p-8 space-y-4">
            <div className="text-center text-sm text-zinc-400 mb-2">Defina sua nova senha</div>

            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nova senha (mín. 8)"
                className="h-12 w-full rounded-md border border-zinc-700 bg-[#0f1117] pl-10 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-[#c9a24c] focus:ring-2 focus:ring-[#c9a24c]/30"
              />
            </div>

            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Confirmar nova senha"
                className="h-12 w-full rounded-md border border-zinc-700 bg-[#0f1117] pl-10 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-[#c9a24c] focus:ring-2 focus:ring-[#c9a24c]/30"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-[#c9a24c] py-3 text-sm font-semibold uppercase tracking-[0.2em] text-black shadow-[0_0_24px_-6px_#c9a24c] transition hover:bg-[#e6c878] active:scale-[0.99] disabled:opacity-60"
            >
              <KeyRound className="h-4 w-4" />
              {loading ? "Salvando..." : "Salvar nova senha"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
