import { useMemo, useState } from "react";
import {
  type State,
  Field, Kpi, Th, Td,
  fontDisplay, fontNumeric, inputCls,
  todayISO, uniqueContactCount, uniqueContactCountWhere,
  normalizedContactKey,
} from "@/lib/dialer-shared";


export default function DashboardTab({ state }: { state: State }) {
  const [date, setDate] = useState(todayISO());

  // Usa state.calls (já carregado uma vez pelo cloud-state) em vez de
  // refazer uma query de 50k linhas a cada abertura da aba. Duração vem
  // do próprio state agora.
  const filteredCalls = useMemo(
    () => state.calls.filter((c) => (date ? c.date === date : true)),
    [state.calls, date],
  );

  // Agrupa por (corretor, contato único) mantendo a MAIOR duração — bate
  // com a lógica do ranking (contatos únicos).
  const perBrokerDuration = useMemo(() => {
    const grouped = new Map<string, Map<string, number>>();
    for (const r of filteredCalls) {
      const bId = r.brokerId ?? "sem";
      const key = normalizedContactKey({
        client: r.client,
        phone: r.phone,
        contactId: r.contactId,
      });
      let inner = grouped.get(bId);
      if (!inner) { inner = new Map(); grouped.set(bId, inner); }
      const cur = inner.get(key) ?? 0;
      const d = r.durationSeconds ?? 0;
      if (d > cur) inner.set(key, d);
      else if (!inner.has(key)) inner.set(key, d);
    }

    const bucket = (s: number): "fantasma" | "curta" | "media" | "longa" | "semReg" => {
      if (!s || s <= 0) return "semReg";
      if (s < 4) return "fantasma";
      if (s < 60) return "curta";
      if (s < 180) return "media";
      return "longa";
    };

    const rows = Array.from(grouped.entries()).map(([bId, contacts]) => {
      const name = state.brokers.find((b) => b.id === bId)?.name || "Sem corretor";
      let total = 0, fantasma = 0, curta = 0, media = 0, longa = 0, semReg = 0;
      let totalSecs = 0, avgSum = 0, avgCount = 0, maxDur = 0;
      for (const dur of contacts.values()) {
        total += 1;
        totalSecs += dur;
        if (dur > 0) { avgSum += dur; avgCount += 1; }
        if (dur > maxDur) maxDur = dur;
        const b = bucket(dur);
        if (b === "fantasma") fantasma += 1;
        else if (b === "curta") curta += 1;
        else if (b === "media") media += 1;
        else if (b === "longa") longa += 1;
        else semReg += 1;
      }
      return {
        brokerId: bId, name, total, fantasma, curta, media, longa, semReg,
        totalSecs, maxDur,
        avg: avgCount ? Math.round(avgSum / avgCount) : 0,
        pctQualidade: total ? Math.round(((media + longa) / total) * 100) : 0,
      };
    });
    return rows.sort((a, b) => b.totalSecs - a.totalSecs);
  }, [filteredCalls, state.brokers]);

  const durationTotals = useMemo(() => {
    const t = { fantasma: 0, curta: 0, media: 0, longa: 0, semReg: 0, total: 0, avg: 0 };
    let avgSum = 0, avgCount = 0;
    for (const r of perBrokerDuration) {
      t.fantasma += r.fantasma; t.curta += r.curta; t.media += r.media;
      t.longa += r.longa; t.semReg += r.semReg; t.total += r.total;
      if (r.avg) { avgSum += r.avg * (r.total - r.semReg); avgCount += (r.total - r.semReg); }
    }
    t.avg = avgCount ? Math.round(avgSum / avgCount) : 0;
    return t;
  }, [perBrokerDuration]);

  const fmtDur = (s: number) => {
    if (!s) return "0s";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${ss}s`;
    return `${ss}s`;
  };

  const pctQualidade = durationTotals.total ? Math.round(((durationTotals.media + durationTotals.longa) / durationTotals.total) * 100) : 0;
  const pctFantasma = durationTotals.total ? Math.round((durationTotals.fantasma / durationTotals.total) * 100) : 0;



  const calls = filteredCalls;

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
      <div className="rounded-lg border border-zinc-800 bg-[#13151e] p-4 flex flex-wrap items-end gap-3">
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

      {(() => {
        // KPIs + Team + Alerts (novo bloco Noir)
        const meta = state.metaDaily || 50;
        const answerRate = k.total ? Math.round((k.attended / k.total) * 100) : 0;

        // Comparação vs. dia anterior
        const prevDate = (() => {
          if (!date) return "";
          const d = new Date(date + "T12:00:00");
          d.setDate(d.getDate() - 1);
          return d.toISOString().slice(0, 10);
        })();
        const prevCalls = prevDate ? state.calls.filter((c) => c.date === prevDate) : [];
        const prevTotal = uniqueContactCount(prevCalls);
        const pctVsYesterday = prevTotal > 0
          ? Math.round(((k.total - prevTotal) / prevTotal) * 100)
          : (k.total > 0 ? 100 : 0);

        const palette = ["#c9a84c", "#60a5fa", "#4ade80", "#f59e0b", "#f472b6", "#a78bfa", "#fb7185", "#34d399"];
        const now = Date.now();

        const team = state.brokers.map((b, i) => {
          const own = calls.filter((c) => c.brokerId === b.id);
          const totBroker = uniqueContactCount(own);
          const attBroker = uniqueContactCountWhere(own, (c) => c.attended);
          const lastCallAt = own.reduce((m, c) => Math.max(m, c.createdAt || 0), 0);
          const idleMinutes = lastCallAt ? Math.floor((now - lastCallAt) / 60000) : Infinity;
          const isTodayView = !date || date === todayISO();
          const status: "online" | "idle" | "offline" =
            !isTodayView || !lastCallAt
              ? "offline"
              : idleMinutes <= 5
              ? "online"
              : idleMinutes <= 30
              ? "idle"
              : "offline";
          return {
            id: b.id, name: b.name || "Sem nome",
            color: palette[i % palette.length],
            calls: totBroker, answered: attBroker, meta,
            idleMinutes: Number.isFinite(idleMinutes) ? idleMinutes : 0,
            status,
          };
        }).sort((a, b) => b.calls - a.calls);

        const idleCount = team.filter((c) => c.status === "idle").length;

        const alerts: { level: "red" | "amber" | "gold"; text: string }[] = [];
        for (const c of team) {
          if (c.status === "idle") alerts.push({ level: "amber", text: `${c.name} parado há ${c.idleMinutes} min` });
          if (c.status === "online" && c.calls === 0) alerts.push({ level: "gold", text: `${c.name} online sem ligações` });
          if (c.calls >= meta) alerts.push({ level: "gold", text: `${c.name} bateu a meta (${c.calls}/${meta})` });
        }
        if (answerRate > 0 && answerRate < 20 && k.total >= 5) {
          alerts.push({ level: "red", text: `Taxa de atendimento baixa: ${answerRate}%` });
        }

        const kpis = [
          { label: "LIGAÇÕES HOJE", value: k.total, color: "var(--green)", sub: `${pctVsYesterday >= 0 ? "↑" : "↓"} ${Math.abs(pctVsYesterday)}% vs ontem` },
          { label: "TAXA ATEND.", value: `${answerRate}%`, color: "var(--gold)", sub: `${k.attended} atendidas` },
          { label: "AGENDAMENTOS", value: k.scheduled, color: "var(--blue)", sub: `${rate}% conversão` },
          { label: "SEM LIGAR", value: idleCount, color: "var(--red)", sub: "+5 min parados" },
        ];

        return (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 14 }}>
              {kpis.map((kpi) => (
                <div key={kpi.label} style={{ background: "var(--surface-1)", borderRadius: "var(--radius-md)", padding: 12, border: "1px solid var(--border)" }}>
                  <div style={{ ...fontDisplay, fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.06em", marginBottom: 4 }}>
                    {kpi.label}
                  </div>
                  <div style={{ ...fontNumeric, fontSize: 20, fontWeight: 600, color: kpi.color }}>{kpi.value}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{kpi.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ ...fontDisplay, fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.08em", marginBottom: 8 }}>
                CORRETORES EM TEMPO REAL
              </div>
              {team.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--text-muted)", padding: 12, background: "var(--surface-1)", borderRadius: "var(--radius-md)" }}>
                  Nenhum corretor cadastrado.
                </div>
              )}
              {team.map((c) => {
                const pct = Math.min(100, Math.round((c.calls / Math.max(c.meta, 1)) * 100));
                const answerPct = Math.round((c.answered / Math.max(c.calls, 1)) * 100);
                const statusStyle =
                  c.status === "online"
                    ? { background: "var(--green-dim)", color: "var(--green)", border: "0.5px solid #4ade8033" }
                    : c.status === "idle"
                    ? { background: "var(--amber-dim)", color: "var(--amber)", border: "0.5px solid #f59e0b33" }
                    : { background: "#ffffff08", color: "var(--text-muted)", border: "0.5px solid var(--border)" };
                return (
                  <div key={c.id} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    background: "var(--surface-1)", borderRadius: "var(--radius-md)",
                    padding: "10px 12px", marginBottom: 6, border: "1px solid var(--border)",
                  }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                      background: `${c.color}22`, color: c.color,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 500,
                    }}>
                      {c.name[0]?.toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "#fff", fontWeight: 500, marginBottom: 3 }}>
                        {c.name}
                        <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400, marginLeft: 6 }}>
                          {c.calls} lig · {c.answered} atend.
                        </span>
                      </div>
                      <div style={{ height: 3, background: "#ffffff0f", borderRadius: 2, marginBottom: 3 }}>
                        <div style={{
                          height: 3, borderRadius: 2, background: c.color,
                          width: `${pct}%`, transition: "width 0.4s ease",
                        }} />
                      </div>
                      <div style={{ display: "flex", gap: 10, fontSize: 10, color: "var(--text-muted)" }}>
                        <span style={fontNumeric}>{c.calls}/{c.meta} meta</span>
                        <span style={fontNumeric}>{answerPct}% atend.</span>
                        {c.status === "idle" && c.idleMinutes > 0 && (
                          <span style={{ ...fontNumeric, color: "var(--red)" }}>parado {c.idleMinutes}min</span>
                        )}
                      </div>
                    </div>
                    <span style={{
                      ...fontDisplay,
                      padding: "2px 8px", borderRadius: 20,
                      fontSize: 9, fontWeight: 600, letterSpacing: "0.04em", flexShrink: 0,
                      ...statusStyle,
                    }}>
                      {c.status === "online" ? "LIGANDO" : c.status === "idle" ? "PARADO" : "OFFLINE"}
                    </span>
                  </div>
                );
              })}
            </div>

            {alerts.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ ...fontDisplay, fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.08em", marginBottom: 8 }}>
                  ALERTAS
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {alerts.map((a, i) => {
                    const c = a.level === "red" ? "var(--red)" : a.level === "amber" ? "var(--amber)" : "var(--gold)";
                    const bg = a.level === "red" ? "var(--red-dim)" : a.level === "amber" ? "var(--amber-dim)" : "var(--gold-dim)";
                    return (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 8,
                        background: bg, border: `0.5px solid ${c}33`,
                        borderRadius: "var(--radius-sm)", padding: "8px 12px",
                        fontSize: 12, color: c,
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: c, flexShrink: 0 }} />
                        {a.text}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}


      <div className="rounded-lg border border-zinc-800 bg-[#13151e] p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-xl font-bold uppercase tracking-wider" style={fontDisplay}>Duração das Ligações</h3>
            <p className="text-xs text-zinc-500">Distribuição por qualidade da chamada {date ? `em ${date}` : "em todos os dias"}</p>
          </div>
          <div className="text-xs text-zinc-500">
            Qualidade: <span className="font-semibold text-emerald-400">{pctQualidade}%</span>
            <span className="mx-2 text-zinc-700">·</span>
            Fantasmas: <span className="font-semibold text-red-400">{pctFantasma}%</span>
            <span className="mx-2 text-zinc-700">·</span>
            Média: <span className="font-semibold text-[#c9a84c]" style={fontNumeric}>{durationTotals.avg}s</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Fantasmas (<4s)" value={durationTotals.fantasma} color="#ef4444" />
          <Kpi label="Curtas (<60s)" value={durationTotals.curta} color="#f59e0b" />
          <Kpi label="Médias (<3min)" value={durationTotals.media} color="#22c55e" />
          <Kpi label="Longas (≥3min)" value={durationTotals.longa} color="#c9a84c" />
        </div>
        {durationTotals.semReg > 0 && (
          <p className="mt-3 text-[11px] text-zinc-500">
            {durationTotals.semReg} ligação(ões) sem duração registrada no período.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-[#13151e] p-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h3 className="text-xl font-bold uppercase tracking-wider" style={fontDisplay}>Duração por Corretor</h3>
            <p className="text-xs text-zinc-500">Tempo total e média de cada ligação {date ? `em ${date}` : "em todos os dias"}</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-[0.18em] text-zinc-500" style={fontDisplay}>
              <tr>
                <Th>Corretor</Th>
                <Th className="text-right">Ligações</Th>
                <Th className="text-right">Tempo Total</Th>
                <Th className="text-right">Média</Th>
                <Th className="text-right">Máx</Th>
                <Th className="text-right">Fantasmas</Th>
                <Th className="text-right">Qualidade</Th>
              </tr>
            </thead>
            <tbody>
              {perBrokerDuration.map((r) => (
                <tr key={r.brokerId} className="border-t border-zinc-800/80">
                  <Td className="font-semibold text-zinc-100">{r.name}</Td>
                  <Td className="text-right tabular-nums" style={fontNumeric}>{r.total}</Td>
                  <Td className="text-right tabular-nums font-semibold text-[#c9a84c]" style={fontNumeric}>{fmtDur(Math.round(r.totalSecs))}</Td>
                  <Td className="text-right tabular-nums" style={fontNumeric}>{fmtDur(r.avg)}</Td>
                  <Td className="text-right tabular-nums text-zinc-300" style={fontNumeric}>{fmtDur(r.maxDur)}</Td>
                  <Td className="text-right tabular-nums text-red-400">{r.fantasma}</Td>
                  <Td className="text-right tabular-nums font-semibold text-emerald-400">{r.pctQualidade}%</Td>
                </tr>
              ))}
              {perBrokerDuration.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-zinc-500">Sem ligações registradas no período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-[#13151e] p-6">
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
                      {row.total} ligação(ões) · pico às <b className="text-[#c9a84c]">{String(peakIdx).padStart(2, "0")}h</b>
                    </span>
                  </div>
                  <div className="rounded-md bg-gradient-to-b from-zinc-900/80 to-zinc-900/40 p-2">
                    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full">
                      <defs>
                        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#c9a84c" stopOpacity="0.55" />
                          <stop offset="100%" stopColor="#c9a84c" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {[0.25, 0.5, 0.75].map((f) => (
                        <line key={f} x1={P} x2={W - P} y1={P + (H - P * 2) * f} y2={P + (H - P * 2) * f}
                          stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.4" />
                      ))}
                      <path d={area} fill={`url(#${gid})`} />
                      <path d={path} fill="none" stroke="#c9a84c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      {row.hours[peakIdx] > 0 && (
                        <>
                          <line x1={peakX} x2={peakX} y1={peakY} y2={H - P} stroke="#c9a84c" strokeWidth="0.7" strokeDasharray="2 2" opacity="0.6" />
                          <circle cx={peakX} cy={peakY} r="3.5" fill="#0c0e14" stroke="#c9a84c" strokeWidth="1.6" />
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

      <div className="rounded-lg border border-zinc-800 bg-[#13151e] p-6">
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
                        i === 0 ? "bg-[#c9a84c] text-black" : i === 1 ? "bg-zinc-700 text-zinc-100" : i === 2 ? "bg-zinc-800 text-zinc-300" : "bg-zinc-900 text-zinc-500"
                      }`}
                      style={fontDisplay}
                    >{i + 1}</span>
                  </Td>
                  <Td className="font-semibold text-zinc-100">{r.broker.name}</Td>
                  <Td className="text-right text-3xl tracking-tight" style={fontNumeric}>{r.total}</Td>
                  <Td>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-[#c9a84c] transition-all" style={{ width: `${(r.total / max) * 100}%` }} />
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums text-emerald-400">{r.attended}</Td>
                  <Td className="text-right tabular-nums text-yellow-400">{r.scheduled}</Td>
                  <Td className="text-right tabular-nums font-semibold text-[#c9a84c]">{r.rate}%</Td>
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
