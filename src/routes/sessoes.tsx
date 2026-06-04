import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Clock, Coffee } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDuration } from "@/lib/format";


export const Route = createFileRoute("/sessoes")({
  head: () => ({
    meta: [
      { title: "Sessões — Presença dos corretores" },
      { name: "description", content: "Histórico de presença e pausas dos corretores." },
    ],
  }),
  component: SessionsPage,
});

const db = supabase as any;

type Broker = { id: string; name: string; color: string };
type Session = {
  id: string; broker_id: string;
  started_at: string; ended_at: string | null;
};
type Pause = {
  id: string; session_id: string; broker_id: string;
  reason: string; started_at: string; ended_at: string | null; duration_seconds: number;
};

function SessionsPage() {
  const queryClient = useQueryClient();

  const { data: brokers = [] } = useQuery({
    queryKey: ["brokers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brokers").select("*").order("name");
      if (error) throw error;
      return data as Broker[];
    },
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const { data, error } = await db.from("broker_sessions").select("*")
        .order("started_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data as Session[];
    },
    refetchInterval: 60_000,
  });

  const { data: pauses = [] } = useQuery({
    queryKey: ["pauses-all"],
    queryFn: async () => {
      const { data, error } = await db.from("broker_pauses").select("*")
        .order("started_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data as Pause[];
    },
    refetchInterval: 60_000,
  });

  // Realtime: atualiza imediatamente quando sessões/pausas mudam.
  useEffect(() => {
    const ch = supabase
      .channel(`sessoes-sync-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "broker_sessions" }, () => {
        queryClient.invalidateQueries({ queryKey: ["sessions"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "broker_pauses" }, () => {
        queryClient.invalidateQueries({ queryKey: ["pauses-all"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [queryClient]);


  const grouped = useMemo(() => {
    return sessions.map((s) => {
      const broker = brokers.find((b) => b.id === s.broker_id);
      const sessPauses = pauses.filter((p) => p.session_id === s.id);
      const pauseTime = sessPauses.reduce((acc, p) => {
        if (p.ended_at) return acc + p.duration_seconds;
        return acc + Math.floor((Date.now() - new Date(p.started_at).getTime()) / 1000);
      }, 0);
      const endMs = s.ended_at ? new Date(s.ended_at).getTime() : Date.now();
      const totalTime = Math.floor((endMs - new Date(s.started_at).getTime()) / 1000);
      return { session: s, broker, pauses: sessPauses, pauseTime, totalTime, active: !s.ended_at };
    });
  }, [sessions, brokers, pauses]);

  const active = grouped.filter((g) => g.active);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground">Sessões e presença</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe quem está conectado, em pausa, e o histórico completo de presença.
          </p>
        </div>

        <Card className="overflow-hidden border-0 shadow-elegant">
          <div className="bg-gradient-primary p-5 text-primary-foreground">
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5" />
              <div>
                <p className="font-display text-lg font-bold">Ao vivo</p>
                <p className="text-xs opacity-90">{active.length} corretor(es) online agora</p>
              </div>
            </div>
          </div>
          <div className="p-5">
            {active.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Ninguém conectado no momento.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {active.map((g) => {
                  const openPause = g.pauses.find((p) => !p.ended_at);
                  return (
                    <div key={g.session.id} className="rounded-xl border bg-card p-4">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                            style={{ backgroundColor: g.broker?.color ?? "var(--primary)" }} />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: g.broker?.color ?? "var(--primary)" }} />
                        </span>
                        <p className="font-semibold text-foreground">{g.broker?.name ?? "—"}</p>
                        {openPause ? (
                          <Badge className="bg-warning/20 text-warning-foreground hover:bg-warning/20">
                            <Coffee className="mr-1 h-3 w-3" /> {openPause.reason}
                          </Badge>
                        ) : (
                          <Badge className="bg-success/15 text-success hover:bg-success/15">Disponível</Badge>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Entrou às {new Date(g.session.started_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        {" · "}
                        Online há {formatDuration(g.totalTime - g.pauseTime)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-display text-lg font-bold">Histórico de sessões</h2>
          {grouped.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma sessão registrada ainda. Os corretores iniciam sessão no discador.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {grouped.map((g) => (
                <div key={g.session.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="h-8 w-1 rounded-full" style={{ backgroundColor: g.broker?.color ?? "var(--muted)" }} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">{g.broker?.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(g.session.started_at).toLocaleString("pt-BR")}
                      {" → "}
                      {g.session.ended_at ? new Date(g.session.ended_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : <span className="text-success">em andamento</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{formatDuration(g.totalTime)}</span>
                    <span className="text-muted-foreground">total</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <Coffee className="h-3.5 w-3.5 text-warning" />
                    <span className="font-medium">{formatDuration(g.pauseTime)}</span>
                    <span className="text-muted-foreground">em pausa</span>
                  </div>
                  <Badge variant="outline">
                    {formatDuration(g.totalTime - g.pauseTime)} produtivo
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
