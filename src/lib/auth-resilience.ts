import { supabase } from "@/integrations/supabase/client";

/**
 * Blindagem global de sessão.
 *
 * Sintoma que isso resolve: quando o token de acesso expira (ou o relógio do
 * aparelho está adiantado), TODAS as consultas passam a voltar 401 /
 * "permission denied for table ... TO anon". Visualmente o app não mostra erro:
 * ele mostra "Nenhum contato pendente", Leads vazio, painel zerado — como se os
 * dados tivessem sumido.
 *
 * A correção intercepta as chamadas ao backend uma única vez, no nível do
 * fetch: qualquer resposta 401/403 com cara de token inválido dispara UMA
 * renovação de sessão e a chamada é refeita com o token novo. Se a renovação
 * falhar, o usuário é levado para a tela de login em vez de ficar olhando uma
 * fila falsamente vazia.
 */

let installed = false;
let refreshing: Promise<string | null> | null = null;
let lastRefreshAt = 0;

async function refreshOnce(): Promise<string | null> {
  // No máximo uma renovação a cada 5s, compartilhada por todas as chamadas.
  if (refreshing) return refreshing;
  if (Date.now() - lastRefreshAt < 5000) return null;
  refreshing = (async () => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        const { data: cur } = await supabase.auth.getSession();
        return cur.session?.access_token ?? null;
      }
      return data.session.access_token;
    } catch {
      return null;
    } finally {
      lastRefreshAt = Date.now();
      refreshing = null;
    }
  })();
  return refreshing;
}

function isSupabaseUrl(url: string) {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  return !!base && url.startsWith(base);
}

export function installAuthResilience() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    const response = await originalFetch(input as any, init);
    if (!isSupabaseUrl(url)) return response;
    if (response.status !== 401 && response.status !== 403) return response;

    // Só tenta recuperar se existe (ou existia) uma sessão neste aparelho.
    const token = await refreshOnce();
    if (!token) return response;

    // Refaz a chamada com o token renovado.
    const headers = new Headers(
      init?.headers ?? (typeof input === "object" && "headers" in input ? (input as Request).headers : undefined),
    );
    headers.set("Authorization", `Bearer ${token}`);
    try {
      if (typeof input === "string" || input instanceof URL) {
        return await originalFetch(input as any, { ...init, headers });
      }
      return await originalFetch(new Request(input as Request, { headers }));
    } catch {
      return response;
    }
  };
}
