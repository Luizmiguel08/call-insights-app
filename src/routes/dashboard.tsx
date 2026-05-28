import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trophy, Phone, Clock, Calendar, CheckCircle2 } from "lucide-react";
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
      { name: "description", content: "Ranking de ligações e tempo de chamada por corretor." },
    ],
  }),
  component: DashboardPage,
});

type Broker = { id: string; name: string; color: string };
type Call = { id: string; broker_id: string; attended: boolean; scheduled: boolean; duration_seconds: number; created_at: string };

function DashboardPage() {
  const [period, setPeriod] = useState<"today" | "week" | "month">("today");

  const range = useMemo(() => {
    const start = new Date();
    const end = new Date();
    if (period === "today") {
      start.setHours(0, 0, 0, 0);
    } else if (period === "week") {
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
    } else {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
    }
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
    queryFn: async () => {
      const { data, error } = await supabase.from("calls").select("*")
        .gte("created_at", range.start).lte("created_at", range.end);
      if (error) throw error;
      return data as Call[];
    },
  });

  const ranking = useMemo(() => {
    const map = new Map(brokers.map(b => [b.id, {
      broker: b, total: 0, attended: 0, scheduled: 0, time: 0,
    }]));
    for (const c of calls) {
      const row = map.get(c.broker_id);
      if (!row) continue;
      row.total += 1;
      if (c.attended) row.attended += 1;
      if (c.scheduled) row.scheduled += 1;
      row.time += c.duration_seconds || 0;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [brokers, calls]);

  const totals = useMemo(() => ({
    calls: calls.length,
    attended: calls.filter(c => c.attended).length,
    scheduled: calls.filter(c => c.scheduled).length,
    time: calls.reduce((s, c) => s + (c.duration_seconds || 0), 0),
  }), [calls]);

  const max = Math.max(1, ...ranking.map(r => r.total));

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
              <Button
                key={p}
                variant={period === p ? "default" : "ghost"}
                size="sm"
                onClick={() => setPeriod(p)}
                className={cn("h-8", period === p && "bg-gradient-primary")}
              >
                {p === "today" ? "Hoje" : p === "week" ? "7 dias" : "Mês"}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <BigStat icon={Phone} label="Ligações" value={totals.calls} accent="primary" />
          <BigStat icon={CheckCircle2} label="Atenderam" value={totals.attended} accent="success" />
          <BigStat icon={Calendar} label="Agendaram" value={totals.scheduled} accent="warning" />
          <BigStat icon={Clock} label="Tempo total" value={formatDuration(totals.time)} accent="primary" />
        </div>

        <Card className="p-6">
          <div className="mb-5 flex items-center gap-2">
            <Trophy className="h-5 w-5 text-warning" />
            <h2 className="font-display text-lg font-bold text-foreground">Ranking de corretores</h2>
          </div>
          {ranking.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum corretor cadastrado ainda.
            </p>
          ) : (
            <div className="space-y-4">
              {ranking.map((row, i) => {
                const pct = (row.total / max) * 100;
                const rate = row.total ? Math.round((row.attended / row.total) * 100) : 0;
                return (
                  <div key={row.broker.id} className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full font-display text-sm font-bold",
                          i === 0 && "bg-gradient-primary text-primary-foreground shadow-elegant",
                          i === 1 && "bg-accent text-accent-foreground",
                          i === 2 && "bg-accent/60 text-accent-foreground",
                          i > 2 && "bg-muted text-muted-foreground",
                        )}>
                          {i + 1}
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">{row.broker.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.attended} atendidas · {row.scheduled} agendadas · {formatDuration(row.time)} · {rate}% taxa
                          </p>
                        </div>
                      </div>
                      <p className="font-display text-2xl font-bold tabular-nums text-foreground">
                        {row.total}
                      </p>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: row.broker.color,
                        }}
                      />
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
