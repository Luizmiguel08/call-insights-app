import { useMemo, useState } from "react";
import {
  type State,
  todayISO, uniqueContactCount, uniqueContactCountWhere,
  normalizedContactKey,
} from "@/lib/dialer-shared";
import { useTeamPresence } from "@/hooks/useLivePresence";


// Paleta Fortal — navy profundo + dourado editorial + areia quente.
const T = {
  bg: "#0b0d13",
  bgSoft: "#10131c",
  surface: "#161a25",
  surface2: "#1d2231",
  line: "rgba(201,168,76,0.12)",
  lineSoft: "rgba(255,255,255,0.06)",
  gold: "#c9a84c",
  goldSoft: "#e2c46e",
  goldDim: "rgba(201,168,76,0.15)",
  sand: "#e8dcc0",
  text: "#f2ede1",
  textDim: "rgba(242,237,225,0.55)",
  textMute: "rgba(242,237,225,0.35)",
  green: "#6fbf7a",
  greenSoft: "rgba(111,191,122,0.15)",
  blue: "#7aa7e0",
  amber: "#e0b45e",
  red: "#e07a7a",
  redSoft: "rgba(224,122,122,0.15)",
  sora: "'Sora', ui-sans-serif, system-ui, sans-serif",
  manrope: "'Manrope', ui-sans-serif, system-ui, sans-serif",
};

const card: React.CSSProperties = {
  background: T.surface,
  border: `1px solid ${T.line}`,
  borderRadius: 24,
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[10px] font-semibold uppercase tracking-[0.24em]"
      style={{ color: T.textMute, fontFamily: T.sora }}
    >
      {children}
    </p>
  );
}

function SectionHead({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h3
          className="text-lg font-semibold"
          style={{ fontFamily: T.sora, color: T.sand, letterSpacing: "-0.01em" }}
        >
          {title}
        </h3>
        {subtitle && <p className="mt-1 text-xs" style={{ color: T.textDim }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export default function DashboardTab({ state }: { state: State }) {
  const [date, setDate] = useState(todayISO());

  // Usa state.calls (já carregado uma vez pelo cloud-state) em vez de
  // refazer uma query de 50k linhas a cada abertura da aba.
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

  // ---- Blocos de tempo real / KPIs ----
  const meta = state.metaDaily || 50;
  const answerRate = k.total ? Math.round((k.attended / k.total) * 100) : 0;

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

  const palette = [T.gold, T.blue, T.green, T.amber, "#d597b8", "#a79ae0", T.red, "#6fc4b0"];
  const now = Date.now();
  const presence = useTeamPresence();


  const team = state.brokers.map((b, i) => {
    const own = calls.filter((c) => c.brokerId === b.id);
    const totBroker = uniqueContactCount(own);
    const attBroker = uniqueContactCountWhere(own, (c) => c.attended);
    const lastCallAt = own.reduce((m, c) => Math.max(m, c.createdAt || 0), 0);
    const idleMinutes = lastCallAt ? Math.floor((now - lastCallAt) / 60000) : Infinity;
    const isTodayView = !date || date === todayISO();
    // Presença ao vivo (tabela active_calls) tem prioridade sobre o histórico:
    // mostra quem está literalmente em ligação neste momento, em qualquer aparelho.
    const live = isTodayView ? presence.get(b.id) : null;
    const status: "online" | "idle" | "offline" =
      live
        ? "online"
        : !isTodayView || !lastCallAt
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
      live: live ? { contact: live.contact_name, device: live.device_label } : null,
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
    { label: "Ligações hoje", value: k.total, color: T.gold, sub: `${pctVsYesterday >= 0 ? "↑" : "↓"} ${Math.abs(pctVsYesterday)}% vs ontem`, subColor: pctVsYesterday >= 0 ? T.green : T.red },
    { label: "Taxa atend.", value: `${answerRate}%`, color: T.green, sub: `${k.attended} atendidas`, subColor: T.textDim },
    { label: "Agendamentos", value: k.scheduled, color: T.blue, sub: `${rate}% conversão`, subColor: T.textDim },
    { label: "Sem ligar", value: idleCount, color: idleCount > 0 ? T.red : T.textDim, sub: "+5 min parados", subColor: T.textDim },
  ];

  const durationCards = [
    { label: "Fantasmas", hint: "< 4s", value: durationTotals.fantasma, color: T.red },
    { label: "Curtas", hint: "< 60s", value: durationTotals.curta, color: T.amber },
    { label: "Médias", hint: "< 3min", value: durationTotals.media, color: T.green },
    { label: "Longas", hint: "≥ 3min", value: durationTotals.longa, color: T.gold },
  ];
  const durationSum = Math.max(1, durationTotals.fantasma + durationTotals.curta + durationTotals.media + durationTotals.longa);

  return (
    <div className="flex flex-col gap-5" style={{ fontFamily: T.manrope, color: T.text }}>
      {/* Filtro de período */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5" style={card}>
        <div className="min-w-0">
          <Eyebrow>Período</Eyebrow>
          <p className="mt-1 text-sm font-semibold" style={{ fontFamily: T.sora, color: T.sand }}>
            {date ? new Date(date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }) : "Todos os dias"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-10 rounded-full px-4 text-sm outline-none"
            style={{ background: T.bgSoft, border: `1px solid ${T.lineSoft}`, color: T.sand, fontFamily: T.manrope }}
          />
          <button
            onClick={() => setDate(todayISO())}
            className="h-10 rounded-full px-4 text-[11px] font-bold uppercase tracking-[0.18em] transition-all"
            style={{
              background: date === todayISO() ? T.gold : T.bgSoft,
              color: date === todayISO() ? T.bg : T.gold,
              border: `1px solid ${T.gold}`, fontFamily: T.sora,
            }}
          >
            Hoje
          </button>
          <button
            onClick={() => setDate("")}
            className="h-10 rounded-full px-4 text-[11px] font-bold uppercase tracking-[0.18em] transition-all"
            style={{
              background: date === "" ? T.gold : T.bgSoft,
              color: date === "" ? T.bg : T.textDim,
              border: `1px solid ${date === "" ? T.gold : T.lineSoft}`, fontFamily: T.sora,
            }}
          >
            Tudo
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="p-5" style={card}>
            <Eyebrow>{kpi.label}</Eyebrow>
            <p
              className="mt-3 text-4xl font-semibold tabular-nums"
              style={{ fontFamily: T.sora, color: kpi.color, letterSpacing: "-0.03em" }}
            >
              {kpi.value}
            </p>
            <p className="mt-2 text-[11px]" style={{ color: kpi.subColor }}>{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Alertas */}
      {alerts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {alerts.map((a, i) => {
            const c = a.level === "red" ? T.red : a.level === "amber" ? T.amber : T.gold;
            return (
              <span
                key={i}
                className="inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs"
                style={{ background: `${c}1a`, border: `1px solid ${c}33`, color: c }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
                {a.text}
              </span>
            );
          })}
        </div>
      )}

      {/* Corretores em tempo real */}
      <div className="p-5 sm:p-6" style={card}>
        <SectionHead
          title="Corretores em tempo real"
          subtitle="Progresso da meta diária e atividade recente"
          right={
            <span className="rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em]"
              style={{ background: T.goldDim, color: T.gold, fontFamily: T.sora }}>
              {team.length} corretores
            </span>
          }
        />
        {team.length === 0 ? (
          <p className="py-8 text-center text-sm" style={{ color: T.textDim }}>Nenhum corretor cadastrado.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {team.map((c) => {
              const pct = Math.min(100, Math.round((c.calls / Math.max(c.meta, 1)) * 100));
              const answerPct = Math.round((c.answered / Math.max(c.calls, 1)) * 100);
              const sc = c.status === "online" ? T.green : c.status === "idle" ? T.amber : T.textMute;
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-4 rounded-2xl p-4"
                  style={{ background: T.bgSoft, border: `1px solid ${T.lineSoft}` }}
                >
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                    style={{ background: `${c.color}22`, color: c.color, border: `1px solid ${c.color}44`, fontFamily: T.sora }}
                  >
                    {c.name[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-semibold" style={{ fontFamily: T.sora, color: T.sand }}>{c.name}</p>
                      <span className="shrink-0 text-[11px] tabular-nums" style={{ color: T.textDim }}>
                        {c.calls}/{c.meta}
                      </span>
                    </div>
                    <div className="my-2 h-1 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: c.color }} />
                    </div>
                    <div className="flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.14em]" style={{ color: T.textMute }}>
                      <span className="tabular-nums">{c.answered} atend.</span>
                      <span className="tabular-nums">{answerPct}% taxa</span>
                      {c.status === "idle" && c.idleMinutes > 0 && (
                        <span className="tabular-nums" style={{ color: T.red }}>parado {c.idleMinutes}min</span>
                      )}
                    </div>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em]"
                    style={{ background: `${sc}1a`, color: sc, border: `1px solid ${sc}33`, fontFamily: T.sora }}
                  >
                    {c.status === "online" ? "Ligando" : c.status === "idle" ? "Parado" : "Offline"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Duração das ligações */}
      <div className="p-5 sm:p-6" style={card}>
        <SectionHead
          title="Duração das ligações"
          subtitle={`Distribuição por qualidade da chamada ${date ? `em ${date}` : "em todos os dias"}`}
          right={
            <div className="flex flex-wrap gap-4 text-[11px]" style={{ color: T.textDim }}>
              <span>Qualidade <b style={{ color: T.green }}>{pctQualidade}%</b></span>
              <span>Fantasmas <b style={{ color: T.red }}>{pctFantasma}%</b></span>
              <span>Média <b className="tabular-nums" style={{ color: T.gold }}>{durationTotals.avg}s</b></span>
            </div>
          }
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {durationCards.map((d) => (
            <div key={d.label} className="rounded-2xl p-4" style={{ background: T.bgSoft, border: `1px solid ${T.lineSoft}` }}>
              <div className="flex items-baseline justify-between">
                <Eyebrow>{d.label}</Eyebrow>
                <span className="text-[10px] tabular-nums" style={{ color: T.textMute }}>{d.hint}</span>
              </div>
              <p className="mt-3 text-3xl font-semibold tabular-nums" style={{ fontFamily: T.sora, color: d.color, letterSpacing: "-0.03em" }}>
                {d.value}
              </p>
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round((d.value / durationSum) * 100)}%`, background: d.color }} />
              </div>
            </div>
          ))}
        </div>
        {durationTotals.semReg > 0 && (
          <p className="mt-4 text-[11px]" style={{ color: T.textMute }}>
            {durationTotals.semReg} ligação(ões) sem duração registrada no período.
          </p>
        )}
      </div>

      {/* Duração por corretor */}
      <div className="p-5 sm:p-6" style={card}>
        <SectionHead
          title="Duração por corretor"
          subtitle={`Tempo total e média de cada ligação ${date ? `em ${date}` : "em todos os dias"}`}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.2em]" style={{ color: T.textMute, fontFamily: T.sora }}>
                <th className="px-3 py-2 text-left font-semibold">Corretor</th>
                <th className="px-3 py-2 text-right font-semibold">Ligações</th>
                <th className="px-3 py-2 text-right font-semibold">Tempo total</th>
                <th className="px-3 py-2 text-right font-semibold">Média</th>
                <th className="px-3 py-2 text-right font-semibold">Máx</th>
                <th className="px-3 py-2 text-right font-semibold">Fantasmas</th>
                <th className="px-3 py-2 text-right font-semibold">Qualidade</th>
              </tr>
            </thead>
            <tbody>
              {perBrokerDuration.map((r) => (
                <tr key={r.brokerId} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                  <td className="px-3 py-3 font-semibold" style={{ color: T.sand, fontFamily: T.sora }}>{r.name}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.total}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums" style={{ color: T.gold }}>{fmtDur(Math.round(r.totalSecs))}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtDur(r.avg)}</td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T.textDim }}>{fmtDur(r.maxDur)}</td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: r.fantasma > 0 ? T.red : T.textDim }}>{r.fantasma}</td>
                  <td className="px-3 py-3 text-right">
                    <span
                      className="inline-block rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums"
                      style={{
                        background: r.pctQualidade >= 50 ? T.greenSoft : T.redSoft,
                        color: r.pctQualidade >= 50 ? T.green : T.red,
                      }}
                    >
                      {r.pctQualidade}%
                    </span>
                  </td>
                </tr>
              ))}
              {perBrokerDuration.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center" style={{ color: T.textMute }}>Sem ligações registradas no período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Horário de pico */}
      <div className="p-5 sm:p-6" style={card}>
        <SectionHead title="Horário de pico por corretor" subtitle="Distribuição de ligações ao longo do dia (0h–23h)" />
        {hourly.length === 0 ? (
          <p className="py-8 text-center text-sm" style={{ color: T.textMute }}>Sem ligações no período selecionado.</p>
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
                <div key={row.broker.id} className="rounded-2xl p-4" style={{ background: T.bgSoft, border: `1px solid ${T.lineSoft}` }}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold" style={{ fontFamily: T.sora, color: T.sand }}>{row.broker.name}</span>
                    <span className="text-[11px]" style={{ color: T.textDim }}>
                      {row.total} ligação(ões) · pico às <b style={{ color: T.gold }}>{String(peakIdx).padStart(2, "0")}h</b>
                    </span>
                  </div>
                  <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full">
                    <defs>
                      <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={T.gold} stopOpacity="0.4" />
                        <stop offset="100%" stopColor={T.gold} stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {[0.25, 0.5, 0.75].map((f) => (
                      <line key={f} x1={P} x2={W - P} y1={P + (H - P * 2) * f} y2={P + (H - P * 2) * f}
                        stroke="#ffffff" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.08" />
                    ))}
                    <path d={area} fill={`url(#${gid})`} />
                    <path d={path} fill="none" stroke={T.gold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    {row.hours[peakIdx] > 0 && (
                      <>
                        <line x1={peakX} x2={peakX} y1={peakY} y2={H - P} stroke={T.gold} strokeWidth="0.7" strokeDasharray="2 2" opacity="0.5" />
                        <circle cx={peakX} cy={peakY} r="3.5" fill={T.bg} stroke={T.gold} strokeWidth="1.6" />
                      </>
                    )}
                  </svg>
                  <div className="flex justify-between px-1 text-[10px] tabular-nums" style={{ color: T.textMute }}>
                    <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Ranking */}
      <div className="p-5 sm:p-6" style={card}>
        <SectionHead title="Ranking de corretores" subtitle="Ordenado por contatos únicos trabalhados" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.2em]" style={{ color: T.textMute, fontFamily: T.sora }}>
                <th className="w-12 px-3 py-2 text-left font-semibold">#</th>
                <th className="px-3 py-2 text-left font-semibold">Corretor</th>
                <th className="w-24 px-3 py-2 text-right font-semibold">Ligações</th>
                <th className="min-w-[160px] px-3 py-2 text-left font-semibold">Progresso</th>
                <th className="px-3 py-2 text-right font-semibold">Atendidas</th>
                <th className="px-3 py-2 text-right font-semibold">Agendam.</th>
                <th className="px-3 py-2 text-right font-semibold">Taxa</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r, i) => (
                <tr key={r.broker.id} style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                  <td className="px-3 py-3">
                    <span
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold"
                      style={{
                        background: i === 0 ? T.gold : i < 3 ? T.goldDim : "rgba(255,255,255,0.05)",
                        color: i === 0 ? T.bg : i < 3 ? T.gold : T.textMute,
                        fontFamily: T.sora,
                      }}
                    >
                      {i + 1}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-semibold" style={{ color: T.sand, fontFamily: T.sora }}>{r.broker.name}</td>
                  <td className="px-3 py-3 text-right text-2xl font-semibold tabular-nums" style={{ fontFamily: T.sora, letterSpacing: "-0.03em", color: T.text }}>
                    {r.total}
                  </td>
                  <td className="px-3 py-3">
                    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${(r.total / max) * 100}%`, background: `linear-gradient(90deg, ${T.gold}, ${T.goldSoft})` }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T.green }}>{r.attended}</td>
                  <td className="px-3 py-3 text-right tabular-nums" style={{ color: T.blue }}>{r.scheduled}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums" style={{ color: T.gold }}>{r.rate}%</td>
                </tr>
              ))}
              {ranking.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center" style={{ color: T.textMute }}>Cadastre corretores para ver o ranking.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
