import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Phone, History, BarChart3, Users, Trash2, Plus, Check, X, Calendar, UserCircle2, Zap, Undo2, Upload, PhoneCall, SkipForward, Target, ListPlus, LogOut, Cloud, MessageCircle, Pencil, Save, AlertTriangle, RefreshCw } from "lucide-react";
import fortalLogo from "@/assets/fortal-logo.png.asset.json";
import wolfBg from "@/assets/wolf-wall-street.png.asset.json";
import { useCloudState, newId, type Me } from "@/lib/cloud-state";
import { supabase } from "@/integrations/supabase/client";
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
        {tab === "discador" && <DiscadorTab state={state} setState={setState} goFila={() => setTab("fila")} refetchCloud={refetchCloud} />}
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

function DiscadorTab({ state, setState, goFila, refetchCloud }: { state: State; setState: React.Dispatch<React.SetStateAction<State>>; goFila: () => void; refetchCloud: () => Promise<void> }) {
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
  const [localRetryPinId, setLocalRetryPinId] = useState<string | null>(null);
  const [suppressedCompletedUntil, setSuppressedCompletedUntil] = useState<Record<string, number>>({});
  const [serverNextId, setServerNextId] = useState<string | null | undefined>(undefined);
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

  const retryContactId = useMemo(() => {
    const lastCall = state.calls.find(
      (c) => c.brokerId === brokerId && c.contactId && !c.attended && !c.scheduled,
    );
    if (!lastCall?.contactId) return null;
    const contact = state.contacts.find((c) => c.id === lastCall.contactId);
    if (!contact) return null;
    if (isContactSuppressed(sameContactKey(contact))) return null;
    const progress = contactProgress.get(sameContactKey(contact));
    const effectiveAttempts = Math.max(contact.attempts, progress?.attempts ?? 0);
    if (contact.status !== "pendente") return null;
    if (progress?.resolved) return null;
    if (effectiveAttempts !== 1) return null;
    if (!(contact.brokerId === brokerId || contact.brokerId === null)) return null;
    return contact.id;
  }, [state.calls, state.contacts, brokerId, contactProgress, suppressedCompletedUntil]);

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
          // Atribuídos primeiro, depois por ordem de criação, com id como desempate estável
          if ((a.brokerId === brokerId) !== (b.brokerId === brokerId)) return a.brokerId === brokerId ? -1 : 1;
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
    // Prioridade: trava local de retry (2ª tentativa) > ligação remota > próximo do servidor > retry detectado por calls
    const hasServerHead = serverNextId !== undefined;
    const pinId = localRetryPinId || remoteCall?.contact_id || (hasServerHead ? serverNextId : retryContactId);
    if (!localRetryPinId && !remoteCall?.contact_id && hasServerHead && serverNextId === null) return [];
    if (!pinId) return myQueue;
    const pinned = myQueue.find((c) => c.id === pinId);
    if (!pinned) return myQueue;
    return [pinned, ...myQueue.filter((c) => c.id !== pinId)];
  }, [myQueue, retryContactId, remoteCall?.contact_id, localRetryPinId, serverNextId]);

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

  // Monitora tempo entre clicar no outcome e aparecer o próximo cliente
  useEffect(() => {
    if (outcomeStartRef.current > 0) {
      const elapsed = Math.round(performance.now() - outcomeStartRef.current);
      setLastSwitchMs(elapsed);
      outcomeStartRef.current = 0;
    }
  }, [current?.id]);

  useEffect(() => {
    lastOutcomeRef.current = "";
    setSubmittingOutcome(false);
  }, [current?.id, current?.attempts]);

  // Espelho do estado "em ligação" entre dispositivos do mesmo corretor.
  // Quando outro aparelho liga → entra em modo "em ligação" aqui também.
  // Quando outro aparelho encerra → sai aqui também.
  useEffect(() => {
    if (!remoteCall) {
      if (activeCallSourceRef.current === "remote") {
        setCalledAt(null);
      }
      activeCallSourceRef.current = null;
      return;
    }
    if (remoteCall.device_id === deviceIdRef.current) return; // foi este aparelho que disparou
    activeCallSourceRef.current = "remote";
    const remoteStartMs = new Date(remoteCall.started_at).getTime();
    setCalledAt(remoteStartMs);
  }, [remoteCall]);


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
    const outcomeKey = `${current.id}:${attended ? "1" : "0"}:${scheduled ? "1" : "0"}`;
    if (lastOutcomeRef.current === outcomeKey) return;
    lastOutcomeRef.current = outcomeKey;
    outcomeStartRef.current = performance.now();

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
      // Trava o mesmo contato como próximo da fila até a 2ª tentativa
      setSuppressedCompletedUntil((entries) => {
        const next = { ...entries };
        delete next[contactKey];
        return next;
      });
      setLocalRetryPinId(contactId);
      toast(`Sem resposta — faça a 2ª tentativa agora`, { description: contactName });
    } else {
      // Resolvido (atendeu/agendou) ou esgotou 2 tentativas: libera a trava
      setSuppressedCompletedUntil((entries) => ({
        ...entries,
        [contactKey]: Date.now() + 15000,
      }));
      setLocalRetryPinId(null);
    }

    // 2) RPC em background — não bloqueia a UI. Se falhar, reverte.
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
        lastOutcomeRef.current = "";
      }
    })();
  }

  function skip() {
    if (!current) return;
    const key = sameContactKey(current);
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
    setLocalRetryPinId(null);
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
    setSubmittingOutcome(true);
    // Joga pro fim da fila: recria com novo createdAt
    setState((s) => ({
      ...s,
      contacts: s.contacts.map((c) => c.id === current.id ? { ...c, createdAt: Date.now(), attempts: c.attempts + 1 } : c),
    }));
    setNote("");
    activeCallSourceRef.current = null;
    setCalledAt(null);
    setLocalRetryPinId(null);
    void clearActiveCall();
    void refreshServerNext("callback");
    setSubmittingOutcome(false);
    toast("Movido pro fim da fila");
  }

  function startCall() {
    if (!current || submittingOutcome) return;
    activeCallSourceRef.current = "local";
    setCalledAt(Date.now());
    void upsertActiveCall({ id: current.id, name: current.name, phone: current.phone });
  }


  const brokerName = state.brokers.find((b) => b.id === brokerId)?.name ?? "—";

  const remoteIsOtherDevice = remoteCall && remoteCall.device_id !== deviceIdRef.current;

  return (
    <div className="space-y-5">


      {/* Header: corretor + meta */}
      <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-5">

        <div className="flex flex-wrap items-end gap-4">
          <Field label="Corretor" className="min-w-[220px]">
            <div className="relative">
              <UserCircle2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <select value={brokerId} onChange={(e) => setBrokerId(e.target.value)} className={inputCls + " pl-9 appearance-none text-base font-semibold"}>
                {state.brokers.map((b) => <option key={b.id} value={b.id} className="bg-[#171a23]">{b.name}</option>)}
              </select>
            </div>
          </Field>
          <Field label="Lista para discar" className="min-w-[200px]">
            <select
              value={selectedList}
              onChange={(e) => setSelectedList(e.target.value)}
              className={inputCls + " appearance-none"}
            >
              <option value="all" className="bg-[#171a23]">Todas as listas</option>
              {discadorLists.map((l) => (
                <option key={l} value={l} className="bg-[#171a23]">{l}</option>
              ))}
            </select>
          </Field>
          <div className="flex-1 min-w-[260px]">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.18em]" style={fontDisplay}>
              <span className="flex items-center gap-1.5 text-zinc-500">
                <Target className="h-3.5 w-3.5" /> Meta diária — {meta} ligações
              </span>
              <span className={`tabular-nums ${reached ? "text-emerald-400" : "text-zinc-300"}`}>
                {k.total} / {meta} {reached && "✓"}
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: reached ? "#22c55e" : "#c9a24c" }}
              />
            </div>
          </div>
        </div>
      </div>

      {current ? (
        <div className="rounded-xl border-2 border-[#c9a24c]/40 bg-gradient-to-b from-[#171a23] to-[#0f1117] p-6 shadow-[0_0_60px_-20px_#c9a24c]">

          <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>
            <span>Próximo da fila — {brokerName}</span>
            <span className="flex items-center gap-2">
              {lastSwitchMs !== null && (
                <span className="inline-flex items-center rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-400">
                  {lastSwitchMs} ms
                </span>
              )}
              <span>{myQueue.length} pendente{myQueue.length === 1 ? "" : "s"}</span>
            </span>
          </div>

          <div className="my-4">
            <div className="text-[40px] sm:text-[56px] leading-[1.02] tracking-[-0.02em] font-semibold text-zinc-50" style={fontDisplay}>
              {current.name}
            </div>
            <div className="mt-3 text-2xl sm:text-3xl tracking-tight text-[#c9a24c]" style={fontNumeric}>
              {current.phone || "(sem telefone)"}
            </div>
            {current.attempts > 0 && (
              <div className="mt-2 inline-flex items-center gap-2 rounded bg-amber-500/20 border border-amber-400/40 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-200 animate-pulse" style={fontDisplay}>
                ⚠ 2ª Tentativa obrigatória — mesmo cliente
              </div>
            )}
            {current.brokerId === null && (
              <div className="mt-1 inline-block text-[10px] uppercase tracking-widest text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded mt-2">Fila geral</div>
            )}
          </div>

          {/* Botão LIGAR */}
          {!calledAt ? (
            <a
              href={telHref(current.phone)}
              onClick={startCall}
                className={`flex w-full items-center justify-center gap-3 rounded-md py-5 text-lg font-bold uppercase tracking-[0.2em] text-black shadow-[0_0_40px_-8px_#c9a24c] transition active:scale-[0.99] ${submittingOutcome ? "pointer-events-none bg-[#8f7b42] opacity-60" : "bg-[#c9a24c] hover:bg-[#e6c878]"}`}
              style={fontDisplay}
            >
              <PhoneCall className="h-6 w-6" strokeWidth={2.5} />
              Ligar agora
            </a>
          ) : (
            <div className="rounded-md border-2 border-emerald-500/50 bg-emerald-500/10 py-4 text-center">
              <div className="text-[11px] uppercase tracking-[0.22em] text-emerald-400" style={fontDisplay}>
                Em ligação{remoteIsOtherDevice ? ` — via ${remoteCall!.device_label}` : ""}
              </div>
              <CallTimer startedAt={calledAt} />
            </div>
          )}

          {/* WhatsApp — mensagem editável por corretor / por ligação */}
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <a
                href={waHrefFromMessage(current.phone, renderWaMessage(waMsg, current.name))}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-2 rounded-md border border-emerald-600/60 bg-emerald-600/10 py-3 text-sm font-bold uppercase tracking-[0.18em] text-emerald-300 transition hover:bg-emerald-600/20"
                style={fontDisplay}
              >
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
              <button
                type="button"
                onClick={() => setWaEditing((v) => !v)}
                className="rounded-md border border-zinc-700 px-3 text-[11px] font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
                style={fontDisplay}
                title="Editar mensagem"
              >
                {waEditing ? "Fechar" : "Editar msg"}
              </button>
            </div>
            {waEditing && (
              <div className="rounded-md border border-zinc-800 bg-[#0f1117] p-3">
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>
                    Mensagem do WhatsApp · use <span className="text-[#c9a24c]">{"{nome}"}</span> pro primeiro nome
                  </label>
                  <span className="text-[10px] tabular-nums text-zinc-600">{waMsg.length}/1000</span>
                </div>
                <textarea
                  value={waMsg}
                  onChange={(e) => setWaMsg(e.target.value.slice(0, 1000))}
                  rows={3}
                  className={inputCls + " resize-none py-2"}
                  placeholder={DEFAULT_WA_TEMPLATE}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={saveWaTemplate}
                    className="rounded-md bg-[#c9a24c] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-black hover:bg-[#e6c878]"
                    style={fontDisplay}
                  >
                    Salvar como padrão
                  </button>
                  <button
                    type="button"
                    onClick={() => setWaMsg(DEFAULT_WA_TEMPLATE)}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
                    style={fontDisplay}
                  >
                    Restaurar padrão
                  </button>
                  <span className="ml-auto text-[10px] text-zinc-500">
                    Pré-visualização: <span className="text-zinc-300">{renderWaMessage(waMsg, current.name)}</span>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Tabulação */}
          <div className="mt-4">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Observação (opcional)"
              className={inputCls + " resize-none py-2"}
            />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <BigKey kbd="" color="red" onClick={() => recordOutcome(false, false)}>
              <X className="h-5 w-5" strokeWidth={3} /> Não atendeu
            </BigKey>
            <BigKey kbd="" color="green" onClick={() => recordOutcome(true, false)}>
              <Check className="h-5 w-5" strokeWidth={3} /> Atendeu
            </BigKey>
            <BigKey kbd="" color="orange" onClick={() => recordOutcome(true, true)}>
              <Calendar className="h-5 w-5" strokeWidth={3} /> Agendou
            </BigKey>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              onClick={callback}
              className="flex h-11 items-center justify-center gap-2 rounded-md border border-zinc-700 text-xs font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
              style={fontDisplay}
            >
              <Undo2 className="h-4 w-4" /> Retornar depois
            </button>
            <button
              onClick={skip}
              className="flex h-11 items-center justify-center gap-2 rounded-md border border-zinc-700 text-xs font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
              style={fontDisplay}
            >
              <SkipForward className="h-4 w-4" /> Pular
            </button>
          </div>

          {next && (
            <div className="mt-5 flex items-center gap-3 rounded-md border border-dashed border-zinc-800 px-4 py-3">
              <span className="text-[10px] uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>A seguir</span>
              <span className="flex-1 truncate text-sm font-semibold text-zinc-300">{next.name}</span>
              <span className="text-xs tabular-nums text-zinc-500">{next.phone}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border-2 border-dashed border-zinc-800 bg-[#171a23] p-10 text-center">
          <PhoneCall className="mx-auto h-10 w-10 text-zinc-700" />
          <h3 className="mt-3 text-2xl font-bold uppercase tracking-wider text-zinc-300" style={fontDisplay}>Fila vazia</h3>
          <p className="mt-1 text-sm text-zinc-500">Importe contatos do Excel/CRM pra começar a discar.</p>
          <button
            onClick={goFila}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-[#c9a24c] px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-black hover:bg-[#e6c878]"
            style={fontDisplay}
          >
            <ListPlus className="h-4 w-4" /> Ir pra Fila
          </button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Ligações hoje" value={k.total} color="#c9a24c" />
        <Kpi label="Atendidas" value={k.attended} color="#22c55e" />
        <Kpi label="Não atend." value={k.notAttended} color="#ef4444" />
        <Kpi label="Agendadas" value={k.scheduled} color="#eab308" />
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

