import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Phone, Clock, Calendar, CheckCircle2, Coffee, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDuration, OUTCOME_LABELS, type OutcomeKey } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Ranking de corretores" },
      { name: "description", content: "Ranking, TMA e métricas de tabulação por corretor." },
    ],
  }),
  component: DashboardPage,
});

const db = supabase as any;

type Broker = { id: string; name: string; color: string };
type Call = {
  id: string; broker_id: string; attended: boolean; scheduled: boolean;
  duration_seconds: number; created_at: string; outcome: OutcomeKey | null;
};
type Pause = {
  id: string; broker_id: string; started_at: string;
  ended_at: string | null; duration_seconds: number;
};

function DashboardPage() {
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");

  const range = useMemo(() => {
    const start = new Date();
    const end = new Date();
    if (period === "today") start.setHours(0, 0, 0, 0);
    else if (period === "week") { start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0); }
    else { start.setDate(1); start.setHours(0, 0, 0, 0); }
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [period]);

  const { data: brokers = [] } = useQuery({
    queryKey: ["brokers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brokers").select("*").order("name");
      if (error) throw error;
      return data as Broker[];
    },
  });

  const { data: calls = [] } = useQuery({
    queryKey: ["calls-all", range.start],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await db.from("calls").select("*")
        .gte("created_at", range.start).lte("created_at", range.end);
      if (error) throw error;
      return data as Call[];
    },
  });

  const { data: pauses = [] } = useQuery({
    queryKey: ["pauses", range.start],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await db.from("broker_pauses").select("*")
        .gte("started_at", range.start).lte("started_at", range.end);
      if (error) throw error;
      return data as Pause[];
    },
  });

  const contactKey = (c: Call & { client?: string; phone?: string; contact_id?: string | null }) => {
    const anyC = c as any;
    return anyC.contact_id ?? `${(anyC.client ?? "").trim().toLowerCase()}|${String(anyC.phone ?? "").replace(/\D/g, "")}`;
  };

  const ranking = useMemo(() => {
    const map = new Map(brokers.map((b) => [b.id, {
      broker: b, total: 0, attended: 0, scheduled: 0, time: 0, attendedTime: 0,
      pauseTime: 0,
      seen: new Set<string>(), seenAttended: new Set<string>(), seenScheduled: new Set<string>(),
      outcomes: { attended: 0, no_answer: 0, voicemail: 0, wrong_number: 0, callback: 0, not_interested: 0, scheduled: 0 } as Record<OutcomeKey, number>,
    }]));
    for (const c of calls) {
      const row = map.get(c.broker_id);
      if (!row) continue;
      const key = contactKey(c);
      if (!row.seen.has(key)) { row.seen.add(key); row.total += 1; }
      if (c.attended) {
        if (!row.seenAttended.has(key)) { row.seenAttended.add(key); row.attended += 1; }
        row.attendedTime += c.duration_seconds || 0;
      }
      if (c.scheduled && !row.seenScheduled.has(key)) { row.seenScheduled.add(key); row.scheduled += 1; }
      row.time += c.duration_seconds || 0;
      if (c.outcome) row.outcomes[c.outcome] += 1;
    }
    for (const p of pauses) {
      const row = map.get(p.broker_id);
      if (!row) continue;
      row.pauseTime += p.ended_at ? p.duration_seconds
        : Math.floor((Date.now() - new Date(p.started_at).getTime()) / 1000);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [brokers, calls, pauses]);

  const totals = useMemo(() => {
    const seen = new Set<string>();
    const seenAtt = new Set<string>();
    const seenSch = new Set<string>();
    let attTime = 0; let attCount = 0; let time = 0;
    for (const c of calls) {
      const key = contactKey(c);
      seen.add(key);
      if (c.attended) {
        seenAtt.add(key);
        attTime += c.duration_seconds || 0;
        attCount += 1;
      }
      if (c.scheduled) seenSch.add(key);
      time += c.duration_seconds || 0;
    }
    return {
      calls: seen.size,
      attended: seenAtt.size,
      scheduled: seenSch.size,
      time,
      avg: attCount ? Math.round(attTime / attCount) : 0,
    };
  }, [calls]);

  const max = Math.max(1, ...ranking.map((r) => r.total));

  // Distribuição por hora (0-23) por corretor — identifica horário de pico
  const hourly = useMemo(() => {
    const byBroker = new Map<string, { broker: Broker; hours: number[] }>();
    for (const b of brokers) byBroker.set(b.id, { broker: b, hours: new Array(24).fill(0) });
    for (const c of calls) {
      const row = byBroker.get(c.broker_id);
      if (!row) continue;
      const h = new Date(c.created_at).getHours();
      row.hours[h] += 1;
    }
    const rows = Array.from(byBroker.values()).filter((r) => r.hours.some((v) => v > 0));
    const maxH = Math.max(1, ...rows.flatMap((r) => r.hours));
    return { rows, maxH };
  }, [brokers, calls]);

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
              <p className="text-xs text-muted-foreground">Distribuição de ligações ao longo do dia (0–23h)</p>
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
                        {total} ligações · pico às <b className="text-foreground">{String(peakIdx).padStart(2, "0")}h</b>
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
                              title={`${String(h).padStart(2, "0")}h — ${v} ligação(ões)`}
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
                const pct = (row.total / max) * 100;
                const rate = row.total ? Math.round((row.attended / row.total) * 100) : 0;
                const tma = row.attended ? Math.round(row.attendedTime / row.attended) : 0;
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
                            {row.pauseTime > 0 && <> · <Coffee className="inline h-3 w-3" /> {formatDuration(row.pauseTime)} pausa</>}
                          </p>
                        </div>
                      </div>
                      <p className="font-display text-2xl font-bold tabular-nums text-foreground">{row.total}</p>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: row.broker.color }} />
                    </div>
                    {row.total > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {(Object.keys(row.outcomes) as OutcomeKey[]).map((k) => {
                          const v = row.outcomes[k];
                          if (!v) return null;
                          return (
                            <span key={k} className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {OUTCOME_LABELS[k]}: <b className="text-foreground">{v}</b>
                            </span>
                          );
                        })}
                      </div>
                    )}
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
