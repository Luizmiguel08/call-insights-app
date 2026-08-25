import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-sync-secret, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}

/** Aceita variações de nomes de campo que o C2S pode enviar. */
const leadSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    lead_id: z.union([z.string(), z.number()]).optional(),
    uuid: z.string().optional(),
    name: z.string().optional(),
    nome: z.string().optional(),
    phone: z.string().optional(),
    telefone: z.string().optional(),
    celular: z.string().optional(),
    whatsapp: z.string().optional(),
    email: z.string().optional(),
    origem: z.string().optional(),
    source: z.string().optional(),
    portal: z.string().optional(),
    broker_email: z.string().optional(),
    corretor_email: z.string().optional(),
    broker: z.string().optional(),
    corretor: z.string().optional(),
    apelido: z.string().optional(),
    responsavel: z.string().optional(),
    created_at: z.string().optional(),
    data: z.string().optional(),
  })
  .passthrough();

const payloadSchema = z.union([
  leadSchema,
  z.object({ lead: leadSchema }).passthrough(),
  z.object({ leads: z.array(leadSchema).max(500) }).passthrough(),
  z.object({ data: z.array(leadSchema).max(500) }).passthrough(),
]);

type Lead = z.infer<typeof leadSchema>;

function pick(...vals: (string | number | undefined)[]) {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return undefined;
}

function digits(s: string | undefined) {
  return (s ?? "").replace(/\D+/g, "");
}

export const Route = createFileRoute("/api/public/c2s-webhook")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: cors }),

      GET: () => json({ ok: true, service: "c2s-webhook", expects: "POST" }),

      POST: async ({ request }) => {
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

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid_json" }, 400);
        }

        const parsed = payloadSchema.safeParse(body);
        if (!parsed.success) return json({ error: "invalid_payload" }, 400);

        const raw = parsed.data as Record<string, unknown> & {
          lead?: Lead;
          leads?: Lead[];
          data?: unknown;
        };
        const leads: Lead[] = Array.isArray(raw.leads)
          ? raw.leads
          : Array.isArray(raw.data)
            ? (raw.data as Lead[])
            : raw.lead
              ? [raw.lead]
              : [parsed.data as Lead];

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let saved = 0;
        const skipped: string[] = [];

        for (const lead of leads) {
          const c2sId = pick(lead.id, lead.lead_id, lead.uuid);
          const phone = digits(pick(lead.phone, lead.telefone, lead.celular, lead.whatsapp));
          if (!c2sId && phone.length < 10) {
            skipped.push("sem_id_e_sem_telefone");
            continue;
          }

          const brokerEmail = pick(lead.broker_email, lead.corretor_email)?.toLowerCase();
          const brokerAlias = pick(lead.broker, lead.corretor, lead.apelido, lead.responsavel);

          const { data: brokerId } = await supabaseAdmin.rpc("crm_resolve_broker", {
            _email: brokerEmail ?? null,
            _alias: brokerAlias ?? null,
          } as never);

          const receivedAt = pick(lead.created_at, lead.data);
          const parsedDate = receivedAt ? new Date(receivedAt) : null;

          const row = {
            c2s_lead_id: c2sId ?? `phone:${phone}`,
            name: pick(lead.name, lead.nome) ?? "Sem nome",
            phone,
            email: pick(lead.email) ?? null,
            source: pick(lead.origem, lead.source, lead.portal) ?? "c2s",
            c2s_broker_alias: brokerAlias ?? null,
            c2s_broker_email: brokerEmail ?? null,
            broker_id: (brokerId as string | null) ?? null,
            raw: lead as unknown as Record<string, unknown>,
            received_at:
              parsedDate && !Number.isNaN(parsedDate.getTime())
                ? parsedDate.toISOString()
                : new Date().toISOString(),
          };

          const { error } = await supabaseAdmin
            .from("crm_leads")
            .upsert(row as never, { onConflict: "c2s_lead_id" });

          if (error) {
            console.error("[c2s-webhook] upsert failed", error.message);
            skipped.push(error.message);
          } else {
            saved += 1;
          }
        }

        // Higiene: leads sem atendimento há mais de 7 dias vão para "fria"
        await supabaseAdmin.rpc("crm_expire_cold_leads" as never);

        return json({ ok: true, received: leads.length, saved, skipped });
      },
    },
  },
});
