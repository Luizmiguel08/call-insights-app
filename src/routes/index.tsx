import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Phone, PhoneOff, PhoneCall, Plus, User, Clock, CheckCircle2, XCircle,
  Calendar, Trash2, MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatClock, formatDuration, todayRange } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Discador — Controle de ligações" },
      { name: "description", content: "Discador com cronômetro automático e registro de ligações por corretor." },
    ],
  }),
  component: DialerPage,
});

type Broker = { id: string; name: string; color: string };
type Call = {
  id: string;
  broker_id: string;
  client_name: string;
  phone: string | null;
  attended: boolean;
  scheduled: boolean;
  notes: string | null;
  duration_seconds: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

function DialerPage() {
  const qc = useQueryClient();
  const [brokerId, setBrokerId] = useState<string | null>(null);
  const [newClient, setNewClient] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishData, setFinishData] = useState({
    attended: true, scheduled: false, notes: "",
  });
  const startRef = useRef<number | null>(null);

  const { data: brokers = [] } = useQuery({
    queryKey: ["brokers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brokers").select("*").order("name");
      if (error) throw error;
      return data as Broker[];
    },
  });

  useEffect(() => {
    if (!brokerId && brokers.length) {
      const saved = localStorage.getItem("brokerId");
      setBrokerId(saved && brokers.find(b => b.id === saved) ? saved : brokers[0].id);
    }
  }, [brokers, brokerId]);

  useEffect(() => {
    if (brokerId) localStorage.setItem("brokerId", brokerId);
  }, [brokerId]);

  const { start, end } = useMemo(() => todayRange(), []);
  const { data: calls = [] } = useQuery({
    queryKey: ["calls", brokerId, start],
    enabled: !!brokerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("calls").select("*")
        .eq("broker_id", brokerId!)
        .gte("created_at", start).lte("created_at", end)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Call[];
    },
  });

  // Live timer
  useEffect(() => {
    if (!activeCallId) return;
    startRef.current = Date.now();
    setElapsed(0);
    const i = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000));
    }, 1000);
    return () => clearInterval(i);
  }, [activeCallId]);

  const createCall = useMutation({
    mutationFn: async (input: { client_name: string; phone: string }) => {
      if (!brokerId) throw new Error("Selecione um corretor");
      const { data, error } = await supabase.from("calls").insert({
        broker_id: brokerId,
        client_name: input.client_name,
        phone: input.phone || null,
        started_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      return data as Call;
    },
    onSuccess: (call) => {
      setActiveCallId(call.id);
      setNewClient(""); setNewPhone("");
      qc.invalidateQueries({ queryKey: ["calls"] });
      if (call.phone) window.location.href = `tel:${call.phone}`;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const finishCall = useMutation({
    mutationFn: async () => {
      if (!activeCallId) return;
      const duration = Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000);
      const { error } = await supabase.from("calls").update({
        attended: finishData.attended,
        scheduled: finishData.scheduled,
        notes: finishData.notes || null,
        duration_seconds: duration,
        ended_at: new Date().toISOString(),
      }).eq("id", activeCallId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Ligação registrada");
      setActiveCallId(null);
      setFinishOpen(false);
      setFinishData({ attended: true, scheduled: false, notes: "" });
      qc.invalidateQueries({ queryKey: ["calls"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCall = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("calls").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["calls"] }),
  });

  const activeCall = calls.find(c => c.id === activeCallId);
  const broker = brokers.find(b => b.id === brokerId);

  const stats = useMemo(() => {
    const total = calls.length;
    const attended = calls.filter(c => c.attended).length;
    const scheduled = calls.filter(c => c.scheduled).length;
    const totalTime = calls.reduce((s, c) => s + (c.duration_seconds || 0), 0);
    return { total, attended, scheduled, totalTime };
  }, [calls]);

  const handleStart = () => {
    if (!newClient.trim()) {
      toast.error("Informe o nome do cliente");
      return;
    }
    createCall.mutate({ client_name: newClient.trim(), phone: newPhone.trim() });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-foreground">Discador</h1>
            <p className="text-sm text-muted-foreground">
              Registre suas ligações de hoje · {new Date().toLocaleDateString("pt-BR", {
                weekday: "long", day: "numeric", month: "long",
              })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {brokers.map((b) => (
              <button
                key={b.id}
                onClick={() => setBrokerId(b.id)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all",
                  brokerId === b.id
                    ? "border-primary bg-primary/10 text-foreground shadow-elegant"
                    : "border-transparent bg-card text-muted-foreground hover:border-border",
                )}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                {b.name}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Phone} label="Ligações" value={stats.total} accent="primary" />
          <StatCard icon={CheckCircle2} label="Atenderam" value={stats.attended} accent="success" />
          <StatCard icon={Calendar} label="Agendaram" value={stats.scheduled} accent="warning" />
          <StatCard icon={Clock} label="Tempo total" value={formatDuration(stats.totalTime)} accent="primary" />
        </div>

        {/* Dialer card */}
        <Card className="overflow-hidden border-0 shadow-elegant">
          <div className="bg-gradient-primary p-6 text-primary-foreground">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider opacity-80">Corretor ativo</p>
                <p className="font-display text-2xl font-bold">{broker?.name ?? "—"}</p>
              </div>
              {activeCall && (
                <div className="flex items-center gap-3 rounded-xl bg-white/15 px-4 py-2 backdrop-blur-sm">
                  <div className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
                  </div>
                  <div>
                    <p className="text-xs opacity-80">Em ligação</p>
                    <p className="font-mono text-xl font-bold tabular-nums">{formatClock(elapsed)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4 p-6">
            {activeCall ? (
              <div className="space-y-4">
                <div className="rounded-xl border bg-accent/40 p-4">
                  <p className="text-xs text-muted-foreground">Cliente atual</p>
                  <p className="text-lg font-semibold text-foreground">{activeCall.client_name}</p>
                  {activeCall.phone && (
                    <p className="text-sm text-muted-foreground">{activeCall.phone}</p>
                  )}
                </div>
                <Button
                  size="lg"
                  variant="destructive"
                  className="w-full"
                  onClick={() => setFinishOpen(true)}
                >
                  <PhoneOff className="mr-2 h-5 w-5" />
                  Finalizar ligação
                </Button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  placeholder="Nome do cliente"
                  value={newClient}
                  onChange={(e) => setNewClient(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleStart()}
                />
                <Input
                  placeholder="Telefone (opcional)"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleStart()}
                />
                <Button
                  size="lg"
                  onClick={handleStart}
                  disabled={createCall.isPending || !brokerId}
                  className="bg-gradient-primary shadow-elegant"
                >
                  <PhoneCall className="mr-2 h-5 w-5" />
                  Iniciar
                </Button>
              </div>
            )}
          </div>
        </Card>

        {/* Calls today */}
        <div className="space-y-3">
          <h2 className="font-display text-lg font-bold text-foreground">Ligações de hoje</h2>
          {calls.length === 0 ? (
            <Card className="p-10 text-center">
              <Phone className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm text-muted-foreground">
                Nenhuma ligação registrada hoje. Inicie a primeira acima.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {calls.map((c) => (
                <Card key={c.id} className="flex items-center gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent">
                    <User className="h-4 w-4 text-accent-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-foreground">{c.client_name}</p>
                      {c.id === activeCallId && (
                        <Badge className="bg-primary/15 text-primary hover:bg-primary/15">Em curso</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {c.phone && <span>{c.phone}</span>}
                      <span>{new Date(c.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                      {c.duration_seconds > 0 && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {formatDuration(c.duration_seconds)}
                        </span>
                      )}
                      {c.notes && (
                        <span className="flex items-center gap-1 truncate">
                          <MessageSquare className="h-3 w-3" /> {c.notes}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {c.attended ? (
                      <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Atendeu
                      </Badge>
                    ) : c.ended_at ? (
                      <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                        <XCircle className="mr-1 h-3 w-3" /> Não
                      </Badge>
                    ) : null}
                    {c.scheduled && (
                      <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning-foreground">
                        <Calendar className="mr-1 h-3 w-3" /> Agendou
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="icon" variant="ghost"
                    onClick={() => deleteCall.mutate(c.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Finish dialog */}
      <Dialog open={finishOpen} onOpenChange={setFinishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalizar ligação</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-accent/40 p-3 text-center">
              <p className="text-xs text-muted-foreground">Duração</p>
              <p className="font-mono text-3xl font-bold tabular-nums">{formatClock(elapsed)}</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="att">Cliente atendeu?</Label>
              <Switch id="att" checked={finishData.attended}
                onCheckedChange={(v) => setFinishData(d => ({ ...d, attended: v }))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="sch">Agendou visita?</Label>
              <Switch id="sch" checked={finishData.scheduled}
                onCheckedChange={(v) => setFinishData(d => ({ ...d, scheduled: v }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="obs">Observações</Label>
              <Textarea id="obs" rows={3} placeholder="Ex: ajustando proposta..."
                value={finishData.notes}
                onChange={(e) => setFinishData(d => ({ ...d, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinishOpen(false)}>Cancelar</Button>
            <Button onClick={() => finishCall.mutate()} disabled={finishCall.isPending}
              className="bg-gradient-primary">
              Salvar ligação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function StatCard({
  icon: Icon, label, value, accent,
}: { icon: typeof Phone; label: string; value: string | number; accent: "primary" | "success" | "warning" }) {
  const accentMap = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning-foreground",
  };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", accentMap[accent])}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="font-display text-xl font-bold text-foreground">{value}</p>
        </div>
      </div>
    </Card>
  );
}
