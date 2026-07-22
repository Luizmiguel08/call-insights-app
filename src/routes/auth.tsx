import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Phone, Mail, Lock, LogIn, UserPlus, User, KeyRound, ArrowLeft } from "lucide-react";
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
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  useEffect(() => {
    function getPendingInvite(): string | null {
      try {
        const url = new URL(window.location.href);
        const fromUrl = url.searchParams.get("invite");
        if (fromUrl) {
          try { sessionStorage.setItem("pending_invite_token", fromUrl); } catch { /* noop */ }
          return fromUrl;
        }
        return sessionStorage.getItem("pending_invite_token");
      } catch { return null; }
    }

    function redirectAfterAuth() {
      const token = getPendingInvite();
      if (token) {
        navigate({ to: "/convite/$token", params: { token }, replace: true });
      } else {
        navigate({ to: "/", replace: true });
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) redirectAfterAuth();
    });
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) redirectAfterAuth();
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return toast.error("Informe seu e-mail");
    if (mode === "forgot") {
      setLoading(true);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setForgotSent(true);
        toast.success("E-mail de recuperação enviado!");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro ao enviar e-mail";
        toast.error(msg.includes("fetch") ? "Falha de conexão. Tente novamente em alguns segundos." : msg);
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!password) return toast.error("Preencha e-mail e senha");
    if (password.length < 8) return toast.error("Senha precisa ter pelo menos 8 caracteres");
    setLoading(true);
    try {
      if (mode === "signup") {
        if (!name.trim()) return toast.error("Informe seu nome");
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { full_name: name.trim(), name: name.trim() },
          },
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
      className="min-h-[100dvh] flex items-center justify-center bg-[#0c0e14] text-zinc-100 px-4"
      style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}
    >
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src={fortalLogo.url} alt="Fortal" width={96} height={96} className="h-24 w-24 object-contain mb-4" />
          <div className="text-2xl text-[#c9a84c] tracking-[0.28em] font-medium" style={fontDisplay}>FORTAL</div>
          <div className="text-[10px] uppercase tracking-[0.34em] text-zinc-500 mt-2 italic" style={fontDisplay}>
            Inteligência Imobiliária
          </div>
        </div>

        {mode === "forgot" && forgotSent ? (
          <div className="rounded-2xl border border-zinc-800 bg-[#13151e] p-6 sm:p-8 space-y-4 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-[#c9a84c]/15 flex items-center justify-center">
              <Mail className="h-6 w-6 text-[#c9a84c]" />
            </div>
            <div className="text-sm text-zinc-200 font-medium">Verifique seu e-mail</div>
            <div className="text-xs text-zinc-400 leading-relaxed">
              Enviamos um link de recuperação para <span className="text-zinc-200">{email}</span>.
              Abra a mensagem e clique no link para definir uma nova senha. Pode levar alguns minutos
              — confira também a caixa de spam.
            </div>
            <button
              type="button"
              onClick={() => { setForgotSent(false); setMode("signin"); }}
              className="flex items-center justify-center gap-1 w-full text-center text-xs text-zinc-500 hover:text-[#c9a84c] transition"
            >
              <ArrowLeft className="h-3 w-3" /> Voltar para o login
            </button>
          </div>
        ) : (
        <form onSubmit={submit} className="rounded-2xl border border-zinc-800 bg-[#13151e] p-6 sm:p-8 space-y-4">
          <div className="text-center text-sm text-zinc-400 mb-2">
            {mode === "signin"
              ? "Entre com seu e-mail e senha"
              : mode === "signup"
              ? "Crie sua conta de corretor"
              : "Informe seu e-mail para receber o link de recuperação"}
          </div>

          {mode === "signup" && (
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome (ex.: Miguel)"
                className="h-12 w-full rounded-md border border-zinc-700 bg-[#0c0e14] pl-10 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-[#c9a84c] focus:ring-2 focus:ring-[#c9a84c]/30"
              />
            </div>
          )}

          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className="h-12 w-full rounded-md border border-zinc-700 bg-[#0c0e14] pl-10 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-[#c9a84c] focus:ring-2 focus:ring-[#c9a84c]/30"
            />
          </div>

          {mode !== "forgot" && (
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <input
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12 w-full rounded-md border border-zinc-700 bg-[#0c0e14] pl-10 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-[#c9a84c] focus:ring-2 focus:ring-[#c9a84c]/30"
              />
            </div>
          )}

          {mode === "signin" && (
            <button
              type="button"
              onClick={() => setMode("forgot")}
              className="block w-full text-right text-xs text-zinc-500 hover:text-[#c9a84c] transition"
            >
              Esqueci minha senha
            </button>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-[#c9a84c] py-3 text-sm font-semibold uppercase tracking-[0.2em] text-black shadow-[0_0_24px_-6px_#c9a84c] transition hover:bg-[#d4b968] active:scale-[0.99] disabled:opacity-60"
          >
            {mode === "signin" ? (
              <LogIn className="h-4 w-4" />
            ) : mode === "signup" ? (
              <UserPlus className="h-4 w-4" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            {loading
              ? "Aguarde..."
              : mode === "signin"
              ? "Entrar"
              : mode === "signup"
              ? "Criar conta"
              : "Enviar link de recuperação"}
          </button>

          {mode === "forgot" ? (
            <button
              type="button"
              onClick={() => setMode("signin")}
              className="flex items-center justify-center gap-1 w-full text-center text-xs text-zinc-500 hover:text-[#c9a84c] transition"
            >
              <ArrowLeft className="h-3 w-3" /> Voltar para o login
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="block w-full text-center text-xs text-zinc-500 hover:text-[#c9a84c] transition"
            >
              {mode === "signin" ? "Não tem conta? Criar nova" : "Já tem conta? Entrar"}
            </button>
          )}
        </form>
        )}

        <div className="mt-6 text-center text-[10px] uppercase tracking-[0.3em] text-zinc-600 flex items-center justify-center gap-2">
          <Phone className="h-3 w-3" />
          Dados sincronizados entre todos os dispositivos
        </div>
      </div>
    </div>
  );
}
