import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Phone, Mail, Lock, LogIn, UserPlus } from "lucide-react";
import fortalLogo from "@/assets/fortal-logo.png.asset.json";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Entrar — FORTAL" },
      { name: "description", content: "Acesso ao painel Fortal." },
    ],
  }),
  component: AuthPage,
});

const fontDisplay = { fontFamily: "'Fraunces', Georgia, serif", fontOpticalSizing: "auto" } as const;

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) navigate({ to: "/", replace: true });
    });
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/", replace: true });
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return toast.error("Preencha e-mail e senha");
    if (password.length < 8) return toast.error("Senha precisa ter pelo menos 8 caracteres");
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
        toast.success("Conta criada! Entrando...");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Bem-vindo de volta");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      toast.error(msg.includes("Invalid") ? "E-mail ou senha incorretos" : msg);
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
            Inteligência Imobiliária
          </div>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-zinc-800 bg-[#171a23] p-6 sm:p-8 space-y-4">
          <div className="text-center text-sm text-zinc-400 mb-2">
            {mode === "signin" ? "Entre com seu e-mail e senha" : "Crie sua conta de corretor"}
          </div>

          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className="h-12 w-full rounded-md border border-zinc-700 bg-[#0f1117] pl-10 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-[#c9a24c] focus:ring-2 focus:ring-[#c9a24c]/30"
            />
          </div>

          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="h-12 w-full rounded-md border border-zinc-700 bg-[#0f1117] pl-10 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-[#c9a24c] focus:ring-2 focus:ring-[#c9a24c]/30"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-[#c9a24c] py-3 text-sm font-semibold uppercase tracking-[0.2em] text-black shadow-[0_0_24px_-6px_#c9a24c] transition hover:bg-[#e6c878] active:scale-[0.99] disabled:opacity-60"
          >
            {mode === "signin" ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {loading ? "Aguarde..." : mode === "signin" ? "Entrar" : "Criar conta"}
          </button>

          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="block w-full text-center text-xs text-zinc-500 hover:text-[#c9a24c] transition"
          >
            {mode === "signin" ? "Não tem conta? Criar nova" : "Já tem conta? Entrar"}
          </button>
        </form>

        <div className="mt-6 text-center text-[10px] uppercase tracking-[0.3em] text-zinc-600 flex items-center justify-center gap-2">
          <Phone className="h-3 w-3" />
          Dados sincronizados entre todos os dispositivos
        </div>
      </div>
    </div>
  );
}
