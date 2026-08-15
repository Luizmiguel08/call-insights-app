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

export const Route = createFileRoute("/api/public/export-metricas-diarias")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env["SYNC_SHARED_SECRET"];
        const provided = request.headers.get("x-sync-secret");
        if (!secret || !provided || provided !== secret) {
          return jsonResponse({ erro: "nao_autorizado" }, 401);
        }

        const url = new URL(request.url);
        const de = url.searchParams.get("de");
        const ate = url.searchParams.get("ate");
        if (!de || !ate || !DATE_RE.test(de) || !DATE_RE.test(ate)) {
          return jsonResponse(
            { erro: "parametros_invalidos", detalhe: "Informe de=YYYY-MM-DD e ate=YYYY-MM-DD" },
            400,
          );
        }
        if (de > ate) {
          return jsonResponse({ erro: "parametros_invalidos", detalhe: "de deve ser <= ate" }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Janela em UTC cobrindo os dias locais solicitados (BRT = UTC-3)
        const startTs = `${de}T03:00:00.000Z`;
        const endDate = new Date(`${ate}T00:00:00Z`);
        endDate.setUTCDate(endDate.getUTCDate() + 1);
        const endTs = `${endDate.toISOString().slice(0, 10)}T03:00:00.000Z`;

        const registros = new Map<
          string,
          {
            fonte_id: string;
            fonte_nome: string;
            data: string;
            ligacoes: number;
            ligacoes_atendidas: number;
            agendamentos_na_ligacao: number;
          }
        >();

        const { data: brokers, error: brokersError } = await supabaseAdmin
          .from("brokers")
          .select("id, name");
        if (brokersError) return jsonResponse({ erro: "falha_consulta" }, 500);
        const nomes = new Map((brokers ?? []).map((b) => [b.id, b.name]));

        const pageSize = 1000;
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await supabaseAdmin
            .from("calls")
            .select("broker_id, created_at, attended, scheduled")
            .gte("created_at", startTs)
            .lt("created_at", endTs)
            .order("created_at", { ascending: true })
            .range(from, from + pageSize - 1);

          if (error) return jsonResponse({ erro: "falha_consulta" }, 500);
          const rows = data ?? [];
          for (const row of rows) {
            const dia = localDay(row.created_at);
            if (dia < de || dia > ate) continue;
            const key = `${row.broker_id}|${dia}`;
            let acc = registros.get(key);
            if (!acc) {
              acc = {
                fonte_id: row.broker_id,
                fonte_nome: nomes.get(row.broker_id) ?? "",
                data: dia,
                ligacoes: 0,
                ligacoes_atendidas: 0,
                agendamentos_na_ligacao: 0,
              };
              registros.set(key, acc);
            }
            acc.ligacoes += 1;
            if (row.attended) acc.ligacoes_atendidas += 1;
            if (row.scheduled) acc.agendamentos_na_ligacao += 1;
          }
          if (rows.length < pageSize) break;
        }

        const lista = Array.from(registros.values()).sort(
          (a, b) => a.data.localeCompare(b.data) || a.fonte_nome.localeCompare(b.fonte_nome),
        );

        return jsonResponse({ fonte: "discador", registros: lista });
      },
    },
  },
});
