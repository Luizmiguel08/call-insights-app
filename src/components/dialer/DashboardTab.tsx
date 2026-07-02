import { useEffect, useMemo, useState } from "react";
import {
  type State,
  Field, Kpi, Th, Td,
  fontDisplay, fontNumeric, inputCls,
  todayISO, uniqueContactCount, uniqueContactCountWhere,
} from "@/lib/dialer-shared";
import { supabase } from "@/integrations/supabase/client";

type DurationRow = {
  broker_id: string;
  corretor_nome: string | null;
  dia: string;
  total_ligacoes: number;
  ligacoes_fantasma: number;
  ligacoes_curtas: number;
  ligacoes_medias: number;
  ligacoes_longas: number;
  sem_registro: number;
  pct_fantasma: number;
  pct_curta: number;
  pct_qualidade: number;
  duracao_media_segundos: number;
  duracao_maxima_segundos: number;
  duracao_minima_segundos: number;
};


export default function DashboardTab({ state }: { state: State }) {
  const [date, setDate] = useState(todayISO());

  const calls = useMemo(() => state.calls.filter((c) => (date ? c.date === date : true)), [state.calls, date]);

  const totalUnique = uniqueContactCount(calls);
  const attendedUnique = uniqueContactCountWhere(calls, (c) => c.attended);
  const k = {
    total: totalUnique,
    attended: attendedUnique,
    notAttended: Math.max(0, totalUnique - attendedUnique),
    scheduled: uniqueContactCountWhere(calls, (c) => c.scheduled),
  };
  const rate = k.total ? Math.round((k.scheduled / k.total) * 100) : 0;

  const ranking = state.brokers.map((b) => {
    const own = calls.filter((c) => c.brokerId === b.id);
    const tot = uniqueContactCount(own);
    const att = uniqueContactCountWhere(own, (c) => c.attended);
    const sch = uniqueContactCountWhere(own, (c) => c.scheduled);
    return { broker: b, total: tot, attended: att, scheduled: sch, rate: tot ? Math.round((sch / tot) * 100) : 0 };
  }).sort((a, b) => b.total - a.total);

  const max = Math.max(1, ...ranking.map((r) => r.total));

  const hourly = state.brokers.map((b) => {
    const hours = new Array(24).fill(0) as number[];
    for (const c of calls) {
      if (c.brokerId !== b.id) continue;
      const h = new Date(c.createdAt).getHours();
      hours[h] += 1;
    }
    return { broker: b, hours, total: hours.reduce((s, v) => s + v, 0) };
  }).filter((r) => r.total > 0);
  const maxHour = Math.max(1, ...hourly.flatMap((r) => r.hours));

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-4 flex flex-wrap items-end gap-3">
        <Field label="Data" className="min-w-[180px]">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
        <button
          onClick={() => setDate("")}
          className="h-10 rounded-md border border-zinc-700 px-4 text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
          style={fontDisplay}
        >
          Todos os dias
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="Ligações" value={k.total} color="#c9a24c" />
        <Kpi label="Atendidas" value={k.attended} color="#22c55e" />
        <Kpi label="Não atend." value={k.notAttended} color="#ef4444" />
        <Kpi label="Agendamentos" value={k.scheduled} color="#eab308" />
        <Kpi label="Taxa Agend." value={`${rate}%`} color="#c9a24c" />
      </div>

      <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-6">
        <h3 className="mb-1 text-xl font-bold uppercase tracking-wider" style={fontDisplay}>Horário de Pico por Corretor</h3>
        <p className="mb-5 text-xs text-zinc-500">Distribuição de ligações ao longo do dia (0h–23h)</p>
        {hourly.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">Sem ligações no período selecionado.</p>
        ) : (
          <div className="space-y-5">
            {hourly.map((row) => {
              const peakIdx = row.hours.indexOf(Math.max(...row.hours));
              const W = 600, H = 110, P = 6;
              const n = row.hours.length;
              const stepX = (W - P * 2) / (n - 1);
              const pts = row.hours.map((v, h) => {
                const x = P + h * stepX;
                const y = H - P - (v / maxHour) * (H - P * 2);
                return [x, y] as const;
              });
              const path = pts.reduce((acc, p, i, arr) => {
                if (i === 0) return `M ${p[0]},${p[1]}`;
                const p0 = arr[i - 1];
                const p2 = arr[i + 1] ?? p;
                const pm1 = arr[i - 2] ?? p0;
                const c1x = p0[0] + (p[0] - pm1[0]) / 6;
                const c1y = p0[1] + (p[1] - pm1[1]) / 6;
                const c2x = p[0] - (p2[0] - p0[0]) / 6;
                const c2y = p[1] - (p2[1] - p0[1]) / 6;
                return `${acc} C ${c1x},${c1y} ${c2x},${c2y} ${p[0]},${p[1]}`;
              }, "");
              const area = `${path} L ${P + (n - 1) * stepX},${H - P} L ${P},${H - P} Z`;
              const peakX = P + peakIdx * stepX;
              const peakY = H - P - (row.hours[peakIdx] / maxHour) * (H - P * 2);
              const gid = `grad-${row.broker.id}`;
              return (
                <div key={row.broker.id} className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-zinc-100">{row.broker.name}</span>
                    <span className="text-xs text-zinc-500">
                      {row.total} ligação(ões) · pico às <b className="text-[#c9a24c]">{String(peakIdx).padStart(2, "0")}h</b>
                    </span>
                  </div>
                  <div className="rounded-md bg-gradient-to-b from-zinc-900/80 to-zinc-900/40 p-2">
                    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full">
                      <defs>
                        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#c9a24c" stopOpacity="0.55" />
                          <stop offset="100%" stopColor="#c9a24c" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {[0.25, 0.5, 0.75].map((f) => (
                        <line key={f} x1={P} x2={W - P} y1={P + (H - P * 2) * f} y2={P + (H - P * 2) * f}
                          stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.4" />
                      ))}
                      <path d={area} fill={`url(#${gid})`} />
                      <path d={path} fill="none" stroke="#c9a24c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      {row.hours[peakIdx] > 0 && (
                        <>
                          <line x1={peakX} x2={peakX} y1={peakY} y2={H - P} stroke="#c9a24c" strokeWidth="0.7" strokeDasharray="2 2" opacity="0.6" />
                          <circle cx={peakX} cy={peakY} r="3.5" fill="#0b0d12" stroke="#c9a24c" strokeWidth="1.6" />
                        </>
                      )}
                    </svg>
                  </div>
                  <div className="flex justify-between px-1 text-[10px] tabular-nums text-zinc-600">
                    <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-6">
        <h3 className="mb-4 text-xl font-bold uppercase tracking-wider" style={fontDisplay}>Ranking de Corretores</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-[0.18em] text-zinc-500" style={fontDisplay}>
              <tr>
                <Th className="w-12">#</Th><Th>Corretor</Th><Th className="w-24 text-right">Ligações</Th>
                <Th className="min-w-[180px]">Progresso</Th>
                <Th className="text-right">Atendidas</Th><Th className="text-right">Agendam.</Th><Th className="text-right">Taxa</Th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r, i) => (
                <tr key={r.broker.id} className="border-t border-zinc-800/80">
                  <Td>
                    <span
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-md font-bold ${
                        i === 0 ? "bg-[#c9a24c] text-black" : i === 1 ? "bg-zinc-700 text-zinc-100" : i === 2 ? "bg-zinc-800 text-zinc-300" : "bg-zinc-900 text-zinc-500"
                      }`}
                      style={fontDisplay}
                    >{i + 1}</span>
                  </Td>
                  <Td className="font-semibold text-zinc-100">{r.broker.name}</Td>
                  <Td className="text-right text-3xl tracking-tight" style={fontNumeric}>{r.total}</Td>
                  <Td>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-[#c9a24c] transition-all" style={{ width: `${(r.total / max) * 100}%` }} />
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums text-emerald-400">{r.attended}</Td>
                  <Td className="text-right tabular-nums text-yellow-400">{r.scheduled}</Td>
                  <Td className="text-right tabular-nums font-semibold text-[#c9a24c]">{r.rate}%</Td>
                </tr>
              ))}
              {ranking.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-zinc-500">Cadastre corretores para ver o ranking.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
