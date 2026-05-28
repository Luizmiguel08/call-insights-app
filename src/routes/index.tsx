import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Phone, PhoneOff, PhoneCall, User, Clock, CheckCircle2, XCircle, Calendar,
  SkipForward, Pause, Play, Power, Coffee, Voicemail, AlertTriangle, RotateCcw, Ban,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  formatClock, formatDuration, todayRange,
  OUTCOME_LABELS, OUTCOME_TONES, PAUSE_REASONS,
  type OutcomeKey,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Discador — Controle de ligações" },
      { name: "description", content: "Discador progressivo com tabulação, pausas e ranking ao vivo." },
    ],
  }),
  component: DialerPage,
});

const db = supabase as any;

type Broker = { id: string; name: string; color: string };
type Contact = {
  id: string; name: string; phone: string; broker_id: string | null;
  status: string; priority: number; notes: string | null; call_attempts: number;
};
type Call = {
  id: string; broker_id: string; client_name: string; phone: string | null;
  attended: boolean; scheduled: boolean; notes: string | null;
  duration_seconds: number; started_at: string | null; ended_at: string | null;
  created_at: string; outcome: OutcomeKey | null; contact_id: string | null;
};
type Session = { id: string; broker_id: string; started_at: string; ended_at: string | null };
type PauseRec = {
  id: string; session_id: string; broker_id: string; reason: string;
  started_at: string; ended_at: string | null; duration_seconds: number;
};

const OUTCOME_BUTTONS: { key: OutcomeKey; icon: typeof Phone; tone: string }[] = [
  { key: "attended",       icon: CheckCircle2, tone: "bg-success text-success-foreground hover:bg-success/90" },
  { key: "scheduled",      icon: Calendar,     tone: "bg-warning text-warning-foreground hover:bg-warning/90" },
  { key: "no_answer",      icon: XCircle,      tone: "bg-muted text-muted-foreground hover:bg-muted/80" },
  { key: "voicemail",      icon: Voicemail,    tone: "bg-muted text-muted-foreground hover:bg-muted/80" },
  { key: "callback",       icon: RotateCcw,    tone: "bg-primary text-primary-foreground hover:bg-primary/90" },
  { key: "wrong_number",   icon: AlertTriangle,tone: "bg-destructive text-destructive-foreground hover:bg-destructive/90" },
  { key: "not_interested", icon: Ban,          tone: "bg-destructive/80 text-destructive-foreground hover:bg-destructive/70" },
];

function DialerPage() {
  const qc = useQueryClient();
  const [brokerId, setBrokerId] = useState<string | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pauseElapsed, setPauseElapsed] = useState(0);
  const [finishOpen, setFinishOpen] = useState(false);
  const [pickedOutcome, setPickedOutcome] = useState<OutcomeKey | null>(null);
  const [notes, setNotes] = useState("");
  const [pauseOpen, setPauseOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualClient, setManualClient] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  const startRef = useRef<number | null>(null);
  const pauseStartRef = useRef<number | null>(null);

  /* ------------ Brokers ------------ */
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
      setBrokerId(saved && brokers.find((b) => b.id === saved) ? saved : brokers[0].id);
    }
  }, [brokers, brokerId]);

  useEffect(() => {
    if (brokerId) localStorage.setItem("brokerId", brokerId);
  }, [brokerId]);

  const broker = brokers.find((b) => b.id === brokerId);

  /* ------------ Session ------------ */
  const { data: session } = useQuery({
    queryKey: ["session", brokerId],
    enabled: !!brokerId,
    queryFn: async () => {
      const { data, error } = await db.from("broker_sessions").select("*")
        .eq("broker_id", brokerId!).is("ended_at", null)
        .order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Session | null;
    },
  });

  const { data: openPause } = useQuery({
    queryKey: ["open-pause", session?.id],
    enabled: !!session?.id,
    queryFn: async () => {
      const { data, error } = await db.from("broker_pauses").select("*")
        .eq("session_id", session!.id).is("ended_at", null)
        .order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return (data ?? null) as PauseRec | null;
    },
  });

  const startSession = useMutation({
    mutationFn: async () => {
      if (!brokerId) throw new Error("Selecione um corretor");
      const { error } = await db.from("broker_sessions").insert({ broker_id: brokerId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sessão iniciada");
      qc.invalidateQueries({ queryKey: ["session"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const endSession = useMutation({
    mutationFn: async () => {
      if (!session) return;
      // close any open pause first
      if (openPause) {
        const dur = Math.floor((Date.now() - new Date(openPause.started_at).getTime()) / 1000);
        await db.from("broker_pauses").update({
          ended_at: new Date().toISOString(), duration_seconds: dur,
        }).eq("id", openPause.id);
      }
      const { error } = await db.from("broker_sessions").update({
        ended_at: new Date().toISOString(),
      }).eq("id", session.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sessão encerrada");
      qc.invalidateQueries({ queryKey: ["session"] });
      qc.invalidateQueries({ queryKey: ["open-pause"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const startPause = useMutation({
    mutationFn: async (reason: string) => {
      if (!session) throw new Error("Inicie a sessão primeiro");
      const { error } = await db.from("broker_pauses").insert({
        session_id: session.id, broker_id: brokerId, reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setPauseOpen(false);
      qc.invalidateQueries({ queryKey: ["open-pause"] });
    },
  });

  const endPause = useMutation({
    mutationFn: async () => {
      if (!openPause) return;
      const dur = Math.floor((Date.now() - new Date(openPause.started_at).getTime()) / 1000);
      const { error } = await db.from("broker_pauses").update({
        ended_at: new Date().toISOString(), duration_seconds: dur,
      }).eq("id", openPause.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["open-pause"] });
    },
  });

  /* ------------ Queue (next contact) ------------ */
  const { data: nextContact } = useQuery({
    queryKey: ["next-contact", brokerId],
    enabled: !!brokerId && !activeCallId,
    queryFn: async () => {
      // First try contacts assigned to this broker
      const own = await db.from("contacts_queue").select("*")
        .eq("status", "pending").eq("broker_id", brokerId)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1).maybeSingle();
      if (own.data) return own.data as Contact;
      // Fallback to general queue (no broker assigned)
      const shared = await db.from("contacts_queue").select("*")
        .eq("status", "pending").is("broker_id", null)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(1).maybeSingle();
      return (shared.data ?? null) as Contact | null;
    },
  });

  /* ------------ Calls today ------------ */
  const { start, end } = useMemo(() => todayRange(), []);
  const { data: calls = [] } = useQuery({
    queryKey: ["calls", brokerId, start],
    enabled: !!brokerId,
    queryFn: async () => {
      const { data, error } = await db.from("calls").select("*")
        .eq("broker_id", brokerId!).gte("created_at", start).lte("created_at", end)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Call[];
    },
  });

  /* ------------ Timers ------------ */
  useEffect(() => {
    if (!activeCallId) return;
    startRef.current = Date.now();
    setElapsed(0);
    const i = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000));
    }, 1000);
    return () => clearInterval(i);
  }, [activeCallId]);

  useEffect(() => {
    if (!openPause) { setPauseElapsed(0); return; }
    pauseStartRef.current = new Date(openPause.started_at).getTime();
    const tick = () => setPauseElapsed(Math.floor((Date.now() - (pauseStartRef.current ?? Date.now())) / 1000));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [openPause]);

  /* ------------ Call mutations ------------ */
  const createCall = useMutation({
    mutationFn: async (input: { client_name: string; phone: string; contact_id: string | null }) => {
      if (!brokerId) throw new Error("Selecione um corretor");
      const { data, error } = await db.from("calls").insert({
        broker_id: brokerId,
        client_name: input.client_name,
        phone: input.phone || null,
        contact_id: input.contact_id,
        started_at: new Date().toISOString(),
      }).select().single();
      if (error) throw error;
      return data as Call;
    },
    onSuccess: (call) => {
      setActiveCallId(call.id);
      qc.invalidateQueries({ queryKey: ["calls"] });
      if (call.phone) window.location.href = `tel:${call.phone}`;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const finishCall = useMutation({
    mutationFn: async () => {
      if (!activeCallId || !pickedOutcome) return;
      const duration = Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000);
      const attended = pickedOutcome === "attended" || pickedOutcome === "scheduled";
      const scheduled = pickedOutcome === "scheduled";
      const { error: cErr } = await db.from("calls").update({
        attended, scheduled, outcome: pickedOutcome,
        notes: notes || null,
        duration_seconds: duration,
        ended_at: new Date().toISOString(),
      }).eq("id", activeCallId);
      if (cErr) throw cErr;

      // Update related contact
      const existingCall = calls.find((c) => c.id === activeCallId);
      const contactId = existingCall?.contact_id ?? nextContact?.id ?? null;

      if (contactId) {
        const newStatus = pickedOutcome === "callback" ? "pending" : "done";
        await db.from("contacts_queue").update({
          status: newStatus,
          last_called_at: new Date().toISOString(),
          call_attempts: ((nextContact?.call_attempts ?? 0)) + 1,
        }).eq("id", contactId);
      }
    },
    onSuccess: () => {
      toast.success("Ligação registrada");
      setActiveCallId(null);
      setFinishOpen(false);
      setPickedOutcome(null);
      setNotes("");
      qc.invalidateQueries({ queryKey: ["calls"] });
      qc.invalidateQueries({ queryKey: ["next-contact"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const skipContact = useMutation({
    mutationFn: async () => {
      if (!nextContact) return;
      const { error } = await db.from("contacts_queue").update({ status: "skipped" }).eq("id", nextContact.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["next-contact"] }),
  });

  /* ------------ Derived ------------ */
  const activeCall = calls.find((c) => c.id === activeCallId);
  const isPaused = !!openPause;
  const isOnline = !!session;

  const stats = useMemo(() => {
    const total = calls.length;
    const attended = calls.filter((c) => c.attended).length;
    const scheduled = calls.filter((c) => c.scheduled).length;
    const totalTime = calls.reduce((s, c) => s + (c.duration_seconds || 0), 0);
    const avg = attended ? Math.round(calls.filter(c => c.attended).reduce((s, c) => s + c.duration_seconds, 0) / attended) : 0;
    return { total, attended, scheduled, totalTime, avg };
  }, [calls]);

  const status = activeCall ? "Em ligação" : isPaused ? "Em pausa" : isOnline ? "Disponível" : "Offline";
  const statusTone = activeCall ? "bg-primary" : isPaused ? "bg-warning" : isOnline ? "bg-success" : "bg-muted";

  /* ------------ Handlers ------------ */
  const handleStartNext = () => {
    if (!nextContact) return toast.error("Fila vazia. Importe contatos em /fila");
    if (isPaused) return toast.error("Encerre a pausa primeiro");
    if (!isOnline) return toast.error("Inicie sua sessão primeiro");
    createCall.mutate({ client_name: nextContact.name, phone: nextContact.phone, contact_id: nextContact.id });
  };

  const handleStartManual = () => {
    if (!manualClient.trim()) return toast.error("Informe o nome");
    if (!isOnline) return toast.error("Inicie sua sessão primeiro");
    createCall.mutate({ client_name: manualClient.trim(), phone: manualPhone.trim(), contact_id: null });
    setManualOpen(false);
    setManualClient(""); setManualPhone("");
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-foreground">Discador</h1>
            <p className="text-sm text-muted-foreground">
              {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
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

        {/* Status bar */}
        <Card className="flex flex-wrap items-center gap-4 p-4">
          <div className="flex items-center gap-3">
            <span className={cn("h-3 w-3 rounded-full", statusTone)} />
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <p className="font-semibold text-foreground">{status}</p>
            </div>
          </div>
          <div className="h-10 w-px bg-border" />
          <div className="flex flex-wrap gap-2">
            {!isOnline ? (
              <Button onClick={() => startSession.mutate()} disabled={!brokerId || startSession.isPending}
                className="bg-gradient-primary">
                <Power className="mr-2 h-4 w-4" /> Iniciar sessão
              </Button>
            ) : (
              <>
                {isPaused ? (
                  <Button variant="default" onClick={() => endPause.mutate()}
                    className="bg-success text-success-foreground hover:bg-success/90">
                    <Play className="mr-2 h-4 w-4" /> Retomar ({formatClock(pauseElapsed)})
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setPauseOpen(true)} disabled={!!activeCallId}>
                    <Pause className="mr-2 h-4 w-4" /> Pausar
                  </Button>
                )}
                <Button variant="outline" onClick={() => endSession.mutate()} disabled={!!activeCallId}>
                  <Power className="mr-2 h-4 w-4" /> Encerrar sessão
                </Button>
              </>
            )}
          </div>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard icon={Phone} label="Ligações" value={stats.total} accent="primary" />
          <StatCard icon={CheckCircle2} label="Atenderam" value={stats.attended} accent="success" />
          <StatCard icon={Calendar} label="Agendaram" value={stats.scheduled} accent="warning" />
          <StatCard icon={Clock} label="Tempo total" value={formatDuration(stats.totalTime)} accent="primary" />
          <StatCard icon={Clock} label="TMA" value={formatDuration(stats.avg)} accent="primary" />
        </div>

        {/* Main dialer card */}
        <Card className="overflow-hidden border-0 shadow-elegant">
          <div className="bg-gradient-primary p-6 text-primary-foreground">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider opacity-80">Corretor</p>
                <p className="font-display text-2xl font-bold">{broker?.name ?? "—"}</p>
              </div>
              {activeCall && (
                <div className="flex items-center gap-3 rounded-xl bg-white/15 px-4 py-2 backdrop-blur-sm">
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
                  </span>
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
                  {activeCall.phone && <p className="text-sm text-muted-foreground">{activeCall.phone}</p>}
                </div>
                <Button size="lg" variant="destructive" className="w-full"
                  onClick={() => setFinishOpen(true)}>
                  <PhoneOff className="mr-2 h-5 w-5" />
                  Finalizar e tabular
                </Button>
              </div>
            ) : nextContact ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-xl border bg-accent/40 p-4">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Próximo na fila</p>
                    <p className="truncate text-lg font-semibold text-foreground">{nextContact.name}</p>
                    <p className="text-sm text-muted-foreground">{nextContact.phone}</p>
                  </div>
                  {nextContact.call_attempts > 0 && (
                    <Badge variant="outline">{nextContact.call_attempts}x tentativas</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="lg" onClick={handleStartNext} disabled={createCall.isPending || !isOnline || isPaused}
                    className="flex-1 bg-gradient-primary shadow-elegant">
                    <PhoneCall className="mr-2 h-5 w-5" />
                    Discar {nextContact.phone}
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => skipContact.mutate()}>
                    <SkipForward className="mr-2 h-4 w-4" /> Pular
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => setManualOpen(true)}>
                    Discagem avulsa
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-center">
                <div className="rounded-xl border border-dashed bg-muted/30 p-6">
                  <Phone className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-2 text-sm font-medium text-foreground">Fila vazia</p>
                  <p className="text-xs text-muted-foreground">Importe contatos em "Fila" ou faça uma discagem avulsa.</p>
                </div>
                <Button size="lg" variant="outline" onClick={() => setManualOpen(true)} disabled={!isOnline}>
                  Discagem avulsa
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
              <p className="mt-3 text-sm text-muted-foreground">Nenhuma ligação registrada hoje.</p>
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
                    </div>
                  </div>
                  {c.outcome && (
                    <Badge variant="outline" className={cn("border", OUTCOME_TONES[c.outcome])}>
                      {OUTCOME_LABELS[c.outcome]}
                    </Badge>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Finish dialog */}
      <Dialog open={finishOpen} onOpenChange={(o) => { setFinishOpen(o); if (!o) setPickedOutcome(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tabular ligação</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-accent/40 p-3 text-center">
              <p className="text-xs text-muted-foreground">Duração</p>
              <p className="font-mono text-3xl font-bold tabular-nums">{formatClock(elapsed)}</p>
            </div>
            <div>
              <Label className="mb-2 block">Qual foi o resultado?</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {OUTCOME_BUTTONS.map((o) => {
                  const Icon = o.icon;
                  const active = pickedOutcome === o.key;
                  return (
                    <button
                      key={o.key}
                      onClick={() => setPickedOutcome(o.key)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-lg border-2 px-3 py-3 text-xs font-semibold transition-all",
                        active ? "border-foreground shadow-elegant scale-[1.02]" : "border-transparent",
                        active ? o.tone : "bg-card text-foreground hover:bg-accent",
                      )}
                    >
                      <Icon className="h-5 w-5" />
                      {OUTCOME_LABELS[o.key]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="obs">Observações (opcional)</Label>
              <Textarea id="obs" rows={2} placeholder="Ex: ajustando proposta..."
                value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinishOpen(false)}>Cancelar</Button>
            <Button onClick={() => finishCall.mutate()} disabled={!pickedOutcome || finishCall.isPending}
              className="bg-gradient-primary">
              Salvar e próximo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pause dialog */}
      <Dialog open={pauseOpen} onOpenChange={setPauseOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Motivo da pausa</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 py-2">
            {PAUSE_REASONS.map((r) => (
              <Button key={r} variant="outline"
                onClick={() => startPause.mutate(r)}
                className="h-16 flex-col gap-1">
                <Coffee className="h-4 w-4" />
                {r}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual dial dialog */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Discagem avulsa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Nome do cliente</Label>
              <Input value={manualClient} onChange={(e) => setManualClient(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Telefone</Label>
              <Input value={manualPhone} onChange={(e) => setManualPhone(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>Cancelar</Button>
            <Button onClick={handleStartManual} className="bg-gradient-primary">
              <PhoneCall className="mr-2 h-4 w-4" /> Discar
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
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate font-display text-xl font-bold text-foreground">{value}</p>
        </div>
      </div>
    </Card>
  );
}
