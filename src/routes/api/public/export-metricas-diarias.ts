import { createFileRoute } from "@tanstack/react-router";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-sync-secret",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
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

type Agregado = {
  data: string;
  broker_id: string;
  fonte_nome: string;
  ligacoes: number;
  atendidas: number;
  agendou: number;
};

function authorized(request: Request) {
  const secret = process.env["SYNC_SHARED_SECRET"];
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const legacy = request.headers.get("x-sync-secret") ?? "";
  return bearer === secret || legacy === secret;
}

async function aggregate(de: string, ate: string): Promise<Agregado[]> {
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

  const registros = new Map<string, Agregado>();
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
          broker_id: row.broker_id,
          fonte_nome: nomes.get(row.broker_id) ?? "",
          ligacoes: 0,
          atendidas: 0,
          agendou: 0,
        };
        registros.set(key, acc);
      }
      acc.ligacoes += 1;
      if (row.attended) acc.atendidas += 1;
      if (row.scheduled) acc.agendou += 1;
    }
    if (rows.length < pageSize) break;
  }

  return Array.from(registros.values()).sort(
    (a, b) => a.data.localeCompare(b.data) || a.fonte_nome.localeCompare(b.fonte_nome),
  );
}

// Formato BI: { desde, data: [{ data, fonte_id, fonte_nome, ligacoes, atendidas, agendou }] }
function biPayload(desde: string, linhas: Agregado[]) {
  return {
    desde,
    data: linhas.map((l) => ({
      data: l.data,
      fonte_id: l.broker_id,
      fonte_nome: l.fonte_nome,
      ligacoes: l.ligacoes,
      atendidas: l.atendidas,
      agendou: l.agendou,
    })),
  };
}

// Formato legado (CRM): { fonte: "discador", registros: [...] }
function crmPayload(linhas: Agregado[]) {
  return {
    fonte: "discador" as const,
    registros: linhas.map((l) => ({
      data: l.data,
      corretor_id: l.broker_id,
      fonte_nome: l.fonte_nome,
      fonte: "discador" as const,
      leads: 0,
      ligacoes: l.ligacoes,
      agendamentos: l.agendou,
      visitas: 0,
      visitas_desmarcadas: 0,
      negociacoes: 0,
      documentacoes: 0,
      vendas: 0,
      vgv: 0,
    })),
  };
}

function resolveRange(deRaw: string | null | undefined, ateRaw: string | null | undefined) {
  const hoje = localDay(new Date().toISOString());
  const de = deRaw && DATE_RE.test(deRaw) ? deRaw : MIN_DATE;
  const ate = ateRaw && DATE_RE.test(ateRaw) ? ateRaw : hoje;
  if (deRaw && !DATE_RE.test(deRaw)) return { erro: "de/desde invalido (use YYYY-MM-DD)" } as const;
  if (ateRaw && !DATE_RE.test(ateRaw)) return { erro: "ate invalido (use YYYY-MM-DD)" } as const;
  const deFinal = de < MIN_DATE ? MIN_DATE : de;
  if (deFinal > ate) return { erro: "de deve ser <= ate" } as const;
  return { de: deFinal, ate } as const;
}

async function handle(request: Request) {
  if (!authorized(request)) return jsonResponse({ erro: "nao_autorizado" }, 401);

  const url = new URL(request.url);
  let body: Record<string, unknown> = {};
  if (request.method === "POST") {
    try {
      const text = await request.text();
      if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return jsonResponse({ erro: "json_invalido" }, 400);
    }
  }

  const desdeRaw =
    (body["desde"] as string | undefined) ??
    url.searchParams.get("desde") ??
    undefined;
  const deRaw = desdeRaw ?? (body["de"] as string | undefined) ?? url.searchParams.get("de");
  const ateRaw = (body["ate"] as string | undefined) ?? url.searchParams.get("ate");

  const range = resolveRange(deRaw, ateRaw);
  if ("erro" in range) return jsonResponse({ erro: "parametros_invalidos", detalhe: range.erro }, 400);

  try {
    const linhas = await aggregate(range.de, range.ate);
    const formato = (body["formato"] as string | undefined) ?? url.searchParams.get("formato");
    if (formato === "crm") return jsonResponse(crmPayload(linhas));
    return jsonResponse(biPayload(range.de, linhas));
  } catch {
    return jsonResponse({ erro: "falha_consulta" }, 500);
  }
}

export const Route = createFileRoute("/api/public/export-metricas-diarias")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => handle(request),
      GET: async ({ request }) => handle(request),
    },
  },
});
