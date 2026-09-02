import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-sync-secret, authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}

async function run(request: Request) {
  const secret = process.env["SYNC_SHARED_SECRET"];
  if (!secret) return json({ error: "server_not_configured" }, 500);

  const url = new URL(request.url);
  const provided =
    request.headers.get("x-sync-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    url.searchParams.get("secret") ??
    "";

  if (provided.length !== secret.length || provided !== secret) {
    return json({ error: "unauthorized" }, 401);
  }

  const sinceHours = Number(url.searchParams.get("horas") ?? url.searchParams.get("hours") ?? 48);
  const force = url.searchParams.get("force") === "1";
  const maxPages = Number(url.searchParams.get("paginas") ?? 12);
  const startPage = Number(url.searchParams.get("pagina") ?? 1);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Controle de concorrencia + backoff: evita sobrecarga quando ha erros
  if (!force) {
    const { data: canRun, error: beginError } = await supabaseAdmin.rpc(
      "c2s_sync_begin" as never,
    );
    if (beginError) {
      console.error("[c2s-sync] begin falhou", beginError);
      return json({ error: "lock_failed", message: beginError.message }, 500);
    }
    if (!canRun) {
      return json({ skipped: true, reason: "em_execucao_ou_backoff" }, 202);
    }
  }

  try {
    const { syncC2sLeads } = await import("@/lib/c2s.server");
    const result = await syncC2sLeads({
      sinceHours: Number.isFinite(sinceHours) ? sinceHours : 48,
      maxPages: Number.isFinite(maxPages) ? maxPages : 12,
      startPage: Number.isFinite(startPage) ? startPage : 1,
    });
    if (!force) {
      await supabaseAdmin.rpc("c2s_sync_end" as never, {
        _ok: true,
        _error: null,
        _result: result as never,
      } as never);
    }
    return json(result);
  } catch (err) {
    console.error("[c2s-sync] falhou", err);
    if (!force) {
      await supabaseAdmin.rpc("c2s_sync_end" as never, {
        _ok: false,
        _error: (err as Error).message?.slice(0, 500) ?? "erro",
        _result: null,
      } as never);
    }
    return json({ error: "sync_failed", message: (err as Error).message }, 502);
  }
}

export const Route = createFileRoute("/api/public/c2s-sync")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: cors }),
      GET: ({ request }) => run(request),
      POST: ({ request }) => run(request),
    },
  },
});
