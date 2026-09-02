import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Field, fontDisplay, fontNumeric, inputCls, type State } from "@/lib/dialer-shared";
import type { Me } from "@/lib/cloud-state";

type Fonte = "todas" | "calls" | "leads";

type Detalhe = {
  id: string;
  brokerId: string | null;
  name: string;
  when: string;
  day: string;
  period: "manha" | "tarde" | "fora";
  result: string;
  origem: "Fila (C2S)" | "Discador";
};

type Linha = {
  brokerId: string;
  name: string;
  manha: number;
  tarde: number;
  fora: number;
  total: number;
};

const SP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
});

function spParts(iso: string) {
  const parts = SP.formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

function spToday() {
  return spParts(new Date().toISOString()).day;
}

function periodOfHour(hour: number): "manha" | "tarde" | "fora" {
  if (hour >= 9 && hour < 14) return "manha";
  if (hour >= 14 && hour < 22) return "tarde";
  return "fora";
}

// Janela UTC que cobre com folga os dias locais pedidos (BRT = UTC-3)
function utcWindow(de: string, ate: string) {
  const start = `${de}T00:00:00.000Z`;
  const end = new Date(`${ate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 2);
  return { start, end: end.toISOString() };
}

export default function HistoricoPeriodos({
  state, me, isAdmin,
}: { state: State; me: Me | null; isAdmin: boolean }) {
  const [de, setDe] = useState(spToday);
  const [ate, setAte] = useState(spToday);
  const [fonte, setFonte] = useState<Fonte>("todas");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [detalhes, setDetalhes] = useState<Detalhe[]>([]);
  const [verDetalhes, setVerDetalhes] = useState(false);

  const brokerNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of state.brokers) m.set(b.id, b.name);
    return m;
  }, [state.brokers]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!de || !ate || de > ate) return;
      setLoading(true);
      setErro(null);
      try {
        const { start, end } = utcWindow(de, ate);
        const acc = new Map<string, Linha>();
        const bump = (brokerId: string | null, day: string, kind: "manha" | "tarde" | "fora") => {
          if (!brokerId) return;
          if (day < de || day > ate) return;
          if (!isAdmin && me?.brokerId && brokerId !== me.brokerId) return;
          let row = acc.get(brokerId);
          if (!row) {
            row = { brokerId, name: brokerNames.get(brokerId) ?? "Sem corretor", manha: 0, tarde: 0, fora: 0, total: 0 };
            acc.set(brokerId, row);
          }
          row[kind] += 1;
          row.total += 1;
        };

        const pageSize = 1000;
        const det: Detalhe[] = [];

        if (fonte === "todas" || fonte === "calls") {
          for (let from = 0; ; from += pageSize) {
            if (cancelled) return;
            const { data, error } = await supabase
              .from("calls")
              .select("id, broker_id, client_name, created_at, attended, scheduled, notes")
              .gte("created_at", start)
              .lt("created_at", end)
              .order("created_at", { ascending: true })
              .range(from, from + pageSize - 1);
            if (error) throw error;
            const rows = (data ?? []) as Array<Record<string, any>>;
            for (const r of rows) {
              // Ligações da aba Fila são consolidadas em `calls` com marcador crm_lead:
              // no modo "todas" elas já entram via crm_lead_attempts — evita contagem dupla.
              const isCrm = typeof r.notes === "string" && r.notes.includes("crm_lead:");
              if (fonte === "todas" && isCrm) continue;
              const { day, hour } = spParts(r.created_at as string);
              const kind = periodOfHour(hour);
              bump(r.broker_id as string, day, kind);
              det.push({
                id: `c:${r.id}`,
                brokerId: r.broker_id as string | null,
                name: (r.client_name as string) || "—",
                when: r.created_at as string,
                day, period: kind,
                result: r.scheduled ? "agendou" : r.attended ? "atendeu" : "não atendeu",
                origem: "Discador",
              });
            }
            if (rows.length < pageSize) break;
          }
        }

        if (fonte === "todas" || fonte === "leads") {
          for (let from = 0; ; from += pageSize) {
            if (cancelled) return;
            const { data, error } = await (supabase as any)
              .from("crm_lead_attempts")
              .select("id, broker_id, called_at, period, attempt_date, result, lead_id, crm_leads(name)")
              .gte("called_at", start)
              .lt("called_at", end)
              .order("called_at", { ascending: true })
              .range(from, from + pageSize - 1);
            if (error) throw error;
            const rows = (data ?? []) as Array<Record<string, any>>;
            for (const r of rows) {
              const { day, hour } = spParts(r.called_at as string);
              const kind = r.period === "manha" || r.period === "tarde" ? (r.period as "manha" | "tarde") : periodOfHour(hour);
              const dia = (r.attempt_date as string) ?? day;
              bump(r.broker_id as string | null, dia, kind);
              det.push({
                id: `l:${r.id}`,
                brokerId: r.broker_id as string | null,
                name: r.crm_leads?.name ?? "Lead C2S",
                when: r.called_at as string,
                day: dia,
                period: kind,
                result: (r.result as string) ?? "—",
                origem: "Fila (C2S)",
              });
            }
            if (rows.length < pageSize) break;
          }
        }

        if (!cancelled) {
          setLinhas(Array.from(acc.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)));
          const visiveis = det
            .filter((d) => d.brokerId && d.day >= de && d.day <= ate)
            .filter((d) => isAdmin || !me?.brokerId || d.brokerId === me.brokerId)
            .sort((a, b) => (a.when < b.when ? 1 : -1))
            .slice(0, 400);
          setDetalhes(visiveis);
        }
      } catch (e) {
        if (!cancelled) setErro(e instanceof Error ? e.message : "Falha ao carregar histórico");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => { cancelled = true; };
  }, [de, ate, fonte, isAdmin, me?.brokerId, brokerNames]);

  const totais = useMemo(() => linhas.reduce(
    (acc, l) => ({ manha: acc.manha + l.manha, tarde: acc.tarde + l.tarde, fora: acc.fora + l.fora, total: acc.total + l.total }),
    { manha: 0, tarde: 0, fora: 0, total: 0 },
  ), [linhas]);

  function preset(dias: number) {
    const hoje = spToday();
    const d = new Date(`${hoje}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - dias);
    setDe(d.toISOString().slice(0, 10));
    setAte(hoje);
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#13151e] p-5 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h3 className="text-lg font-bold uppercase tracking-wider text-[#c9a84c]" style={fontDisplay}>
            Controle interno por período
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Ligações por corretor — manhã (09h–14h) e tarde (14h–22h), horário de São Paulo.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-3">
          <Field label="De" className="min-w-[150px]">
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Até" className="min-w-[150px]">
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Fonte" className="min-w-[190px]">
            <select value={fonte} onChange={(e) => setFonte(e.target.value as Fonte)} className={inputCls + " appearance-none"}>
              <option value="calls" className="bg-[#13151e]">Ligações registradas</option>
              <option value="leads" className="bg-[#13151e]">Tentativas de leads (C2S)</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[["Hoje", 0], ["7 dias", 6], ["30 dias", 29]].map(([label, dias]) => (
          <button
            key={label as string}
            onClick={() => preset(dias as number)}
            className="h-8 rounded-md border border-zinc-700 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
            style={fontDisplay}
          >
            {label as string}
          </button>
        ))}
      </div>

      {erro && <p className="text-xs text-red-400">{erro}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-zinc-500" style={fontDisplay}>
              <th className="pb-2">Corretor</th>
              <th className="pb-2 text-right">Manhã</th>
              <th className="pb-2 text-right">Tarde</th>
              <th className="pb-2 text-right">Fora do horário</th>
              <th className="pb-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading && linhas.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-xs text-zinc-500">Carregando…</td></tr>
            )}
            {!loading && linhas.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-xs text-zinc-500">Nenhuma ligação no período.</td></tr>
            )}
            {linhas.map((l) => (
              <tr key={l.brokerId} className="border-t border-zinc-800/70">
                <td className="py-2 pr-3 text-zinc-200">{l.name}</td>
                <td className="py-2 text-right text-zinc-300" style={fontNumeric}>{l.manha}</td>
                <td className="py-2 text-right text-zinc-300" style={fontNumeric}>{l.tarde}</td>
                <td className="py-2 text-right text-zinc-500" style={fontNumeric}>{l.fora}</td>
                <td className="py-2 text-right font-bold text-[#c9a84c]" style={fontNumeric}>{l.total}</td>
              </tr>
            ))}
            {linhas.length > 0 && (
              <tr className="border-t border-zinc-700">
                <td className="py-2 pr-3 text-[11px] uppercase tracking-widest text-zinc-500" style={fontDisplay}>Total</td>
                <td className="py-2 text-right text-zinc-200" style={fontNumeric}>{totais.manha}</td>
                <td className="py-2 text-right text-zinc-200" style={fontNumeric}>{totais.tarde}</td>
                <td className="py-2 text-right text-zinc-400" style={fontNumeric}>{totais.fora}</td>
                <td className="py-2 text-right font-bold text-[#c9a84c]" style={fontNumeric}>{totais.total}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
