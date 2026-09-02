/**
 * Integração com o CRM C2S (Contact2Sale) — somente leitura na ponta do C2S.
 * Base: https://api.contact2sale.com/integration
 * Auth: Authorization: Bearer <C2S_API_TOKEN>
 * Paginação: ?page=N (25 leads por página, ordenado por created_at DESC)
 */

const C2S_BASE = "https://api.contact2sale.com/integration";

type C2sLead = {
  id?: string;
  internal_id?: number;
  attributes?: {
    customer?: { name?: string; email?: string; phone?: string; phone_global?: string };
    seller?: { name?: string; email?: string };
    lead_source?: { name?: string };
    channel?: { name?: string };
    created_at?: string;
  };
};

function digits(s: string | undefined | null) {
  return (s ?? "").replace(/\D+/g, "");
}

function clean(s: string | undefined | null) {
  const v = (s ?? "").trim();
  return v || null;
}

async function fetchPage(token: string, page: number): Promise<C2sLead[]> {
  const res = await fetch(`${C2S_BASE}/leads?page=${page}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`c2s_http_${res.status}`);
  const body = (await res.json()) as { data?: C2sLead[] };
  return Array.isArray(body.data) ? body.data : [];
}

export type C2sSyncResult = {
  ok: boolean;
  pages: number;
  fetched: number;
  saved: number;
  skipped: number;
  unmapped: string[];
  since: string;
};

/**
 * Puxa os leads mais recentes do C2S e grava em public.crm_leads.
 * Para de paginar quando encontra leads mais antigos que `sinceHours`.
 */
export async function syncC2sLeads(opts?: {
  sinceHours?: number;
  maxPages?: number;
  startPage?: number;
}): Promise<C2sSyncResult> {
  const token = process.env["C2S_API_TOKEN"];
  if (!token) throw new Error("c2s_token_missing");

  // Janela ampla o suficiente para recuperar meses antigos (backfill).
  const sinceHours = Math.min(Math.max(opts?.sinceHours ?? 48, 1), 24 * 400);
  const maxPages = Math.min(Math.max(opts?.maxPages ?? 12, 1), 200);
  const startPage = Math.max(opts?.startPage ?? 1, 1);
  const sinceMs = Date.now() - sinceHours * 3_600_000;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let fetched = 0;
  let saved = 0;
  let skipped = 0;
  let pages = 0;
  const unmapped = new Set<string>();

  outer: for (let page = startPage; page < startPage + maxPages; page++) {
    const items = await fetchPage(token, page);
    pages = page;
    if (items.length === 0) break;

    for (const item of items) {
      const a = item.attributes ?? {};
      const createdIso = a.created_at ?? null;
      const createdMs = createdIso ? new Date(createdIso).getTime() : NaN;

      // Lista vem em ordem decrescente: ao passar da janela, encerra tudo.
      if (!Number.isNaN(createdMs) && createdMs < sinceMs) break outer;

      fetched += 1;

      const phone = digits(a.customer?.phone_global ?? a.customer?.phone);
      const c2sId = item.id ?? (item.internal_id != null ? String(item.internal_id) : null);
      if (!c2sId && phone.length < 10) {
        skipped += 1;
        continue;
      }

      const brokerEmail = clean(a.seller?.email)?.toLowerCase() ?? null;
      const brokerAlias = clean(a.seller?.name);

      const { data: brokerId } = await supabaseAdmin.rpc("crm_resolve_broker", {
        _email: brokerEmail,
        _alias: brokerAlias,
      } as never);

      if (!brokerId && (brokerEmail || brokerAlias)) {
        unmapped.add(brokerAlias ?? brokerEmail ?? "");
      }

      const row = {
        c2s_lead_id: c2sId ?? `phone:${phone}`,
        name: clean(a.customer?.name) ?? "Sem nome",
        phone,
        email: clean(a.customer?.email),
        source: clean(a.lead_source?.name) ?? clean(a.channel?.name) ?? "c2s",
        c2s_broker_alias: brokerAlias,
        c2s_broker_email: brokerEmail,
        broker_id: (brokerId as string | null) ?? null,
        raw: item as unknown as Record<string, unknown>,
        received_at:
          createdIso && !Number.isNaN(createdMs) ? new Date(createdMs).toISOString() : new Date().toISOString(),
      };

      const { error } = await supabaseAdmin
        .from("crm_leads")
        .upsert(row as never, { onConflict: "c2s_lead_id", ignoreDuplicates: false });

      if (error) {
        console.error("[c2s-sync] upsert falhou", error.message);
        skipped += 1;
      } else {
        saved += 1;
      }
    }
  }

  await supabaseAdmin.rpc("crm_expire_cold_leads" as never);

  return {
    ok: true,
    pages,
    fetched,
    saved,
    skipped,
    unmapped: [...unmapped].filter(Boolean),
    since: new Date(sinceMs).toISOString(),
  };
}
