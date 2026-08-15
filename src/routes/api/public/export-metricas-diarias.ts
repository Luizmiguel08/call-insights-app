import { createFileRoute } from "@tanstack/react-router";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// Data local (America/Sao_Paulo) de um timestamp ISO
function localDay(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

const MIN_DATE = "2026-08-14"; // não expõe dados anteriores a 14/08/2026

type Registro = {
  data: string;
  corretor_id: string;
  fonte_nome: string;
  fonte: "discador";
  leads: number;
  ligacoes: number;
  agendamentos: number;
  visitas: number;
  visitas_desmarcadas: number;
  negociacoes: number;
  documentacoes: number;
  vendas: number;
  vgv: number;
};

function authorized(request: Request) {
  const secret = process.env["SYNC_SHARED_SECRET"];
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const legacy = request.headers.get("x-sync-secret") ?? "";
  return bearer === secret || legacy === secret;
}

async function buildRegistros(de: string, ate: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Janela em UTC cobrindo os dias locais solicitados (BRT = UTC-3)
  const startTs = `${de}T03:00:00.000Z`;
  const endDate = new Date(`${ate}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const endTs = `${endDate.toISOString().slice(0, 10)}T03:00:00.000Z`;

  const { data: brokers, error: brokersError } = await supabaseAdmin
    .from("brokers")
    .select("id, name");
  if (brokersError) throw new Error("falha_consulta");
  const nomes = new Map((brokers ?? []).map((b) => [b.id, b.name]));

  const registros = new Map<string, Registro>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from("calls")
      .select("broker_id, created_at, attended, scheduled")
      .gte("created_at", startTs)
      .lt("created_at", endTs)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error("falha_consulta");
    const rows = data ?? [];
    for (const row of rows) {
      const dia = localDay(row.created_at);
      if (dia < de || dia > ate) continue;
      const key = `${row.broker_id}|${dia}`;
      let acc = registros.get(key);
      if (!acc) {
        acc = {
          data: dia,
          corretor_id: row.broker_id,
          fonte_nome: nomes.get(row.broker_id) ?? "",
          fonte: "discador",
          leads: 0,
          ligacoes: 0,
          agendamentos: 0,
          visitas: 0,
          visitas_desmarcadas: 0,
          negociacoes: 0,
          documentacoes: 0,
          vendas: 0,
          vgv: 0,
        };
        registros.set(key, acc);
      }
      acc.ligacoes += 1;
      if (row.scheduled) acc.agendamentos += 1;
    }
    if (rows.length < pageSize) break;
  }

  return Array.from(registros.values()).sort(
    (a, b) => a.data.localeCompare(b.data) || a.fonte_nome.localeCompare(b.fonte_nome),
  );
}

function resolveRange(deRaw: string | null | undefined, ateRaw: string | null | undefined) {
  const hoje = localDay(new Date().toISOString());
  const de = deRaw && DATE_RE.test(deRaw) ? deRaw : MIN_DATE;
  const ate = ateRaw && DATE_RE.test(ateRaw) ? ateRaw : hoje;
  if (deRaw && !DATE_RE.test(deRaw)) return { erro: "de invalido (use YYYY-MM-DD)" } as const;
  if (ateRaw && !DATE_RE.test(ateRaw)) return { erro: "ate invalido (use YYYY-MM-DD)" } as const;
  const deFinal = de < MIN_DATE ? MIN_DATE : de;
  if (deFinal > ate) return { erro: "de deve ser <= ate" } as const;
  return { de: deFinal, ate } as const;
}

export const Route = createFileRoute("/api/public/export-metricas-diarias")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "authorization, content-type, x-sync-secret",
          },
        }),

      POST: async ({ request }) => {
        if (!authorized(request)) return jsonResponse({ erro: "nao_autorizado" }, 401);

        let body: Record<string, unknown> = {};
        try {
          const text = await request.text();
          if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
        } catch {
          return jsonResponse({ erro: "json_invalido" }, 400);
        }

        const range = resolveRange(body["de"] as string | undefined, body["ate"] as string | undefined);
        if ("erro" in range) return jsonResponse({ erro: "parametros_invalidos", detalhe: range.erro }, 400);

        try {
          return jsonResponse({ fonte: "discador", registros: await buildRegistros(range.de, range.ate) });
        } catch {
          return jsonResponse({ erro: "falha_consulta" }, 500);
        }
      },

      GET: async ({ request }) => {
        if (!authorized(request)) return jsonResponse({ erro: "nao_autorizado" }, 401);

        const url = new URL(request.url);
        const range = resolveRange(url.searchParams.get("de"), url.searchParams.get("ate"));
        if ("erro" in range) return jsonResponse({ erro: "parametros_invalidos", detalhe: range.erro }, 400);

        try {
          return jsonResponse({ fonte: "discador", registros: await buildRegistros(range.de, range.ate) });
        } catch {
          return jsonResponse({ erro: "falha_consulta" }, 500);
        }
      },
    },
  },
});
