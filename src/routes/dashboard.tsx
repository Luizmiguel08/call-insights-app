import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy, Phone, Clock, Calendar, CheckCircle2, Coffee, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Ranking de corretores" },
      { name: "description", content: "Ranking, TMA e métricas por corretor." },
    ],
  }),
  component: DashboardPage,
});

const db = supabase as any;

type Broker = { id: string; name: string; color: string };
type KpiRow = {
  broker_id: string;
  day: string;
  calls: number;
  attended: number;
  scheduled: number;
  attempts: number;
  total_seconds: number;
  attended_seconds: number;
  attended_attempts: number;
};
type HourlyRow = { broker_id: string; day: string; hour: number; attempts: number };
type Pause = {
  id: string; broker_id: string; started_at: string;
  ended_at: string | null; duration_seconds: number;
};

function DashboardPage() {
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");
  const queryClient = useQueryClient();

  const range = useMemo(() => {
    // Janela em data local (America/Sao_Paulo) — bate com a view que agrega por day.
    const now = new Date();
    const tzOffsetMs = now.getTimezoneOffset() * 60_000;
    const today = new Date(now.getTime() - tzOffsetMs).toISOString().slice(0, 10);

    const startDate = new Date(now);
    if (period === "today") {
      // nada
    } else if (period === "week") {
      startDate.setDate(startDate.getDate() - 6);
    } else {
      startDate.setDate(1);
    }
    const startStr = new Date(startDate.getTime() - tzOffsetMs).toISOString().slice(0, 10);

    // Para a query de pausas (timestamp tz), recompõe ISO de início/fim do período.
    const startTs = new Date(`${startStr}T00:00:00`).toISOString();
    const endTs = new Date(`${today}T23:59:59.999`).toISOString();

    return { startDay: startStr, endDay: today, startTs, endTs };
  }, [period]);

  const { data: brokers = [] } = useQuery({
    queryKey: ["brokers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brokers").select("*").order("name");
      if (error) throw error;
      return data as Broker[];
    },
  });

  // KPIs já agregados e deduplicados no banco
  const { data: kpis = [] } = useQuery<KpiRow[]>({
    queryKey: ["kpis-daily", range.startDay, range.endDay],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("broker_kpis_daily").select("*")
        .gte("day", range.startDay).lte("day", range.endDay);
      if (error) throw error;
      return (data ?? []) as KpiRow[];
    },
  });

  // Distribuição por hora — também pré-agregada
  const { data: hourlyRows = [] } = useQuery<HourlyRow[]>({
    queryKey: ["hourly-agg", range.startDay, range.endDay],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("broker_calls_hourly").select("*")
        .gte("day", range.startDay).lte("day", range.endDay);
      if (error) throw error;
      return (data ?? []) as HourlyRow[];
    },
  });

  const { data: pauses = [] } = useQuery<Pause[]>({
    queryKey: ["pauses", range.startTs, range.endTs],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await db.from("broker_pauses").select("*")
        .gte("started_at", range.startTs).lte("started_at", range.endTs);
      if (error) throw error;
      return (data ?? []) as Pause[];
    },
  });

  // Realtime: invalida quando há novas calls/pauses, o banco recalcula a view automaticamente.
  useEffect(() => {
    const ch = supabase
      .channel(`dashboard-sync-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => {
        queryClient.invalidateQueries({ queryKey: ["kpis-daily"] });
        queryClient.invalidateQueries({ queryKey: ["hourly-agg"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "broker_pauses" }, () => {
        queryClient.invalidateQueries({ queryKey: ["pauses"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [queryClient]);

  // Ranking — somatório das linhas diárias por corretor (já vem deduplicado dia-a-dia)
  const ranking = useMemo(() => {
    const map = new Map(brokers.map((b) => [b.id, {
      broker: b, calls: 0, attempts: 0, attended: 0, scheduled: 0,
      totalSeconds: 0, attendedSeconds: 0, attendedAttempts: 0, pauseSeconds: 0,
    }]));
    for (const k of kpis) {
      const row = map.get(k.broker_id);
      if (!row) continue;
      row.calls += k.calls;
      row.attempts += k.attempts;
      row.attended += k.attended;
      row.scheduled += k.scheduled;
      row.totalSeconds += k.total_seconds;
      row.attendedSeconds += k.attended_seconds;
      row.attendedAttempts += k.attended_attempts;
    }
    for (const p of pauses) {
      const row = map.get(p.broker_id);
      if (!row) continue;
      row.pauseSeconds += p.ended_at ? p.duration_seconds
        : Math.floor((Date.now() - new Date(p.started_at).getTime()) / 1000);
    }
    return Array.from(map.values())
      .filter((r) => r.calls > 0 || r.pauseSeconds > 0 || brokers.length <= 12)
      .sort((a, b) => b.calls - a.calls);
  }, [brokers, kpis, pauses]);

  const totals = useMemo(() => {
    let calls = 0, attended = 0, scheduled = 0, totalSeconds = 0, attendedSeconds = 0, attendedAttempts = 0;
    for (const k of kpis) {
      calls += k.calls; attended += k.attended; scheduled += k.scheduled;
      totalSeconds += k.total_seconds; attendedSeconds += k.attended_seconds; attendedAttempts += k.attended_attempts;
    }
    return {
      calls, attended, scheduled, time: totalSeconds,
      avg: attendedAttempts ? Math.round(attendedSeconds / attendedAttempts) : 0,
    };
  }, [kpis]);

  const max = Math.max(1, ...ranking.map((r) => r.calls));

  const hourly = useMemo(() => {
    const byBroker = new Map<string, { broker: Broker; hours: number[] }>();
    for (const b of brokers) byBroker.set(b.id, { broker: b, hours: new Array(24).fill(0) });
    for (const r of hourlyRows) {
      const row = byBroker.get(r.broker_id);
      if (!row) continue;
      row.hours[r.hour] = (row.hours[r.hour] ?? 0) + r.attempts;
    }
    const rows = Array.from(byBroker.values()).filter((r) => r.hours.some((v) => v > 0));
    const maxH = Math.max(1, ...rows.flatMap((r) => r.hours));
    return { rows, maxH };
  }, [brokers, hourlyRows]);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Performance da equipe em tempo real</p>
          </div>
          <div className="flex gap-1 rounded-lg border bg-card p-1">
            {(["today", "week", "month"] as const).map((p) => (
              <Button key={p} variant={period === p ? "default" : "ghost"} size="sm"
                onClick={() => setPeriod(p)}
                className={cn("h-8", period === p && "bg-gradient-primary")}>
                {p === "today" ? "Hoje" : p === "week" ? "7 dias" : "Mês"}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <BigStat icon={Phone} label="Ligações" value={totals.calls} accent="primary" />
          <BigStat icon={CheckCircle2} label="Atenderam" value={totals.attended} accent="success" />
          <BigStat icon={Calendar} label="Agendaram" value={totals.scheduled} accent="warning" />
          <BigStat icon={Clock} label="Tempo total" value={formatDuration(totals.time)} accent="primary" />
          <BigStat icon={TrendingUp} label="TMA" value={formatDuration(totals.avg)} accent="primary" />
        </div>

        <Card className="p-6">
          <div className="mb-5 flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            <div>
              <h2 className="font-display text-lg font-bold text-foreground">Horário de pico por corretor</h2>
              <p className="text-xs text-muted-foreground">Distribuição de tentativas ao longo do dia (0–23h)</p>
            </div>
          </div>
          {hourly.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sem ligações no período.</p>
          ) : (
            <div className="space-y-5">
              {hourly.rows.map((row) => {
                const total = row.hours.reduce((s, v) => s + v, 0);
                const peakIdx = row.hours.indexOf(Math.max(...row.hours));
                return (
                  <div key={row.broker.id} className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-foreground">{row.broker.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {total} tentativas · pico às <b className="text-foreground">{String(peakIdx).padStart(2, "0")}h</b>
                      </p>
                    </div>
                    <div className="flex h-20 items-end gap-px rounded-md bg-muted/40 p-2">
                      {row.hours.map((v, h) => {
                        const pct = (v / hourly.maxH) * 100;
                        return (
                          <div key={h} className="group relative flex flex-1 flex-col items-center justify-end">
                            <div
                              className="w-full rounded-sm transition-all"
                              style={{
                                height: `${pct}%`,
                                minHeight: v > 0 ? 2 : 0,
                                backgroundColor: row.broker.color,
                                opacity: v > 0 ? 1 : 0.15,
                              }}
                              title={`${String(h).padStart(2, "0")}h — ${v} tentativa(s)`}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
                      <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <div className="mb-5 flex items-center gap-2">
            <Trophy className="h-5 w-5 text-warning" />
            <h2 className="font-display text-lg font-bold text-foreground">Ranking de corretores</h2>
          </div>
          {ranking.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum corretor cadastrado.</p>
          ) : (
            <div className="space-y-5">
              {ranking.map((row, i) => {
                const pct = (row.calls / max) * 100;
                const rate = row.calls ? Math.round((row.attended / row.calls) * 100) : 0;
                const tma = row.attendedAttempts ? Math.round(row.attendedSeconds / row.attendedAttempts) : 0;
                return (
                  <div key={row.broker.id} className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full font-display text-sm font-bold",
                          i === 0 && "bg-gradient-primary text-primary-foreground shadow-elegant",
                          i === 1 && "bg-accent text-accent-foreground",
                          i === 2 && "bg-accent/60 text-accent-foreground",
                          i > 2 && "bg-muted text-muted-foreground",
                        )}>{i + 1}</div>
                        <div>
                          <p className="font-semibold text-foreground">{row.broker.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.attended} atendidas · {row.scheduled} agendadas · TMA {formatDuration(tma)} · {rate}% taxa
                            {row.pauseSeconds > 0 && <> · <Coffee className="inline h-3 w-3" /> {formatDuration(row.pauseSeconds)} pausa</>}
                          </p>
                        </div>
                      </div>
                      <p className="font-display text-2xl font-bold tabular-nums text-foreground">{row.calls}</p>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: row.broker.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}

function BigStat({
  icon: Icon, label, value, accent,
}: { icon: typeof Phone; label: string; value: string | number; accent: "primary" | "success" | "warning" }) {
  const accentMap = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning-foreground",
  };
  return (
    <Card className="p-5">
      <div className={cn("mb-3 flex h-10 w-10 items-center justify-center rounded-lg", accentMap[accent])}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-display text-2xl font-bold text-foreground">{value}</p>
    </Card>
  );
}
