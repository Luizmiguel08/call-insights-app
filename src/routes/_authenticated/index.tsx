import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Phone, History, BarChart3, Users, Trash2, Plus, Check, X, Calendar, UserCircle2, Zap, Undo2, Upload, PhoneCall, SkipForward, Target, ListPlus, LogOut, Cloud, MessageCircle, Pencil, Save, AlertTriangle, RefreshCw } from "lucide-react";
import fortalLogo from "@/assets/fortal-logo.png.asset.json";
import wolfBg from "@/assets/wolf-wall-street.png.asset.json";
import { useCloudState, newId, type Me } from "@/lib/cloud-state";
import { supabase } from "@/integrations/supabase/client";
import { useDialerSession } from "@/hooks/useDialerSession";
import { recordContactAttempt } from "@/hooks/useContactBuffer";
import { ConnectionIndicator } from "@/components/dialer/ConnectionIndicator";
import {
  type Broker, type Call, type Contact, type State, type Tab,
  todayISO, normalizedContactKey, callContactKey, uniqueContactCount, uniqueContactCountWhere,
  normalizePhone, telHref, DEFAULT_WA_TEMPLATE, renderWaMessage, waHrefFromMessage, logDialerError,
  fontDisplay, fontNumeric, inputCls,
  Field, YesNo, Kpi, Badge, Th, Td,
} from "@/lib/dialer-shared";


// Lazy-loaded heavy/secondary tabs — keeps initial bundle small for mobile.
const HistoricoTab = lazy(() => import("@/components/dialer/HistoricoTab"));
const DashboardTab = lazy(() => import("@/components/dialer/DashboardTab"));
const ErrosTab = lazy(() => import("@/components/dialer/ErrosTab"));

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "FORTAL — Inteligência Imobiliária" },
      { name: "description", content: "Sistema de controle de ligações para corretores imobiliários." },
    ],
  }),
  component: LigaCtrlApp,
});

function uid() {
  return newId();
}

function TabFallback() {
  return <div className="py-16 text-center text-sm text-zinc-500">Carregando…</div>;
}

function LigaCtrlApp() {
  const navigate = useNavigate();
  const { state, fullState, setState, hydrated, me, refetch: refetchCloud } = useCloudState();
  const [tab, setTab] = useState<Tab>("discador");
  // Único subscriber Realtime para o estado vivo do discador (espelha mobile↔desktop)
  const dialerSession = useDialerSession(me?.userId ?? null);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }


  // Aguardando aprovação do admin
  if (hydrated && me && !me.isAdmin && !me.approved) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#0f1117] text-zinc-100 px-4 relative" style={{ fontFamily: "'DM Sans', system-ui, sans-serif", backgroundImage: `linear-gradient(rgba(11,13,19,0.85), rgba(11,13,19,0.92)), url(${wolfBg.url})`, backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "fixed" }}>
        <div className="w-full max-w-md text-center">
          <img src={fortalLogo.url} alt="Fortal" width={96} height={96} className="mx-auto h-24 w-24 object-contain mb-6" />
          <div className="text-2xl text-[#c9a24c] tracking-[0.28em] font-medium mb-2" style={fontDisplay}>FORTAL</div>
          <div className="rounded-2xl border border-zinc-800 bg-[#171a23] p-6 mt-6">
            <h1 className="text-xl font-bold uppercase tracking-wider text-[#c9a24c]" style={fontDisplay}>Aguardando aprovação</h1>
            <p className="mt-3 text-sm text-zinc-400">Sua conta <strong className="text-zinc-200">{me.email}</strong> foi criada e está aguardando o Miguel aprovar e definir seu nome de corretor.</p>
            <button onClick={signOut} className="mt-6 w-full h-11 rounded-md border border-zinc-700 text-xs font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800" style={fontDisplay}>
              <LogOut className="inline h-4 w-4 mr-2" /> Sair
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = me?.isAdmin ?? false;
  const allTabs: { id: Tab; label: string; icon: typeof Phone; admin?: boolean }[] = [
    { id: "discador", label: "Discador", icon: PhoneCall },
    { id: "fila", label: "Fila", icon: ListPlus },
    { id: "rapido", label: "Rápido", icon: Zap },
    { id: "historico", label: "Histórico", icon: History },
    { id: "dashboard", label: "Dashboard", icon: BarChart3 },
    { id: "corretores", label: isAdmin ? "Equipe" : "Conta", icon: Users },
    { id: "erros", label: "Erros", icon: AlertTriangle, admin: true },
  ];
  const tabs = allTabs.filter((t) => !t.admin || isAdmin);

  return (
    <div className="min-h-[100dvh] bg-[#0f1117] text-zinc-100 pb-[env(safe-area-inset-bottom)] relative" style={{ fontFamily: "'DM Sans', system-ui, sans-serif", backgroundImage: `linear-gradient(rgba(11,13,19,0.92), rgba(11,13,19,0.96)), url(${wolfBg.url})`, backgroundSize: "cover", backgroundPosition: "center top", backgroundAttachment: "fixed", backgroundRepeat: "no-repeat" }}>
      <header className="border-b border-zinc-800/80 bg-[#0b0d13]/90 backdrop-blur sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-3 py-2 sm:px-6 sm:py-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <img
              src={fortalLogo.url}
              alt="Fortal Inteligência Imobiliária"
              width={40}
              height={40}
              className="h-10 w-10 sm:h-12 sm:w-12 object-contain drop-shadow-[0_0_12px_rgba(201,162,76,0.35)]"
            />
            <div className="leading-none">
              <div className="text-xl sm:text-2xl text-[#c9a24c] tracking-[0.24em] font-medium" style={fontDisplay}>FORTAL</div>
              <div className="text-[9px] sm:text-[10px] uppercase tracking-[0.34em] text-zinc-500 mt-1.5 italic" style={fontDisplay}>Inteligência Imobiliária</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ConnectionIndicator state={dialerSession.isConnected} lastSyncAt={dialerSession.lastSyncAt} />
            <div className="text-right text-[10px] sm:text-xs uppercase tracking-widest text-zinc-500">
              <div className="hidden sm:flex items-center justify-end gap-1 text-[#c9a24c]"><Cloud className="h-3 w-3" /> {hydrated ? "sincronizado" : "carregando..."}</div>
              <div className="text-zinc-300 font-semibold">{new Date().toLocaleDateString("pt-BR")}</div>
            </div>

            <button
              onClick={signOut}
              title="Sair"
              className="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-700 text-zinc-400 hover:text-[#c9a24c] hover:border-[#c9a24c]/60"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-2 sm:px-4 overflow-x-auto no-scrollbar">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                  active
                    ? "border-[#c9a24c] text-[#c9a24c]"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
                style={fontDisplay}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-8">
        {tab === "discador" && <DiscadorTab state={state} setState={setState} goFila={() => setTab("fila")} refetchCloud={refetchCloud} userId={me?.userId ?? null} dialerSession={dialerSession} />}
        {tab === "fila" && <FilaTab state={state} setState={setState} isAdmin={isAdmin} me={me} refetchCloud={refetchCloud} />}
        {tab === "rapido" && <RapidoTab state={state} setState={setState} />}
        {tab === "historico" && <HistoricoTab state={state} setState={setState} me={me} isAdmin={isAdmin} />}
        {tab === "dashboard" && <DashboardTab state={state} />}
        {tab === "corretores" && <CorretoresTab state={state} fullState={fullState} setState={setState} isAdmin={isAdmin} me={me} />}
        {tab === "erros" && isAdmin && <ErrosTab />}
      </main>
    </div>
  );
}


/* ---------------- MODO RÁPIDO ---------------- */

function RapidoTab({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const [date, setDate] = useState(todayISO());
  const [brokerId, setBrokerId] = useState(state.brokers[0]?.id ?? "");
  const [client, setClient] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!state.brokers.length) return;
    if (!brokerId || !state.brokers.some((b) => b.id === brokerId)) setBrokerId(state.brokers[0].id);
  }, [state.brokers, brokerId]);
  useEffect(() => { nameRef.current?.focus(); }, [brokerId, date]);

  function quickSave(attended: boolean, scheduled: boolean) {
    const name = client.trim();
    if (!name) { toast.error("Digite o nome do cliente"); nameRef.current?.focus(); return; }
    if (!brokerId) { toast.error("Selecione um corretor"); return; }
    const normalized = phone.trim() ? normalizePhone(phone) : undefined;
    const call: Call = { id: uid(), date, brokerId, client: name, phone: normalized, attended, scheduled, note: note.trim(), createdAt: Date.now() };
    setState((s) => ({ ...s, calls: [call, ...s.calls] }));
    setClient("");
    setPhone("");
    setNote("");
    setTimeout(() => nameRef.current?.focus(), 0);
  }

  function addOnly() {
    const name = client.trim();
    if (!name) { toast.error("Digite o nome do cliente"); nameRef.current?.focus(); return; }
    if (!brokerId) { toast.error("Selecione um corretor"); return; }
    const normalized = phone.trim() ? normalizePhone(phone) : undefined;
    const call: Call = { id: uid(), date, brokerId, client: name, phone: normalized, attended: false, scheduled: false, note: note.trim(), createdAt: Date.now() };
    setState((s) => ({ ...s, calls: [call, ...s.calls] }));
    toast.success("Adicionado ao histórico", { description: name });
    setClient("");
    setPhone("");
    setNote("");
    setTimeout(() => nameRef.current?.focus(), 0);
  }

  function undoLast() {
    const last = state.calls.find((c) => c.brokerId === brokerId && c.date === date);
    if (!last) { toast.error("Nada para desfazer"); return; }
    setState((s) => ({ ...s, calls: s.calls.filter((c) => c.id !== last.id) }));
    toast.success("Desfeito", { description: last.client });
  }

  function onNameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undoLast(); }
  }

  const dialHref = phone.trim() ? telHref(phone) : "#";
  const dialReady = phone.trim().length > 0;

  const today = state.calls.filter((c) => c.brokerId === brokerId && c.date === date);
  const attendedUnique = uniqueContactCountWhere(today, (c) => c.attended);
  const totalUnique = uniqueContactCount(today);
  const k = {
    total: totalUnique,
    attended: attendedUnique,
    notAttended: Math.max(0, totalUnique - attendedUnique),
    scheduled: uniqueContactCountWhere(today, (c) => c.scheduled),
  };
  const brokerName = state.brokers.find((b) => b.id === brokerId)?.name ?? "—";

  return (
    <div className="space-y-5">
      {/* Barra: corretor + data + desfazer */}
      <div className="grid gap-3 sm:grid-cols-[1fr_220px_auto] items-end rounded-lg border border-zinc-800 bg-[#171a23] p-4">
        <Field label="Corretor">
          <div className="relative">
            <UserCircle2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <select value={brokerId} onChange={(e) => setBrokerId(e.target.value)} className={inputCls + " pl-9 appearance-none text-base font-semibold"}>
              {state.brokers.map((b) => <option key={b.id} value={b.id} className="bg-[#171a23]">{b.name}</option>)}
            </select>
          </div>
        </Field>
        <Field label="Data">
          <div className="relative">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls + " pl-9"} />
          </div>
        </Field>
        <button
          onClick={undoLast}
          className="h-10 flex items-center justify-center gap-2 rounded-md border border-zinc-700 px-4 text-xs font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
          style={fontDisplay}
          title="Ctrl+Z"
        >
          <Undo2 className="h-4 w-4" /> Desfazer
        </button>
      </div>

      {/* Número pontual: nome + telefone + discar */}
      <div className="rounded-lg border-2 border-[#c9a24c]/40 bg-[#171a23] p-6 shadow-[0_0_40px_-12px_#c9a24c]">
        <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-2xl font-bold uppercase tracking-wider" style={fontDisplay}>
            <Zap className="inline h-5 w-5 text-[#c9a24c] mb-1" /> Ligação avulsa — {brokerName}
          </h2>
          <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>
            Sem precisar entrar na fila
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_240px]">
          <Field label="Nome do cliente">
            <input
              ref={nameRef}
              value={client}
              onChange={(e) => setClient(e.target.value)}
              onKeyDown={onNameKeyDown}
              placeholder="Ex.: João Silva"
              className="h-12 w-full rounded-md border border-zinc-700 bg-[#0f1117] px-4 text-base font-semibold text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-[#c9a24c] focus:ring-2 focus:ring-[#c9a24c]/30"
              autoFocus
            />
          </Field>
          <Field label="Telefone">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(11) 99999-8888"
              inputMode="tel"
              className="h-12 w-full rounded-md border border-zinc-700 bg-[#0f1117] px-4 text-base font-mono text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-[#c9a24c] focus:ring-2 focus:ring-[#c9a24c]/30"
            />
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Observações (opcional)">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ex.: interesse em apto 2 quartos, retornar à tarde…"
              rows={2}
              className="w-full rounded-md border border-zinc-700 bg-[#0f1117] px-4 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-[#c9a24c] focus:ring-2 focus:ring-[#c9a24c]/30 resize-y"
            />
          </Field>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
          <a
            href={dialHref}
            onClick={(e) => { if (!dialReady) e.preventDefault(); }}
            className={`flex items-center justify-center gap-2 h-14 rounded-md text-base font-bold uppercase tracking-[0.18em] transition ${
              dialReady
                ? "bg-[#c9a24c] text-black hover:bg-[#e6c878]"
                : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
            }`}
            style={fontDisplay}
          >
            <PhoneCall className="h-5 w-5" />
            {dialReady ? `Discar ${normalizePhone(phone)}` : "Digite um telefone para discar"}
          </a>
          <button
            type="button"
            onClick={addOnly}
            className="flex items-center justify-center gap-2 h-14 rounded-md border-2 border-zinc-600 bg-[#0f1117] px-6 text-base font-bold uppercase tracking-[0.18em] text-zinc-200 hover:bg-zinc-800 hover:border-zinc-500 transition"
            style={fontDisplay}
            title="Salvar no histórico sem discar"
          >
            <Plus className="h-5 w-5" /> Adicionar
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <BigKey kbd="1" color="red" onClick={() => quickSave(false, false)}>
            <X className="h-5 w-5" strokeWidth={3} /> Não atendeu
          </BigKey>
          <BigKey kbd="2" color="green" onClick={() => quickSave(true, false)}>
            <Check className="h-5 w-5" strokeWidth={3} /> Atendeu
          </BigKey>
          <BigKey kbd="3" color="orange" onClick={() => quickSave(true, true)}>
            <Calendar className="h-5 w-5" strokeWidth={3} /> Agendou
          </BigKey>
        </div>
        <p className="mt-3 text-[11px] text-zinc-500">
          <strong className="text-zinc-400">Adicionar</strong> salva o lead no histórico sem discar. <strong className="text-zinc-400">Discar</strong> abre o telefone — depois marque o desfecho abaixo.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Ligações hoje" value={k.total} color="#c9a24c" />
        <Kpi label="Atendidas" value={k.attended} color="#22c55e" />
        <Kpi label="Não atend." value={k.notAttended} color="#ef4444" />
        <Kpi label="Agendadas" value={k.scheduled} color="#eab308" />
      </div>

      {/* Últimas registradas hoje */}
      {today.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-5">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-zinc-400" style={fontDisplay}>
            Últimas registradas — {brokerName}
          </h3>
          <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
            {today.slice(0, 30).map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded border border-zinc-800 bg-[#0f1117] px-3 py-2">
                <span className="flex-1 truncate text-sm font-medium text-zinc-100">
                  {c.client}
                  {c.phone && <span className="ml-2 font-mono text-xs text-zinc-500">{c.phone}</span>}
                </span>
                <Badge ok={c.attended} />
                {c.scheduled && <Badge ok={true} />}
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 tabular-nums">
                  {new Date(c.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <button
                  onClick={() => setState((s) => ({ ...s, calls: s.calls.filter((x) => x.id !== c.id) }))}
                  className="rounded p-1 text-zinc-600 hover:bg-red-500/10 hover:text-red-400"
                ><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


function BigKey({ kbd, color, onClick, children }: { kbd: string; color: "red" | "green" | "orange"; onClick: () => void; children: React.ReactNode }) {
  const map = {
    red: "border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-500",
    green: "border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500",
    orange: "border-[#c9a24c]/60 bg-[#c9a24c]/15 text-[#c9a24c] hover:bg-[#c9a24c]/25 hover:border-[#c9a24c]",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex h-16 items-center justify-center gap-2 rounded-md border-2 text-base font-bold uppercase tracking-wider transition ${map[color]}`}
      style={fontDisplay}
    >
      {children}
      <kbd className="absolute top-1.5 right-2 px-1.5 py-0.5 text-[10px] font-bold bg-black/40 rounded">{kbd}</kbd>
    </button>
  );
}

function OutcomeBtn({ variant, onClick, disabled, title, children }: { variant: "danger" | "success" | "gold"; onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode }) {
  const map = {
    danger:  "bg-red-500 hover:bg-red-400 shadow-[0_0_40px_-6px_rgba(239,68,68,0.6)]",
    success: "bg-emerald-500 hover:bg-emerald-400 shadow-[0_0_40px_-6px_rgba(34,197,94,0.6)]",
    gold:    "bg-amber-500 hover:bg-amber-400 shadow-[0_0_40px_-6px_rgba(245,158,11,0.6)]",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`group relative flex h-20 w-20 items-center justify-center rounded-full text-black transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${map[variant]}`}
    >
      <span className="relative flex items-center justify-center">{children}</span>
    </button>
  );
}

function StatPill({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-zinc-800 bg-[#13161f] px-2 py-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-zinc-500" style={fontDisplay}>{label}</span>
      <span className="text-lg sm:text-xl font-semibold leading-none tabular-nums" style={{ ...fontNumeric, color }}>{value}</span>
    </div>
  );
}

function SyncBadge({ ts }: { ts: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const label = diff < 5 ? "agora" : diff < 60 ? `${diff}s` : `${Math.floor(diff / 60)}min`;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-emerald-300 normal-case" title={new Date(ts).toLocaleTimeString("pt-BR")}>
      <span className="sync-dot" />
      sincronizado {label}
    </span>
  );
}



/* ---------------- CORRETORES / EQUIPE ---------------- */

function CorretoresTab({ state, fullState, setState, isAdmin, me }: { state: State; fullState: State; setState: React.Dispatch<React.SetStateAction<State>>; isAdmin: boolean; me: Me | null }) {

  // Visão corretor: só vê o próprio cadastro
  if (!isAdmin) {
    const myBroker = state.brokers[0];
    const myCalls = state.calls;
    const sch = uniqueContactCountWhere(myCalls, (c) => c.scheduled);
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-6">
          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>Sua conta</div>
          <div className="mt-2 text-3xl font-bold text-zinc-100" style={fontDisplay}>{myBroker?.name ?? me?.email}</div>
          <div className="mt-1 text-sm text-zinc-500">{me?.email}</div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Kpi label="Total ligações" value={uniqueContactCount(myCalls)} color="#c9a24c" />
          <Kpi label="Agendamentos" value={sch} color="#eab308" />
          <Kpi label="Meta diária" value={state.metaDaily} color="#22c55e" />
        </div>
      </div>
    );
  }

  // ADMIN: gerenciar equipe
  function approve(id: string) {
    setState((s) => ({ ...s, brokers: s.brokers.map((b) => b.id === id ? { ...b, approved: true } : b) }));
    toast.success("Corretor aprovado");
  }
  function rename(id: string, name: string) {
    setState((s) => ({ ...s, brokers: s.brokers.map((b) => b.id === id ? { ...b, name } : b) }));
  }
  function remove(id: string) {
    const broker = fullState.brokers.find((b) => b.id === id);
    const count = fullState.calls.filter((c) => c.brokerId === id).length;
    const msg = count ? `Remover ${broker?.name}? ${count} ligação(ões) também serão excluídas.` : `Remover ${broker?.name}?`;
    if (!confirm(msg)) return;
    setState((s) => ({
      ...s,
      brokers: s.brokers.filter((b) => b.id !== id),
      calls: s.calls.filter((c) => c.brokerId !== id),
      contacts: s.contacts.filter((c) => c.brokerId !== id),
    }));
    toast.success("Corretor removido");
  }

  const pending = fullState.brokers.filter((b) => !b.approved);
  const approved = fullState.brokers.filter((b) => b.approved);
  const myBrokerExists = !!fullState.brokers.find((b) => b.userId === me?.userId);

  async function addMeAsBroker() {
    if (!me) return;
    const name = prompt("Seu nome de corretor:", me.email.split("@")[0]);
    if (!name?.trim()) return;
    const { error } = await supabase
      .from("brokers")
      .insert({ name: name.trim(), user_id: me.userId, email: me.email, approved: true });
    if (error) return toast.error(error.message);
    toast.success("Você foi adicionado como corretor");
  }

  return (
    <div className="space-y-4">
      {!myBrokerExists && (
        <div className="rounded-lg border border-[#c9a24c]/40 bg-[#c9a24c]/10 p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-bold uppercase tracking-[0.2em] text-[#c9a24c]" style={fontDisplay}>Você ainda não é corretor</div>
            <div className="text-xs text-zinc-400 mt-1">Adicione-se à equipe pra ter sua própria fila de contatos.</div>
          </div>
          <button onClick={addMeAsBroker} className="h-10 rounded-md bg-[#c9a24c] px-4 text-xs font-bold uppercase tracking-wider text-black hover:bg-[#e6c878]" style={fontDisplay}>
            <Plus className="inline h-4 w-4 mr-1" strokeWidth={3} /> Me adicionar como corretor
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="rounded-lg border border-[#c9a24c]/40 bg-[#c9a24c]/10 p-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-[#c9a24c]" style={fontDisplay}>
            Aguardando aprovação ({pending.length})
          </h3>
          <div className="space-y-2">
            {pending.map((b) => (
              <PendingRow key={b.id} broker={b} onRename={(n) => rename(b.id, n)} onApprove={() => approve(b.id)} onReject={() => remove(b.id)} />
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-[#171a23]">
        <table className="w-full text-sm">
          <thead className="bg-[#0f1117] text-[11px] uppercase tracking-[0.18em] text-zinc-500" style={fontDisplay}>
            <tr>
              <Th>Corretor</Th>
              <Th className="text-right">Total Ligações</Th>
              <Th className="text-right">Agendamentos</Th>
              <Th className="w-10"></Th>
            </tr>
          </thead>
          <tbody>
            {approved.map((b) => {
              const own = fullState.calls.filter((c) => c.brokerId === b.id);
              const tot = uniqueContactCount(own);
              const sch = uniqueContactCountWhere(own, (c) => c.scheduled);
              return (
                <tr key={b.id} className="border-t border-zinc-800/80 hover:bg-zinc-900/40">
                  <Td className="font-semibold text-zinc-100">{b.name}</Td>
                  <Td className="text-right text-2xl tracking-tight" style={fontNumeric}>{tot}</Td>
                  <Td className="text-right text-2xl tracking-tight text-yellow-400" style={fontNumeric}>{sch}</Td>
                  <Td>
                    <button onClick={() => remove(b.id)} className="rounded p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Td>
                </tr>
              );
            })}
            {approved.length === 0 && (
              <tr><td colSpan={4} className="py-10 text-center text-zinc-500">Nenhum corretor aprovado ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PendingRow({ broker, onRename, onApprove, onReject }: { broker: Broker; onRename: (n: string) => void; onApprove: () => void; onReject: () => void }) {
  const [name, setName] = useState(broker.name);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-[#171a23] p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== broker.name && onRename(name.trim())}
        className="flex-1 min-w-[180px] h-9 rounded-md border border-zinc-700 bg-[#0f1117] px-3 text-sm text-zinc-100 outline-none focus:border-[#c9a24c]"
        placeholder="Nome do corretor"
      />
      <button
        onClick={() => { if (name.trim() && name !== broker.name) onRename(name.trim()); onApprove(); }}
        className="h-9 rounded-md bg-[#c9a24c] px-4 text-xs font-bold uppercase tracking-wider text-black hover:bg-[#e6c878]"
        style={fontDisplay}
      >
        <Check className="inline h-3.5 w-3.5 mr-1" strokeWidth={3} /> Aprovar
      </button>
      <button
        onClick={onReject}
        className="h-9 rounded-md border border-zinc-700 px-3 text-xs font-bold uppercase tracking-wider text-zinc-400 hover:bg-red-500/10 hover:text-red-400"
        style={fontDisplay}
      >
        <X className="inline h-3.5 w-3.5" strokeWidth={3} /> Rejeitar
      </button>
    </div>
  );
}


/* ---------------- DISCADOR ---------------- */

function DiscadorTab({ state, setState, goFila, refetchCloud, userId, dialerSession }: { state: State; setState: React.Dispatch<React.SetStateAction<State>>; goFila: () => void; refetchCloud: () => Promise<void>; userId: string | null; dialerSession: ReturnType<typeof useDialerSession> }) {
  const [brokerId, setBrokerId] = useState(state.brokers[0]?.id ?? "");
  const [selectedList, setSelectedList] = useState<string>("all");
  const [note, setNote] = useState("");
  const [calledAt, setCalledAt] = useState<number | null>(null);
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "answered" | "ended">("idle");
  const [waMsg, setWaMsg] = useState<string>(DEFAULT_WA_TEMPLATE);
  const [waEditing, setWaEditing] = useState(false);
  const [submittingOutcome, setSubmittingOutcome] = useState(false);
  const lastOutcomeRef = useRef<string>("");
  const lastOutcomeTimeRef = useRef<number>(0);
  const [lastSwitchMs, setLastSwitchMs] = useState<number | null>(null);
  const outcomeStartRef = useRef<number>(0);
  const [suppressedCompletedUntil, setSuppressedCompletedUntil] = useState<Record<string, number>>({});
  const [serverNextId, setServerNextId] = useState<string | null | undefined>(undefined);
  const [forcedCurrentContactId, setForcedCurrentContactId] = useState<string | null>(null);
  // Sincronização em background + indicador visual
  const [lastSyncedAt, setLastSyncedAt] = useState<number>(() => Date.now());
  const [outcomeError, setOutcomeError] = useState<null | { label: string; retry: () => void }>(null);
  // Para evitar loop no broadcast de notas
  const noteIncomingRef = useRef(false);
  const noteBroadcastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  // ---- Sincronia de "ligação em andamento" entre dispositivos do mesmo corretor ----
  const deviceInfo = useMemo(() => {
    if (typeof window === "undefined") return { id: "ssr", label: "Dispositivo" };
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const friendly = isMobile ? "Celular" : "Computador";
    const sid = Math.random().toString(36).slice(2, 8);
    return { id: `${friendly}#${sid}`, label: friendly };
  }, []);
  const deviceIdRef = useRef(deviceInfo.id);
  const activeCallSourceRef = useRef<"local" | "remote" | null>(null);
  const [remoteCall, setRemoteCall] = useState<{
    contact_id: string | null; contact_name: string; phone: string | null;
    started_at: string; device_label: string; device_id: string;
  } | null>(null);

  useEffect(() => {
    if (!state.brokers.length) return;
    if (!brokerId || !state.brokers.some((b) => b.id === brokerId)) setBrokerId(state.brokers[0].id);
  }, [state.brokers, brokerId]);

  // Carrega ligação em andamento + assina realtime
  useEffect(() => {
    if (!brokerId) return;
    let cancelled = false;
    function applyRow(row: any | null) {
      if (!row) { setRemoteCall(null); return; }
      const [label] = String(row.device_label || "").split("#");
      setRemoteCall({
        contact_id: row.contact_id ?? null,
        contact_name: row.contact_name,
        phone: row.phone,
        started_at: row.started_at,
        device_label: label || "Dispositivo",
        device_id: row.device_label || "",
      });
    }
    async function load() {
      const { data } = await (supabase as any)
        .from("active_calls")
        .select("contact_id, contact_name, phone, started_at, device_label")
        .eq("broker_id", brokerId)
        .maybeSingle();
      if (cancelled) return;
      applyRow(data ?? null);
    }
    void load();
    const channel = supabase
      .channel(`active_calls:${brokerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "active_calls" },
        (payload: any) => {
          const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
          if (!row || row.broker_id !== brokerId) return;
          if (payload.eventType === "DELETE") { setRemoteCall(null); return; }
          applyRow(payload.new);
        })
      .subscribe();
    // Fallback: re-sincroniza periodicamente caso algum evento se perca
    const poll = window.setInterval(() => { void load(); }, 5000);
    return () => { cancelled = true; window.clearInterval(poll); supabase.removeChannel(channel); };
  }, [brokerId]);

  const refreshServerNext = useCallback(async (reason = "manual") => {
    if (!brokerId) {
      setServerNextId(null);
      return;
    }
    try {
      const { data, error } = await (supabase as any).rpc("next_contact_for_broker", {
        _broker: brokerId,
        _list_name: selectedList === "all" ? null : selectedList,
      });
      if (error) throw error;
      setServerNextId((data as any)?.id ?? null);
    } catch (e) {
      console.warn(`next_contact_for_broker falhou (${reason})`, e);
    }
  }, [brokerId, selectedList]);

  useEffect(() => {
    void refreshServerNext("broker-or-list-change");
  }, [refreshServerNext]);

  // Sincronização em background a cada 60s — fila completa, sem bloquear UI
  useEffect(() => {
    if (!brokerId) return;
    const id = window.setInterval(() => {
      void refetchCloud().then(() => setLastSyncedAt(Date.now())).catch(() => {});
    }, 60_000);
    return () => window.clearInterval(id);
  }, [brokerId, refetchCloud]);

  // Marca timestamp de sync sempre que a fila do estado mudar
  useEffect(() => { setLastSyncedAt(Date.now()); }, [state.contacts.length, state.calls.length]);

  // Canal broadcast dialer:{brokerId} — espelha note + callStatus entre dispositivos
  useEffect(() => {
    if (!brokerId) return;
    const channel = supabase.channel(`dialer:${brokerId}`, { config: { broadcast: { self: false } } });
    channel
      .on("broadcast", { event: "note" }, (msg: any) => {
        const p = msg?.payload;
        if (!p || p.deviceId === deviceIdRef.current) return;
        noteIncomingRef.current = true;
        setNote(String(p.note ?? ""));
        setTimeout(() => { noteIncomingRef.current = false; }, 0);
      })
      .on("broadcast", { event: "call_status" }, (msg: any) => {
        const p = msg?.payload;
        if (!p || p.deviceId === deviceIdRef.current) return;
        if (p.status === "ended") { setCallStatus("ended"); }
        else if (p.status === "answered") { setCallStatus("answered"); }
        else if (p.status === "calling") { setCallStatus("calling"); }
        else if (p.status === "idle") { setCallStatus("idle"); }
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [brokerId]);

  // Helper para broadcast
  const broadcastRef = useRef<any>(null);
  useEffect(() => {
    if (!brokerId) return;
    const ch = supabase.channel(`dialer-send:${brokerId}`);
    ch.subscribe((status) => { if (status === "SUBSCRIBED") broadcastRef.current = ch; });
    return () => { broadcastRef.current = null; void supabase.removeChannel(ch); };
  }, [brokerId]);

  const broadcastStatus = useCallback((status: "idle" | "calling" | "answered" | "ended") => {
    broadcastRef.current?.send({ type: "broadcast", event: "call_status", payload: { status, deviceId: deviceIdRef.current } });
  }, []);





  async function upsertActiveCall(contact: { id: string; name: string; phone?: string | null }) {
    if (!brokerId) return;
    try {
      await (supabase as any).from("active_calls").upsert({
        broker_id: brokerId,
        contact_id: contact.id,
        contact_name: contact.name,
        phone: contact.phone ?? null,
        device_label: deviceIdRef.current,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (e) { console.warn("upsertActiveCall falhou", e); }
  }
  async function clearActiveCall() {
    if (!brokerId) return;
    setRemoteCall(null);
    try { await (supabase as any).from("active_calls").delete().eq("broker_id", brokerId); }
    catch (e) { console.warn("clearActiveCall falhou", e); }
  }


  // Carrega template salvo por corretor (localStorage)
  useEffect(() => {
    if (!brokerId) return;
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(`wa-template:${brokerId}`) : null;
    setWaMsg(saved && saved.trim() ? saved : DEFAULT_WA_TEMPLATE);
  }, [brokerId]);

  function saveWaTemplate() {
    if (!brokerId) return;
    window.localStorage.setItem(`wa-template:${brokerId}`, waMsg);
    toast.success("Mensagem padrão salva pra este corretor");
  }

  const date = todayISO();

  const contactProgress = useMemo(() => {
    const progress = new Map<string, { attempts: number; resolved: boolean }>();
    for (const call of state.calls) {
      if (call.brokerId !== brokerId) continue;
      const key = sameContactKey({ phone: call.phone, name: call.client });
      const currentProgress = progress.get(key) ?? { attempts: 0, resolved: false };
      currentProgress.attempts = Math.min(2, currentProgress.attempts + 1);
      if (call.attended || call.scheduled) currentProgress.resolved = true;
      progress.set(key, currentProgress);
    }
    return progress;
  }, [state.calls, brokerId]);

  useEffect(() => {
    setSuppressedCompletedUntil((entries) => {
      const now = Date.now();
      let changed = false;
      const next = Object.fromEntries(
        Object.entries(entries).filter(([, until]) => {
          const keep = until > now;
          if (!keep) changed = true;
          return keep;
        }),
      );
      return changed ? next : entries;
    });
  }, [state.contacts, contactProgress]);

  // Fila do corretor: contatos atribuídos a ele OU fila geral, pendentes
  const myQueue = useMemo(
    () => {
      const sorted = state.contacts
        .map((c) => {
          const progress = contactProgress.get(sameContactKey(c));
          const effectiveAttempts = Math.max(c.attempts, progress?.attempts ?? 0);
          const resolved = c.status !== "pendente" || Boolean(progress?.resolved) || effectiveAttempts >= 2;
          return {
            ...c,
            attempts: Math.min(2, effectiveAttempts),
            status: resolved ? "feito" as const : c.status,
          };
        })
        .filter((c) => !isContactSuppressed(sameContactKey(c)))
        .filter((c) => c.status === "pendente" && (c.brokerId === brokerId || c.brokerId === null))
        .filter((c) => selectedList === "all" || (c.listName || "Geral") === selectedList)
        .sort((a, b) => {
          // Atribuídos primeiro, depois menor número de tentativas, e só então ordem de criação.
          if ((a.brokerId === brokerId) !== (b.brokerId === brokerId)) return a.brokerId === brokerId ? -1 : 1;
          if (a.attempts !== b.attempts) return a.attempts - b.attempts;
          if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
      // Dedupe: mesmo telefone (ou mesmo nome, se sem telefone) aparece só uma vez na fila.
      const seen = new Set<string>();
      const out: typeof sorted = [];
      for (const c of sorted) {
        const digits = (c.phone || "").replace(/\D+/g, "");
        const key = digits ? `p:${digits}` : `n:${c.name.trim().toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(c);
      }
      return out;
    },
    [state.contacts, brokerId, contactProgress, selectedList, suppressedCompletedUntil]
  );

  const discadorLists = useMemo(() => {
    const set = new Set<string>();
    for (const c of state.contacts) {
      if (c.brokerId === brokerId || c.brokerId === null) {
        set.add(c.listName || "Geral");
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [state.contacts, brokerId]);


  const prioritizedQueue = useMemo(() => {
    // Espelha o contato em ligação por qualquer dispositivo do mesmo corretor
    // Prioridade: ligação remota > próximo do servidor, mas nunca pulando contatos com menos tentativas.
    const forcedPinned = forcedCurrentContactId
      ? myQueue.find((c) => c.id === forcedCurrentContactId) ?? null
      : null;
    if (forcedPinned) {
      return [forcedPinned, ...myQueue.filter((c) => c.id !== forcedPinned.id)];
    }
    const hasServerHead = serverNextId !== undefined;
    const localHead = myQueue[0];
    const serverPinned = serverNextId ? myQueue.find((c) => c.id === serverNextId) : null;
    const canTrustServerHead = Boolean(
      serverPinned && (!localHead || serverPinned.attempts <= localHead.attempts),
    );
    const pinId = remoteCall?.contact_id || (hasServerHead && canTrustServerHead ? serverNextId : null);
    if (!remoteCall?.contact_id && hasServerHead && serverNextId === null) return [];
    if (!pinId) return myQueue;
    const pinned = myQueue.find((c) => c.id === pinId);
    if (!pinned) return myQueue;
    return [pinned, ...myQueue.filter((c) => c.id !== pinId)];
  }, [forcedCurrentContactId, myQueue, remoteCall?.contact_id, serverNextId]);

  const current = prioritizedQueue[0];
  const next = prioritizedQueue[1];

  useEffect(() => {
    if (!brokerId) return;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleHeadRefresh(reason: string) {
      if (cancelled) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshServerNext(reason);
      }, 40);
    }

    const channel = supabase
      .channel(`dialer-head:${brokerId}:${selectedList}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, (payload: any) => {
        const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        if (!row || row.broker_id !== brokerId) return;
        scheduleHeadRefresh("calls-realtime");
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts_queue" }, (payload: any) => {
        const row = payload.new && Object.keys(payload.new).length ? payload.new : payload.old;
        if (!row) return;
        const rowBroker = row.broker_id ?? null;
        const rowList = row.list_name ?? "Geral";
        if (rowBroker !== brokerId && rowBroker !== null) return;
        if (selectedList !== "all" && rowList !== selectedList) return;
        scheduleHeadRefresh("contacts-realtime");
      })
      .subscribe();

    const poll = window.setInterval(() => {
      scheduleHeadRefresh("head-poll");
    }, 1200);

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [brokerId, selectedList, refreshServerNext]);

  useEffect(() => {
    if (!forcedCurrentContactId) return;
    if (!myQueue.some((contact) => contact.id === forcedCurrentContactId)) {
      setForcedCurrentContactId(null);
    }
  }, [forcedCurrentContactId, myQueue]);

  // Monitora tempo entre clicar no outcome e aparecer o próximo cliente
  useEffect(() => {
    if (outcomeStartRef.current > 0) {
      const elapsed = Math.round(performance.now() - outcomeStartRef.current);
      setLastSwitchMs(elapsed);
      outcomeStartRef.current = 0;
    }
  }, [current?.id]);

  // IMPORTANTE: reseta APENAS quando muda de contato (id). Não resetar em
  // mudança de `attempts` — caso contrário, o ref é limpo logo após o
  // incremento otimista e um segundo clique acidental gera ligação duplicada.
  useEffect(() => {
    lastOutcomeRef.current = "";
    setSubmittingOutcome(false);
    setCallStatus("idle");
    setOutcomeError(null);
  }, [current?.id]);


  // Espelho do estado "em ligação" entre dispositivos do mesmo corretor.
  // Quando outro aparelho liga → entra em modo "em ligação" aqui também.
  // Quando outro aparelho encerra → sai aqui também.
  useEffect(() => {
    if (!remoteCall) {
      if (activeCallSourceRef.current === "remote") {
        setCalledAt(null);
        setCallStatus("idle");
      }
      activeCallSourceRef.current = null;
      return;
    }
    if (remoteCall.device_id === deviceIdRef.current) return; // foi este aparelho que disparou
    activeCallSourceRef.current = "remote";
    const remoteStartMs = new Date(remoteCall.started_at).getTime();
    setCalledAt(remoteStartMs);
    // Espelha o status de ligação: se o outro device está ligando, este entra em "calling" também
    setCallStatus((prev) => (prev === "answered" ? prev : "calling"));
  }, [remoteCall]);

  // Espelho de call_status via dialer_sessions (cobre devices que abrem DEPOIS do início da ligação,
  // ou quando o outro device clica em "Atendeu" sem ainda ter encerrado).
  useEffect(() => {
    const s = dialerSession.session;
    if (!s) return;
    if (s.device_origin === dialerSession.deviceOrigin) return; // eco do próprio device
    if (s.call_status === "answered") setCallStatus("answered");
    else if (s.call_status === "calling") {
      setCallStatus((prev) => (prev === "answered" ? prev : "calling"));
      if (s.call_started_at) setCalledAt(new Date(s.call_started_at).getTime());
    } else if (s.call_status === "ended" || s.call_status === "idle") {
      if (activeCallSourceRef.current !== "local") {
        setCallStatus(s.call_status as any);
        if (s.call_status === "idle") setCalledAt(null);
      }
    }
    if (typeof s.observation === "string" && !noteIncomingRef.current) {
      noteIncomingRef.current = true;
      setNote(s.observation);
      setTimeout(() => { noteIncomingRef.current = false; }, 0);
    }
  }, [dialerSession.session, dialerSession.deviceOrigin]);


  const todayCalls = state.calls.filter((c) => c.brokerId === brokerId && c.date === date);
  const totalUnique = uniqueContactCount(todayCalls);
  const attendedUnique = uniqueContactCountWhere(todayCalls, (c) => c.attended);
  const k = {
    total: totalUnique,
    attended: attendedUnique,
    notAttended: Math.max(0, totalUnique - attendedUnique),
    scheduled: uniqueContactCountWhere(todayCalls, (c) => c.scheduled),
  };
  const meta = state.metaDaily || 50;
  const pct = Math.min(100, Math.round((k.total / meta) * 100));
  const reached = k.total >= meta;

  function sameContactKey(c: { phone?: string; name: string; id?: string }) {
    return normalizedContactKey({ name: c.name, phone: c.phone, contactId: c.id });
  }

  function isContactSuppressed(contactKey: string) {
    return (suppressedCompletedUntil[contactKey] ?? 0) > Date.now();
  }

  function recordOutcome(attended: boolean, scheduled: boolean) {
    if (!current) return;
    // Guarda anti-duplo-clique: enquanto outra tabulação está em voo, ignora.
    if (submittingOutcome) return;
    // Debounce 1200ms: bloqueia duplo clique acidental (mobile/desktop)
    const nowTs = Date.now();
    if (nowTs - lastOutcomeTimeRef.current < 1200) return;
    lastOutcomeTimeRef.current = nowTs;
    // Bloqueia tabulação enquanto ligação ainda está ativa (calling / answered)
    if (callStatus === "calling" || callStatus === "answered") {
      toast.error("Encerre a ligação antes de tabular");
      return;
    }
    if (current.attempts >= 2 && !attended && !scheduled) {
      toast.error("Esse contato já atingiu o limite de 2 tentativas");
      void logDialerError({
        action: "attempt_limit_reached",
        error: "Tentativa além do limite de 2",
        listName: current.listName,
        contactId: current.id,
        contactName: current.name,
        details: { attempts: current.attempts },
      });
      return;
    }
    // Inclui `attempts` na chave: bloqueia clique repetido na MESMA tentativa,
    // mas permite a 2ª tentativa legítima do mesmo contato.
    const outcomeKey = `${current.id}:${current.attempts}:${attended ? "1" : "0"}:${scheduled ? "1" : "0"}`;
    if (lastOutcomeRef.current === outcomeKey) return;
    lastOutcomeRef.current = outcomeKey;
    setSubmittingOutcome(true);
    outcomeStartRef.current = performance.now();
    setOutcomeError(null);
    setCallStatus("idle");
    broadcastStatus("idle");


    const contactId = current.id;
    const contactName = current.name;
    const contactKey = sameContactKey(current);
    const attemptsBefore = current.attempts;
    const previousContactsSnapshot = new Map(
      state.contacts
        .filter((c) => sameContactKey(c) === contactKey)
        .map((c) => [c.id, { attempts: c.attempts, status: c.status }] as const),
    );
    const startedAtIso = calledAt ? new Date(calledAt).toISOString() : undefined;
    const endedAtIso = new Date().toISOString();
    const duration = calledAt ? Math.max(0, Math.round((Date.now() - calledAt) / 1000)) : 0;
    const resolved = attended || scheduled;
    const newAttemptsLocal = Math.min(2, attemptsBefore + 1);
    const noteSnapshot = note.trim();

    // 1) Otimista IMEDIATO: avança cliente, limpa UI, libera próxima ligação.
    setState((s) => ({
      ...s,
      contacts: s.contacts.map((c) =>
        sameContactKey(c) === contactKey
          ? {
              ...c,
              attempts: Math.max(c.attempts, newAttemptsLocal),
              status: (resolved || newAttemptsLocal >= 2) ? "feito" : c.status,
            }
          : c
      ),
    }));
    setNote("");
    activeCallSourceRef.current = null;
    setCalledAt(null);
    void clearActiveCall();

    if (!reached && k.total + 1 === meta) {
      toast.success(`🎉 META BATIDA! ${meta} ligações hoje`, { duration: 5000 });
    }
    if (!attended && !scheduled && newAttemptsLocal < 2) {
      // Mantém o contato pendente para futura 2ª tentativa, sem furar a ordem da fila.
      setForcedCurrentContactId(contactId);
      setSuppressedCompletedUntil((entries) => {
        const next = { ...entries };
        delete next[contactKey];
        return next;
      });
      toast(`Sem resposta — faça a 2ª tentativa agora`, { description: contactName });
    } else {
      // Resolvido (atendeu/agendou) ou esgotou 2 tentativas: oculta temporariamente o contato concluído.
      setForcedCurrentContactId(null);
      setSuppressedCompletedUntil((entries) => ({
        ...entries,
        [contactKey]: Date.now() + 15000,
      }));
    }

    // 2a) Registra a tentativa em contact_attempts (paralelo, fire-and-forget)
    if (userId) {
      void recordContactAttempt({
        contactId,
        userId,
        brokerId,
        result: scheduled ? "scheduled" : attended ? "answered" : "no_answer",
        attemptNumber: newAttemptsLocal,
        observation: noteSnapshot || null,
      });
    }
    // 2b) Espelha estado da sessão entre dispositivos (paralelo)
    void dialerSession.updateSession({ current_contact_id: null, call_status: "idle", observation: "", call_started_at: null });

    // 3) RPC em background — não bloqueia a UI. Se falhar, reverte.

    void (async () => {
      try {
        const { data, error } = await supabase.rpc("record_call_outcome", {
          _contact_id: contactId,
          _attended: attended,
          _scheduled: scheduled,
          _notes: noteSnapshot || undefined,
          _started_at: startedAtIso,
          _ended_at: endedAtIso,
          _duration_seconds: duration,
        });
        if (error) throw error;
        // Backend é a fonte da verdade do próximo cliente.
        const nextFromServer = (data as any)?.next?.id ?? null;
        setServerNextId(nextFromServer);
        void refreshServerNext("record-call-outcome-success");
        // Reconciliação fica por conta do realtime (scheduleRefetch).
        // Evita um loadAll() pesado depois de cada ligação.
      } catch (e: any) {
        console.error("Falha ao registrar ligação", e);
        toast.error(e?.message || "Falha ao registrar ligação — desfazendo");
        setOutcomeError({ label: e?.message || "Falha ao registrar ligação", retry: () => recordOutcome(attended, scheduled) });

        void logDialerError({
          action: "record_call_outcome",
          error: e,
          listName: current?.listName,
          contactId,
          contactName,
          details: { attended, scheduled, attemptsBefore },
        });
        // Reverte o otimista
        setState((s) => ({
          ...s,
          contacts: s.contacts.map((c) =>
            previousContactsSnapshot.has(c.id)
              ? {
                  ...c,
                  attempts: previousContactsSnapshot.get(c.id)!.attempts,
                  status: previousContactsSnapshot.get(c.id)!.status,
                }
              : c
          ),
        }));
        setSuppressedCompletedUntil((entries) => {
          const next = { ...entries };
          delete next[contactKey];
          return next;
        });
        setForcedCurrentContactId(contactId);
        lastOutcomeRef.current = "";
      } finally {
        setSubmittingOutcome(false);
      }
    })();
  }

  function skip() {
    if (!current) return;
    setForcedCurrentContactId(null);
    const key = sameContactKey(current);
    const skippedId = current.id;
    const skippedAttempts = current.attempts;
    setState((s) => ({
      ...s,
      contacts: s.contacts.map((c) =>
        (c.id === current.id || (c.status === "pendente" && sameContactKey(c) === key))
          ? { ...c, status: "pulado" }
          : c
      ),
    }));
    setNote("");
    activeCallSourceRef.current = null;
    setCalledAt(null);
    setCallStatus("idle");
    broadcastStatus("idle");
    if (userId) {
      void recordContactAttempt({
        contactId: skippedId,
        userId,
        brokerId,
        result: "skipped",
        attemptNumber: Math.min(2, skippedAttempts + 1),
      });
    }
    void dialerSession.updateSession({ current_contact_id: null, call_status: "idle", observation: "", call_started_at: null });
    setSuppressedCompletedUntil((entries) => ({
      ...entries,
      [key]: Date.now() + 15000,
    }));
    void clearActiveCall();
    void refreshServerNext("skip");
    toast("Contato pulado");
  }

  function callback() {
    if (!current) return;
    if (submittingOutcome) return;
    setForcedCurrentContactId(null);
    setSubmittingOutcome(true);
    // Joga pro fim da fila: recria com novo createdAt
    setState((s) => ({
      ...s,
      contacts: s.contacts.map((c) => c.id === current.id ? { ...c, createdAt: Date.now(), attempts: c.attempts + 1 } : c),
    }));
    setNote("");
    activeCallSourceRef.current = null;
    setCalledAt(null);
    setCallStatus("idle");
    broadcastStatus("idle");

    void clearActiveCall();
    void refreshServerNext("callback");
    setSubmittingOutcome(false);
    toast("Movido pro fim da fila");
  }

  function startCall() {
    if (!current || submittingOutcome) return;
    setForcedCurrentContactId(current.id);
    activeCallSourceRef.current = "local";
    const now = new Date();
    setCalledAt(now.getTime());
    setCallStatus("calling");
    broadcastStatus("calling");
    void upsertActiveCall({ id: current.id, name: current.name, phone: current.phone });
    void dialerSession.updateSession({
      current_contact_id: current.id,
      call_status: "calling",
      call_started_at: now.toISOString(),
    });
  }

  function endCall() {
    setCallStatus("ended");
    broadcastStatus("ended");
    void clearActiveCall();
    void dialerSession.updateSession({ call_status: "ended" });
  }



  const brokerName = state.brokers.find((b) => b.id === brokerId)?.name ?? "—";

  const remoteIsOtherDevice = remoteCall && remoteCall.device_id !== deviceIdRef.current;

  const brokerInitials = (brokerName || "—")
    .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "—";

  return (
    <div className="space-y-4">

      {/* Header bento: corretor + lista (8) | meta (4) */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-8 rounded-2xl border border-[#c9a24c]/20 bg-[#1a1a1a]/95 backdrop-blur p-5 shadow-2xl flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-4 min-w-0">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#c9a24c] to-[#f0d78c] font-bold text-[#0d0d0d] shadow-lg shadow-[#c9a24c]/20" style={fontDisplay}>
              {brokerInitials}
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-zinc-500" style={fontDisplay}>Corretor</div>
              <select
                value={brokerId}
                onChange={(e) => setBrokerId(e.target.value)}
                className="bg-transparent border-0 p-0 -ml-0.5 text-[#f0d78c] text-lg font-bold leading-tight focus:outline-none focus:ring-0 cursor-pointer hover:text-[#c9a24c] truncate max-w-[220px]"
                style={fontDisplay}
              >
                {state.brokers.map((b) => <option key={b.id} value={b.id} className="bg-[#1a1a1a]">{b.name}</option>)}
              </select>
            </div>
          </div>
          <div className="hidden sm:block h-10 w-px bg-zinc-800" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-zinc-500" style={fontDisplay}>Lista para discar</div>
            <select
              value={selectedList}
              onChange={(e) => setSelectedList(e.target.value)}
              className="bg-transparent border-0 p-0 -ml-0.5 text-zinc-100 text-base font-semibold leading-tight focus:outline-none focus:ring-0 cursor-pointer hover:text-[#c9a24c] truncate max-w-full"
              style={fontDisplay}
            >
              <option value="all" className="bg-[#1a1a1a]">Todas as listas</option>
              {discadorLists.map((l) => (
                <option key={l} value={l} className="bg-[#1a1a1a]">{l}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-4 rounded-2xl border border-[#c9a24c]/20 bg-[#1a1a1a]/95 backdrop-blur p-5 flex flex-col justify-center gap-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>
              <Target className="h-3.5 w-3.5" /> Meta diária
            </span>
            <span className={`text-sm font-bold tabular-nums ${reached ? "text-emerald-400" : "text-[#f0d78c]"}`} style={fontDisplay}>
              {k.total}/{meta}{reached && " ✓"}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[#0d0d0d] border border-[#c9a24c]/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                background: reached
                  ? "linear-gradient(to right, #22c55e, #6ee7b7)"
                  : "linear-gradient(to right, #c9a24c, #f0d78c)",
              }}
            />
          </div>
        </div>
      </div>

      {current ? (
        <div className="rounded-3xl border border-[#c9a24c]/30 bg-[#1a1a1a]/95 backdrop-blur p-6 sm:p-7 shadow-2xl relative overflow-hidden">
          {/* glow accent */}
          <div className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-[#c9a24c]/10 blur-3xl" />

          {/* status bar */}
          <div className="relative z-10 mb-5 flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>
            <span className="flex items-center gap-2">
              <span>Próximo da fila — {brokerName}</span>
              <SyncBadge ts={lastSyncedAt} />
            </span>
            <span className="flex items-center gap-2">
              {lastSwitchMs !== null && (
                <span className="inline-flex items-center rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-400">
                  {lastSwitchMs} ms
                </span>
              )}
              <span>{myQueue.length} pendente{myQueue.length === 1 ? "" : "s"}</span>
            </span>
          </div>

          <div key={current.id} className="animate-slide-in-x relative z-10 grid grid-cols-12 gap-5">

            {/* ESQUERDA — identidade + CTA principal */}
            <div className="col-span-12 lg:col-span-7 flex flex-col">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {current.attempts > 0 ? (
                  <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-amber-300 animate-pulse" style={fontDisplay}>
                    ⚠ 2ª Tentativa obrigatória
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-[#c9a24c]/30 bg-[#c9a24c]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#f0d78c]" style={fontDisplay}>
                    Lead na fila
                  </span>
                )}
                {current.brokerId === null && (
                  <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800/60 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-zinc-400" style={fontDisplay}>
                    Fila geral
                  </span>
                )}
              </div>

              <h1 className="text-[34px] sm:text-[44px] lg:text-[48px] leading-[1.02] tracking-[-0.02em] font-bold text-white break-words" style={fontDisplay}>
                {current.name}
              </h1>
              <div className="mt-2 text-xl sm:text-2xl tracking-tight text-zinc-400 font-medium break-all" style={fontNumeric}>
                {current.phone || "(sem telefone)"}
              </div>

              {/* Próximo da fila — preview */}
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-zinc-800 bg-[#0d0d0d]/60 px-4 py-2.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>A seguir</span>
                {next ? (
                  <>
                    <span className="flex-1 truncate text-sm font-semibold text-zinc-300">{next.name}</span>
                    <span className="text-xs tabular-nums text-zinc-500">{next.phone}</span>
                  </>
                ) : (
                  <span className="flex-1 truncate text-sm text-zinc-500">Sem próximos na fila</span>
                )}
              </div>

              {/* CTA Principal — LIGAR / ENCERRAR */}
              <div className="mt-auto pt-5">
                {callStatus === "calling" || callStatus === "answered" ? (
                  <button
                    type="button"
                    onClick={endCall}
                    aria-label="Encerrar ligação"
                    className="w-full bg-gradient-to-r from-emerald-400 to-emerald-300 py-5 rounded-2xl text-black font-extrabold text-lg sm:text-xl shadow-[0_0_40px_-8px_rgba(110,231,183,0.7)] hover:scale-[1.01] active:scale-[0.99] transition-transform flex items-center justify-center gap-3 uppercase tracking-[0.18em]"
                    style={fontDisplay}
                  >
                    <span className="relative flex items-center gap-1" aria-hidden>
                      <span className="wave-bar" /><span className="wave-bar" /><span className="wave-bar" /><span className="wave-bar" />
                    </span>
                    Encerrar
                    <CallTimer startedAt={calledAt ?? Date.now()} />
                  </button>
                ) : (
                  <a
                    href={telHref(current.phone)}
                    onClick={startCall}
                    aria-label="Ligar agora"
                    className={`w-full bg-gradient-to-r from-[#c9a24c] to-[#f0d78c] py-5 rounded-2xl text-[#0d0d0d] font-extrabold text-lg sm:text-xl shadow-[0_8px_40px_-8px_rgba(201,162,76,0.5)] hover:scale-[1.01] active:scale-[0.99] transition-transform flex items-center justify-center gap-3 uppercase tracking-[0.18em] ${submittingOutcome ? "pointer-events-none opacity-50" : ""}`}
                    style={fontDisplay}
                  >
                    <Phone className="h-6 w-6" strokeWidth={2.5} />
                    Ligar agora
                  </a>
                )}
                {remoteIsOtherDevice && (
                  <div className="mt-2 text-center text-[10px] uppercase tracking-widest text-zinc-500" style={fontDisplay}>
                    via {remoteCall!.device_label}
                  </div>
                )}
              </div>
            </div>

            {/* DIREITA — ações secundárias e desfechos */}
            <div className="col-span-12 lg:col-span-5 flex flex-col gap-3">
              {/* WhatsApp */}
              <div className="flex gap-2">
                <a
                  href={waHrefFromMessage(current.phone, renderWaMessage(waMsg, current.name))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-emerald-600/30 bg-emerald-600/10 hover:bg-emerald-600/20 py-3 text-xs font-bold uppercase tracking-[0.18em] text-emerald-300 transition"
                  style={fontDisplay}
                >
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </a>
                <button
                  type="button"
                  onClick={() => setWaEditing((v) => !v)}
                  className="rounded-xl border border-zinc-700 bg-[#0d0d0d] px-3 text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800 hover:text-[#c9a24c]"
                  style={fontDisplay}
                  title="Editar mensagem"
                >
                  {waEditing ? "Fechar" : "Editar msg"}
                </button>
              </div>

              {waEditing && (
                <div className="rounded-xl border border-zinc-800 bg-[#0d0d0d] p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <label className="text-[10px] uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>
                      Mensagem · use <span className="text-[#c9a24c]">{"{nome}"}</span>
                    </label>
                    <span className="text-[10px] tabular-nums text-zinc-600">{waMsg.length}/1000</span>
                  </div>
                  <textarea
                    value={waMsg}
                    onChange={(e) => setWaMsg(e.target.value.slice(0, 1000))}
                    rows={3}
                    className={inputCls + " resize-none py-2 text-sm"}
                    placeholder={DEFAULT_WA_TEMPLATE}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={saveWaTemplate}
                      className="rounded-md bg-[#c9a24c] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-black hover:bg-[#f0d78c]"
                      style={fontDisplay}
                    >
                      Salvar padrão
                    </button>
                    <button
                      type="button"
                      onClick={() => setWaMsg(DEFAULT_WA_TEMPLATE)}
                      className="rounded-md border border-zinc-700 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
                      style={fontDisplay}
                    >
                      Restaurar
                    </button>
                  </div>
                </div>
              )}

              {/* Observação */}
              <textarea
                value={note}
                onChange={(e) => {
                  const v = e.target.value;
                  setNote(v);
                  if (noteIncomingRef.current) return;
                  if (noteBroadcastTimerRef.current) clearTimeout(noteBroadcastTimerRef.current);
                  noteBroadcastTimerRef.current = setTimeout(() => {
                    broadcastRef.current?.send({ type: "broadcast", event: "note", payload: { note: v, deviceId: deviceIdRef.current } });
                  }, 250);
                }}
                rows={2}
                placeholder="Observação (opcional)"
                className={inputCls + " resize-none py-2 text-sm rounded-xl"}
              />

              {/* Chips de motivo rápido */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Não atendeu", hover: "hover:border-red-500/40 hover:text-red-300" },
                  { label: "Caixa postal", hover: "hover:border-amber-500/40 hover:text-amber-300" },
                  { label: "Número errado", hover: "hover:border-zinc-400 hover:text-white" },
                  { label: "Sem interesse", hover: "hover:border-orange-500/40 hover:text-orange-300" },
                ].map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => setNote(chip.label)}
                    className={`rounded-xl border border-zinc-800 bg-[#0d0d0d] py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400 transition ${chip.hover}`}
                    style={fontDisplay}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* Desfechos principais */}
              {outcomeError && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  <span className="truncate">⚠ {outcomeError.label}</span>
                  <button
                    type="button"
                    onClick={() => { const r = outcomeError.retry; setOutcomeError(null); r(); }}
                    className="shrink-0 rounded-md border border-red-400/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-200 hover:bg-red-500/20"
                    style={fontDisplay}
                  >
                    <RefreshCw className="inline h-3 w-3 mr-0.5" /> Tentar
                  </button>
                </div>
              )}

              {(() => {
                const outcomesLocked = callStatus === "calling" || callStatus === "answered" || submittingOutcome;
                const lockedHint = submittingOutcome ? "Registrando ligação..." : (outcomesLocked ? "Encerre a ligação para tabular" : undefined);
                return (
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => recordOutcome(false, false)}
                      disabled={outcomesLocked}
                      title={lockedHint}
                      className="group flex flex-col items-center gap-1.5 rounded-2xl border border-zinc-800 bg-[#0d0d0d] py-3 hover:border-red-500/50 hover:bg-red-500/5 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-red-500/15 border border-red-500/30 text-red-400 group-hover:bg-red-500 group-hover:text-white transition">
                        <X className="h-5 w-5" strokeWidth={3} />
                      </span>
                      <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-zinc-400 group-hover:text-red-300" style={fontDisplay}>Não atend.</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => recordOutcome(true, false)}
                      disabled={outcomesLocked}
                      title={lockedHint}
                      className="group flex flex-col items-center gap-1.5 rounded-2xl border border-zinc-800 bg-[#0d0d0d] py-3 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 group-hover:bg-emerald-500 group-hover:text-white transition">
                        <Check className="h-5 w-5" strokeWidth={3} />
                      </span>
                      <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-zinc-400 group-hover:text-emerald-300" style={fontDisplay}>Atendeu</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => recordOutcome(true, true)}
                      disabled={outcomesLocked}
                      title={lockedHint}
                      className="group flex flex-col items-center gap-1.5 rounded-2xl border border-[#c9a24c]/30 bg-[#c9a24c]/5 py-3 hover:border-[#c9a24c] hover:bg-[#c9a24c]/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#c9a24c] to-[#f0d78c] text-[#0d0d0d] shadow-md shadow-[#c9a24c]/30">
                        <Calendar className="h-5 w-5" strokeWidth={3} />
                      </span>
                      <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#f0d78c]" style={fontDisplay}>Agendou</span>
                    </button>
                  </div>
                );
              })()}

              {/* Bottom nav */}
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button
                  onClick={callback}
                  className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-[#0d0d0d] py-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400 hover:text-white hover:border-zinc-600 transition"
                  style={fontDisplay}
                >
                  <Undo2 className="h-3.5 w-3.5" /> Retornar
                </button>
                <button
                  onClick={skip}
                  className="flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-[#0d0d0d] py-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400 hover:text-white hover:border-zinc-600 transition"
                  style={fontDisplay}
                >
                  Pular <SkipForward className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-zinc-800 bg-[#1a1a1a]/95 p-12 text-center">
          <PhoneCall className="mx-auto h-10 w-10 text-zinc-700" />
          <h3 className="mt-3 text-2xl font-bold uppercase tracking-wider text-zinc-300" style={fontDisplay}>Fila vazia</h3>
          <p className="mt-1 text-sm text-zinc-500">Importe contatos do Excel/CRM pra começar a discar.</p>
          <button
            onClick={goFila}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#c9a24c] to-[#f0d78c] px-6 py-3 text-sm font-bold uppercase tracking-wider text-black hover:scale-[1.02] transition-transform"
            style={fontDisplay}
          >
            <ListPlus className="h-4 w-4" /> Ir pra Fila
          </button>
        </div>
      )}

      {/* Barra de stats — sticky no rodapé */}
      <div className="sticky bottom-0 -mx-3 sm:-mx-6 mt-4 border-t border-zinc-800 bg-[#0b0d13]/95 backdrop-blur px-3 sm:px-6 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] z-20">
        <div className="grid grid-cols-4 gap-2 sm:gap-3 text-center">
          <StatPill label="Ligações" value={k.total} color="#c9a24c" />
          <StatPill label="Atendidas" value={k.attended} color="#22c55e" />
          <StatPill label="Não atend." value={k.notAttended} color="#ef4444" />
          <StatPill label="Agendadas" value={k.scheduled} color="#eab308" />
        </div>
      </div>
    </div>
  );
}


function CallTimer({ startedAt }: { startedAt: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return (
    <div className="mt-1 text-4xl tracking-tight text-emerald-400" style={fontNumeric}>{mm}:{ss}</div>
  );
}

/* ---------------- FILA (importação de contatos) ---------------- */

function FilaTab({ state, setState, isAdmin, me, refetchCloud }: { state: State; setState: React.Dispatch<React.SetStateAction<State>>; isAdmin: boolean; me: Me | null; refetchCloud: () => Promise<void> }) {
  const [bulk, setBulk] = useState("");
  const [assignTo, setAssignTo] = useState<string>(() => (isAdmin ? "" : (me?.brokerId ?? "")));
  const [filterBroker, setFilterBroker] = useState<string>("all");
  const [filterList, setFilterList] = useState<string>("all");
  const [listName, setListName] = useState<string>("Geral");
  const [metaInput, setMetaInput] = useState(String(state.metaDaily || 50));

  // Corretor: sempre força auto-atribuição pra ele mesmo
  useEffect(() => {
    if (!isAdmin && me?.brokerId && assignTo !== me.brokerId) setAssignTo(me.brokerId);
  }, [isAdmin, me?.brokerId, assignTo]);

  // Listas existentes (das contas visíveis)
  const availableLists = useMemo(() => {
    const set = new Set<string>();
    for (const c of state.contacts) set.add(c.listName || "Geral");
    return Array.from(set).sort();
  }, [state.contacts]);

  function parseLines(text: string): { name: string; phone: string }[] {
    const out: { name: string; phone: string }[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      let name = "", phone = "";
      const sep = line.match(/[;,\t|]/);
      if (sep) {
        const parts = line.split(/[;,\t|]/).map((p) => p.trim());
        name = parts[0] || "";
        phone = parts.slice(1).find((p) => /\d/.test(p)) || "";
      } else {
        const m = line.match(/^(.*?)\s+([+()\d\s-]{8,})$/);
        if (m) { name = m[1].trim(); phone = m[2].trim(); }
        else { name = line; phone = ""; }
      }
      if (name) out.push({ name, phone: normalizePhone(phone) });
    }
    return out;
  }

  const preview = useMemo(() => parseLines(bulk), [bulk]);

  function importContacts() {
    if (preview.length === 0) { toast.error("Cole pelo menos um contato"); return; }
    const brokerId = assignTo || null;
    const cleanList = (listName.trim() || "Geral").slice(0, 80);
    const newContacts: Contact[] = preview.map((p, i) => ({
      id: uid(),
      name: p.name,
      phone: p.phone,
      brokerId,
      status: "pendente",
      createdAt: Date.now() + i,
      attempts: 0,
      listName: cleanList,
    }));
    setState((s) => ({ ...s, contacts: [...s.contacts, ...newContacts] }));
    toast.success(`${newContacts.length} contato(s) importado(s) na lista "${cleanList}"`, {
      description: brokerId ? `Atribuído a ${state.brokers.find(b => b.id === brokerId)?.name}` : "Fila geral",
    });
    setBulk("");
  }

  function removeContact(id: string) {
    setState((s) => ({ ...s, contacts: s.contacts.filter((c) => c.id !== id) }));
  }

  async function clearScope(onlyDone: boolean) {
    const targetBrokerId =
      !isAdmin ? (me?.brokerId ?? null)
      : filterBroker === "all" ? null
      : filterBroker === "geral" ? null
      : filterBroker;
    const listFilter = filterList === "all" ? null : filterList;
    const includeGeneral = isAdmin && filterBroker === "geral";

    const scopeLabel = !isAdmin
      ? "da sua fila"
      : filterBroker === "all" ? "de todos"
      : filterBroker === "geral" ? "da fila geral"
      : `de ${state.brokers.find(b => b.id === filterBroker)?.name ?? ""}`;
    const listLabel = listFilter ? ` (lista "${listFilter}")` : "";
    const kindLabel = onlyDone ? "finalizados" : "TODOS os contatos";

    if (!confirm(`Apagar ${kindLabel} ${scopeLabel}${listLabel}? Essa ação não pode ser desfeita.`)) return;

    try {
      const { data, error } = await supabase.rpc("admin_clear_contacts", {
        _broker_id: targetBrokerId ?? undefined,
        _list_name: listFilter ?? undefined,
        _only_done: onlyDone,
        _include_general: includeGeneral,
      });
      if (error) throw error;
      const deleted = (data as any)?.deleted ?? 0;
      if (deleted === 0) {
        toast.error("Nenhum contato no escopo selecionado");
      } else {
        toast.success(`${deleted} contato(s) removido(s)`);
      }
      await refetchCloud();
    } catch (e: any) {
      console.error("Falha ao limpar", e);
      toast.error(e?.message || "Falha ao limpar contatos");
      void logDialerError({
        action: "admin_clear_contacts",
        error: e,
        listName: listFilter ?? undefined,
        details: { onlyDone, includeGeneral, targetBrokerId },
      });
    }
  }

  function clearDone() { void clearScope(true); }
  function clearAll() { void clearScope(false); }

  function reassign(id: string, brokerId: string | null) {
    setState((s) => ({ ...s, contacts: s.contacts.map((c) => c.id === id ? { ...c, brokerId } : c) }));
  }

  function updateContactPhone(id: string, rawPhone: string) {
    const phone = normalizePhone(rawPhone.trim());
    setState((s) => ({ ...s, contacts: s.contacts.map((c) => c.id === id ? { ...c, phone } : c) }));
  }

  function updateContactName(id: string, name: string) {
    const trimmed = name.trim().slice(0, 120);
    if (!trimmed) return;
    setState((s) => ({ ...s, contacts: s.contacts.map((c) => c.id === id ? { ...c, name: trimmed } : c) }));
  }

  function saveMeta() {
    const n = Math.max(1, Math.min(999, Number(metaInput) || 50));
    setState((s) => ({ ...s, metaDaily: n }));
    setMetaInput(String(n));
    toast.success(`Meta diária: ${n} ligações`);
  }

  const visible = state.contacts.filter((c) => {
    if (filterBroker === "geral" && c.brokerId !== null) return false;
    if (filterBroker !== "all" && filterBroker !== "geral" && c.brokerId !== filterBroker) return false;
    if (filterList !== "all" && (c.listName || "Geral") !== filterList) return false;
    return true;
  });

  const pending = visible.filter((c) => c.status === "pendente").length;
  const done = visible.filter((c) => c.status === "feito").length;
  const skipped = visible.filter((c) => c.status === "pulado").length;

  return (
    <div className="space-y-5">
      {/* Config meta */}
      <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-5 flex flex-wrap items-end gap-4">
        <Field label="Meta diária por corretor" className="w-[200px]">
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              value={metaInput}
              onChange={(e) => setMetaInput(e.target.value)}
              className={inputCls}
            />
            <button
              onClick={saveMeta}
              className="h-10 rounded-md bg-[#c9a24c] px-4 text-xs font-bold uppercase tracking-wider text-black hover:bg-[#e6c878]"
              style={fontDisplay}
            >Salvar</button>
          </div>
        </Field>
        <div className="flex flex-1 gap-3 justify-end">
          <Kpi label="Pendentes" value={pending} color="#c9a24c" />
          <Kpi label="Feitos" value={done} color="#22c55e" />
          <Kpi label="Pulados" value={skipped} color="#71717a" />
        </div>
      </div>

      {/* Importar */}
      <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-5">
        <h2 className="mb-4 text-2xl font-bold uppercase tracking-wider" style={fontDisplay}>
          <Upload className="inline h-5 w-5 text-[#c9a24c] mb-1 mr-2" />
          Importar contatos do Excel
        </h2>
        <p className="mb-3 text-xs text-zinc-400">
          Cole 1 contato por linha. Formatos aceitos: <code className="text-[#c9a24c]">Nome, Telefone</code> · <code className="text-[#c9a24c]">Nome; Telefone</code> · <code className="text-[#c9a24c]">Nome \t Telefone</code> (cópia direta do Excel).
        </p>

        <div className="grid gap-3 sm:grid-cols-[1fr_280px]">
          <textarea
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            rows={10}
            placeholder={"João Silva, 11999998888\nMaria Souza, 11988887777\nPedro Lima\t11977776666"}
            className={inputCls + " min-h-[220px] resize-y py-2 font-mono text-xs"}
          />
          <div className="space-y-3">
            <Field label="Nome da lista">
              <input
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                list="lista-existentes"
                placeholder='Ex: "Lançamento X", "Leads Maio"'
                maxLength={80}
                className={inputCls}
              />
              <datalist id="lista-existentes">
                {availableLists.map((l) => (<option key={l} value={l} />))}
              </datalist>
            </Field>
            {isAdmin ? (
              <Field label="Atribuir a">
                <select
                  value={assignTo}
                  onChange={(e) => setAssignTo(e.target.value)}
                  className={inputCls + " appearance-none"}
                >
                  <option value="" className="bg-[#171a23]">Fila geral (qualquer corretor)</option>
                  {state.brokers.map((b) => (
                    <option key={b.id} value={b.id} className="bg-[#171a23]">{b.name}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <div className="rounded-md border border-zinc-800 bg-[#0f1117] p-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>Atribuído a</div>
                <div className="mt-1 text-sm font-semibold text-zinc-100">{me?.brokerName ?? "—"}</div>
                <div className="text-xs text-zinc-500">Contatos importados ficam só com você.</div>
              </div>
            )}
            <div className="rounded-md border border-zinc-800 bg-[#0f1117] p-3">
              <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>Pré-visualização</div>
              <div className="mt-1 text-4xl tracking-tight text-[#c9a24c]" style={fontNumeric}>
                {preview.length}
              </div>
              <div className="text-xs text-zinc-500">contato(s) válido(s)</div>
            </div>
            <button
              onClick={importContacts}
              className="h-12 w-full rounded-md bg-[#c9a24c] text-sm font-bold uppercase tracking-[0.2em] text-black hover:bg-[#e6c878]"
              style={fontDisplay}
            >
              Importar {preview.length > 0 ? `${preview.length} contato(s)` : ""}
            </button>
          </div>
        </div>
      </div>

      {/* Lista de contatos */}
      <div className="rounded-lg border border-zinc-800 bg-[#171a23]">
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-zinc-800">
          <Field label="Filtrar por corretor" className="min-w-[200px]">
            <select value={filterBroker} onChange={(e) => setFilterBroker(e.target.value)} className={inputCls + " appearance-none"}>
              <option value="all" className="bg-[#171a23]">Todos</option>
              <option value="geral" className="bg-[#171a23]">Fila geral</option>
              {state.brokers.map((b) => (
                <option key={b.id} value={b.id} className="bg-[#171a23]">{b.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Filtrar por lista" className="min-w-[200px]">
            <select value={filterList} onChange={(e) => setFilterList(e.target.value)} className={inputCls + " appearance-none"}>
              <option value="all" className="bg-[#171a23]">Todas</option>
              {availableLists.map((l) => (
                <option key={l} value={l} className="bg-[#171a23]">{l}</option>
              ))}
            </select>
          </Field>
          <div className="ml-auto flex gap-2">
            <button
              onClick={clearDone}
              className="h-10 rounded-md border border-zinc-700 px-4 text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
              style={fontDisplay}
            >Limpar finalizados</button>
            <button
              onClick={clearAll}
              className="h-10 rounded-md border border-red-800/60 px-4 text-xs font-semibold uppercase tracking-wider text-red-400 hover:bg-red-900/30"
              style={fontDisplay}
            >Limpar todos</button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#0f1117] text-[11px] uppercase tracking-[0.18em] text-zinc-500" style={fontDisplay}>
              <tr>
                <Th>Status</Th><Th>Nome</Th><Th>Telefone</Th><Th>Lista</Th><Th>Atribuído</Th><Th className="text-right">Tentativas</Th><Th className="w-10"></Th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-zinc-500">Nenhum contato.</td></tr>
              )}
              {visible.slice(0, 200).map((c) => (
                <tr key={c.id} className="border-t border-zinc-800/80 hover:bg-zinc-900/40">
                  <Td>
                    <StatusDot status={c.status} />
                  </Td>
                  <Td className="font-semibold text-zinc-100">
                    <EditableCell
                      value={c.name}
                      onSave={(v) => updateContactName(c.id, v)}
                      placeholder="Nome"
                    />
                  </Td>
                  <Td className="tabular-nums text-zinc-300">
                    <EditableCell
                      value={c.phone || ""}
                      onSave={(v) => updateContactPhone(c.id, v)}
                      placeholder="Telefone"
                      inputMode="tel"
                    />
                  </Td>
                  <Td className="text-xs text-zinc-400">{c.listName || "Geral"}</Td>
                  <Td>
                    {isAdmin ? (
                      <select
                        value={c.brokerId ?? ""}
                        onChange={(e) => reassign(c.id, e.target.value || null)}
                        className="h-8 rounded border border-zinc-700 bg-[#0f1117] px-2 text-xs text-zinc-200 outline-none focus:border-[#c9a24c]"
                      >
                        <option value="" className="bg-[#171a23]">Geral</option>
                        {state.brokers.map((b) => (
                          <option key={b.id} value={b.id} className="bg-[#171a23]">{b.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-zinc-400">{state.brokers.find(b => b.id === c.brokerId)?.name ?? "—"}</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums text-zinc-400">{c.attempts}</Td>
                  <Td>
                    <button onClick={() => removeContact(c.id)} className="rounded p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length > 200 && (
            <div className="p-3 text-center text-xs text-zinc-500">+ {visible.length - 200} contato(s) não exibidos</div>
          )}
        </div>
      </div>
    </div>
  );
}

function EditableCell({
  value,
  onSave,
  placeholder,
  inputMode,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  inputMode?: "tel" | "text";
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setDraft(value); (e.target as HTMLInputElement).blur(); }
      }}
      inputMode={inputMode}
      placeholder={placeholder}
      className="w-full bg-transparent px-1 py-0.5 outline-none rounded hover:bg-zinc-800/40 focus:bg-zinc-800/60 focus:ring-1 focus:ring-[#c9a24c]/50"
    />
  );
}

function StatusDot({ status }: { status: Contact["status"] }) {
  const map = {
    pendente: { color: "#c9a24c", label: "Pendente" },
    feito: { color: "#22c55e", label: "Feito" },
    pulado: { color: "#71717a", label: "Pulado" },
  } as const;
  const s = map[status];
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-300" style={fontDisplay}>
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
      {s.label}
    </span>
  );
}

