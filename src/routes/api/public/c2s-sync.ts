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

  try {
    const { syncC2sLeads } = await import("@/lib/c2s.server");
    const result = await syncC2sLeads({
      sinceHours: Number.isFinite(sinceHours) ? sinceHours : 48,
    });
    return json(result);
  } catch (err) {
    console.error("[c2s-sync] falhou", err);
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
