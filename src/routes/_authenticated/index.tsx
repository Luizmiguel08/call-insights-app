import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Phone, History, BarChart3, Users, Trash2, Plus, Check, X, Calendar, UserCircle2, Zap, Undo2, Upload, PhoneCall, SkipForward, Target, ListPlus, LogOut, Cloud, MessageCircle, Pencil, Save, AlertTriangle, RefreshCw } from "lucide-react";
import fortalLogo from "@/assets/fortal-logo.png.asset.json";
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
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#0f1117] text-zinc-100 px-4" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
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
    <div className="min-h-[100dvh] bg-[#0f1117] text-zinc-100 pb-[env(safe-area-inset-bottom)]" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
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

  useEffect(() => { if (!brokerId && state.brokers[0]) setBrokerId(state.brokers[0].id); }, [state.brokers, brokerId]);
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

/* ---------------- HISTÓRICO ---------------- */

function HistoricoTab({ state, setState, me, isAdmin }: { state: State; setState: React.Dispatch<React.SetStateAction<State>>; me: Me | null; isAdmin: boolean }) {
  const [date, setDate] = useState("");
  const [brokerId, setBrokerId] = useState(isAdmin ? "" : (me?.brokerId ?? ""));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ client: string; phone: string; attended: boolean; scheduled: boolean; note: string }>({ client: "", phone: "", attended: false, scheduled: false, note: "" });

  // Não-admin sempre vê apenas o próprio histórico
  const effectiveBrokerId = isAdmin ? brokerId : (me?.brokerId ?? "");

  const filtered = state.calls
    .filter((c) => (date ? c.date === date : true))
    .filter((c) => (effectiveBrokerId ? c.brokerId === effectiveBrokerId : true));

  function startEdit(c: Call) {
    setEditingId(c.id);
    setEditDraft({ client: c.client, phone: c.phone ?? "", attended: c.attended, scheduled: c.scheduled, note: c.note ?? "" });
  }
  function cancelEdit() { setEditingId(null); }
  function saveEdit() {
    if (!editingId) return;
    const id = editingId;
    const d = editDraft;
    setState((s) => ({
      ...s,
      calls: s.calls.map((c) => c.id === id ? { ...c, client: d.client.trim() || c.client, phone: d.phone.trim() || undefined, attended: d.attended, scheduled: d.scheduled, note: d.note } : c),
    }));
    setEditingId(null);
    toast.success("Ligação atualizada");
  }

  function remove(id: string) {
    if (!confirm("Excluir esta ligação?")) return;
    setState((s) => ({ ...s, calls: s.calls.filter((c) => c.id !== id) }));
    toast.success("Ligação excluída");
  }


  function clearHistory() {
    if (!isAdmin) return;
    const ids = new Set(filtered.map((c) => c.id));
    if (ids.size === 0) { toast.error("Nada para excluir"); return; }
    const scopeLabel = effectiveBrokerId
      ? `de ${state.brokers.find((b) => b.id === effectiveBrokerId)?.name ?? ""}`
      : "de todos os corretores";
    const dateLabel = date ? `do dia ${new Date(date + "T00:00").toLocaleDateString("pt-BR")}` : "de todos os dias";
    if (!confirm(`Excluir TODO o histórico ${scopeLabel} ${dateLabel}? Esta ação não pode ser desfeita.\n\n${ids.size} ligação(ões) serão removidas.`)) return;
    if (!confirm("Tem certeza absoluta? Confirme novamente para apagar permanentemente.")) return;
    setState((s) => ({ ...s, calls: s.calls.filter((c) => !ids.has(c.id)) }));
    toast.success(`${ids.size} ligação(ões) excluída(s)`);
  }

  // ---------- Analytics do corretor selecionado ----------
  const analytics = useMemo(() => {
    const hourBuckets = Array.from({ length: 24 }, () => 0);
    for (const c of filtered) {
      const h = new Date(c.createdAt).getHours();
      hourBuckets[h] += 1;
    }
    const maxHour = Math.max(...hourBuckets);
    const peakHour = maxHour > 0 ? hourBuckets.indexOf(maxHour) : -1;
    const activeHours = hourBuckets.filter((v) => v > 0).length;
    const idleHours = 24 - activeHours;

    // Top contatos (por nome+telefone) mais ligados
    const contactMap = new Map<string, { client: string; phone?: string; total: number; attended: number; scheduled: number }>();
    for (const c of filtered) {
      const key = (c.phone || "") + "|" + c.client;
      const cur = contactMap.get(key) ?? { client: c.client, phone: c.phone, total: 0, attended: 0, scheduled: 0 };
      cur.total += 1;
      if (c.attended) cur.attended += 1;
      if (c.scheduled) cur.scheduled += 1;
      contactMap.set(key, cur);
    }
    const topContacts = Array.from(contactMap.values()).sort((a, b) => b.total - a.total).slice(0, 8);

    // Maior intervalo ocioso (em minutos) entre ligações no mesmo dia
    const byDay = new Map<string, number[]>();
    for (const c of filtered) {
      const arr = byDay.get(c.date) ?? [];
      arr.push(c.createdAt);
      byDay.set(c.date, arr);
    }
    let longestGapMin = 0;
    for (const arr of byDay.values()) {
      arr.sort((a, b) => a - b);
      for (let i = 1; i < arr.length; i++) {
        const gap = (arr[i] - arr[i - 1]) / 60000;
        if (gap > longestGapMin) longestGapMin = gap;
      }
    }

    return { hourBuckets, maxHour, peakHour, activeHours, idleHours, topContacts, longestGapMin };
  }, [filtered]);

  const showCharts = !!effectiveBrokerId && filtered.length > 0;
  const selectedBroker = state.brokers.find((b) => b.id === effectiveBrokerId);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-4 flex flex-wrap gap-3 items-end">
        <Field label="Data" className="min-w-[180px]">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
        {isAdmin && (
          <Field label="Corretor" className="min-w-[200px]">
            <select value={brokerId} onChange={(e) => setBrokerId(e.target.value)} className={inputCls + " appearance-none"}>
              <option value="" className="bg-[#171a23]">Todos</option>
              {state.brokers.map((b) => (
                <option key={b.id} value={b.id} className="bg-[#171a23]">{b.name}</option>
              ))}
            </select>
          </Field>
        )}
        <button
          onClick={() => { setDate(""); if (isAdmin) setBrokerId(""); }}
          className="h-10 rounded-md border border-zinc-700 px-4 text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
          style={fontDisplay}
        >
          Limpar filtros
        </button>
        {isAdmin && (
          <button
            onClick={clearHistory}
            disabled={filtered.length === 0}
            className="h-10 flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-4 text-xs font-bold uppercase tracking-wider text-red-400 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            style={fontDisplay}
            title="Excluir todo o histórico filtrado"
          >
            <Trash2 className="h-3.5 w-3.5" /> Excluir histórico
          </button>
        )}
        <div className="ml-auto text-xs uppercase tracking-widest text-zinc-500" style={fontDisplay}>
          {filtered.length} registro{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      {showCharts && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Ligações" value={uniqueContactCount(filtered)} color="#c9a24c" />
            <Kpi label="Horas ativas" value={analytics.activeHours} color="#22c55e" />
            <Kpi label="Horas ociosas" value={analytics.idleHours} color="#ef4444" />
            <Kpi
              label="Maior ócio"
              value={analytics.longestGapMin >= 60 ? `${Math.floor(analytics.longestGapMin / 60)}h${Math.round(analytics.longestGapMin % 60).toString().padStart(2, "0")}` : `${Math.round(analytics.longestGapMin)}m`}
              color="#eab308"
            />
          </div>

          <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-5">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h3 className="text-lg font-bold uppercase tracking-wider text-[#c9a24c]" style={fontDisplay}>Pico de ligações por hora</h3>
                <p className="text-xs text-zinc-500 mt-1">
                  {selectedBroker?.name ?? "Corretor"}{date ? ` · ${new Date(date + "T00:00").toLocaleDateString("pt-BR")}` : " · todos os dias"}
                </p>
              </div>
              {analytics.peakHour >= 0 && (
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500" style={fontDisplay}>Pico</div>
                  <div className="text-2xl font-bold text-[#c9a24c]" style={fontNumeric}>
                    {analytics.peakHour.toString().padStart(2, "0")}h · {analytics.maxHour}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-end gap-1 h-40">
              {analytics.hourBuckets.map((v, h) => {
                const pct = analytics.maxHour ? (v / analytics.maxHour) * 100 : 0;
                const isPeak = v > 0 && v === analytics.maxHour;
                return (
                  <div key={h} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className={`w-full rounded-t transition-all ${isPeak ? "bg-[#c9a24c]" : v > 0 ? "bg-emerald-600/70" : "bg-zinc-800"}`}
                        style={{ height: `${Math.max(pct, v > 0 ? 6 : 2)}%` }}
                        title={`${h.toString().padStart(2, "0")}h — ${v} ligaç${v === 1 ? "ão" : "ões"}`}
                      />
                    </div>
                    <div className={`text-[9px] tabular-nums ${isPeak ? "text-[#c9a24c] font-bold" : "text-zinc-600"}`}>
                      {h.toString().padStart(2, "0")}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex gap-4 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#c9a24c]" /> Hora de pico</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-600/70" /> Ativa</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-zinc-800" /> Ociosa</span>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-5">
            <h3 className="mb-4 text-lg font-bold uppercase tracking-wider text-[#c9a24c]" style={fontDisplay}>Contatos mais ligados</h3>
            {analytics.topContacts.length === 0 ? (
              <p className="text-sm text-zinc-500">Sem dados.</p>
            ) : (
              <div className="space-y-2">
                {analytics.topContacts.map((c, i) => {
                  const max = analytics.topContacts[0].total;
                  const pct = (c.total / max) * 100;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <div className="truncate">
                          <span className="font-semibold text-zinc-100">{c.client}</span>
                          {c.phone && <span className="text-zinc-500 ml-2 text-xs">{c.phone}</span>}
                        </div>
                        <div className="text-xs text-zinc-400 shrink-0 ml-3">
                          <span className="text-zinc-100 font-bold" style={fontNumeric}>{c.total}</span> tentativas
                          {c.attended > 0 && <span className="text-emerald-400 ml-2">{c.attended} atend.</span>}
                          {c.scheduled > 0 && <span className="text-yellow-400 ml-2">{c.scheduled} agend.</span>}
                        </div>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                        <div className="h-full rounded-full bg-[#c9a24c]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {!showCharts && isAdmin && !effectiveBrokerId && filtered.length > 0 && (
        <div className="rounded-lg border border-zinc-800/60 bg-[#171a23]/50 p-4 text-xs text-zinc-500">
          Selecione um corretor para visualizar gráfico de pico, horas ativas/ociosas e contatos mais ligados.
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-[#171a23]">
        <table className="w-full text-sm">
          <thead className="bg-[#0f1117] text-[11px] uppercase tracking-[0.18em] text-zinc-500" style={fontDisplay}>
            <tr>
              <Th>Data</Th><Th>Hora</Th><Th>Corretor</Th><Th>Cliente</Th><Th>Telefone</Th>
              <Th>Atendeu</Th><Th>Agendou</Th><Th>Observação</Th><Th className="w-20"></Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="py-10 text-center text-zinc-500">Nenhuma ligação registrada.</td></tr>
            )}
            {filtered.map((c) => {
              const b = state.brokers.find((x) => x.id === c.brokerId);
              const isEditing = editingId === c.id;
              if (isEditing) {
                return (
                  <tr key={c.id} className="border-t border-zinc-800/80 bg-zinc-900/60">
                    <Td className="tabular-nums">{new Date(c.date + "T00:00").toLocaleDateString("pt-BR")}</Td>
                    <Td className="tabular-nums text-zinc-400">{new Date(c.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</Td>
                    <Td className="font-semibold text-zinc-100">{b?.name ?? "—"}</Td>
                    <Td><input value={editDraft.client} onChange={(e) => setEditDraft({ ...editDraft, client: e.target.value })} className={inputCls + " h-8 text-sm"} /></Td>
                    <Td><input value={editDraft.phone} onChange={(e) => setEditDraft({ ...editDraft, phone: e.target.value })} className={inputCls + " h-8 text-sm tabular-nums w-32"} placeholder="(00) 0000-0000" /></Td>
                    <Td>
                      <button onClick={() => setEditDraft({ ...editDraft, attended: !editDraft.attended })} className={`rounded px-2 py-1 text-xs font-bold ${editDraft.attended ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800 text-zinc-500"}`}>
                        {editDraft.attended ? "SIM" : "NÃO"}
                      </button>
                    </Td>
                    <Td>
                      <button onClick={() => setEditDraft({ ...editDraft, scheduled: !editDraft.scheduled })} className={`rounded px-2 py-1 text-xs font-bold ${editDraft.scheduled ? "bg-yellow-500/20 text-yellow-400" : "bg-zinc-800 text-zinc-500"}`}>
                        {editDraft.scheduled ? "SIM" : "NÃO"}
                      </button>
                    </Td>
                    <Td><input value={editDraft.note} onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })} className={inputCls + " h-8 text-sm"} /></Td>
                    <Td>
                      <div className="flex gap-1">
                        <button onClick={saveEdit} className="rounded p-1.5 text-emerald-400 hover:bg-emerald-500/10" title="Salvar"><Save className="h-4 w-4" /></button>
                        <button onClick={cancelEdit} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800" title="Cancelar"><X className="h-4 w-4" /></button>
                      </div>
                    </Td>
                  </tr>
                );
              }
              return (
                <tr key={c.id} className="border-t border-zinc-800/80 hover:bg-zinc-900/40">
                  <Td className="tabular-nums">{new Date(c.date + "T00:00").toLocaleDateString("pt-BR")}</Td>
                  <Td className="tabular-nums text-zinc-400">{new Date(c.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</Td>
                  <Td className="font-semibold text-zinc-100">{b?.name ?? "—"}</Td>
                  <Td>{c.client}</Td>
                  <Td className="tabular-nums text-zinc-300">{c.phone || "—"}</Td>
                  <Td><Badge ok={c.attended} /></Td>
                  <Td><Badge ok={c.scheduled} /></Td>
                  <Td className="max-w-[280px] truncate text-zinc-400" title={c.note}>{c.note || "—"}</Td>
                  <Td>
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(c)} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-[#c9a24c]" title="Editar">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => remove(c.id)} className="rounded p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400" title="Excluir">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </Td>
                </tr>
              );
            })}

          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- DASHBOARD ---------------- */

function DashboardTab({ state }: { state: State }) {
  const [date, setDate] = useState(todayISO());

  const calls = useMemo(() => state.calls.filter((c) => (date ? c.date === date : true)), [state.calls, date]);

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
    return {
      broker: b,
      total: tot,
      attended: att,
      scheduled: sch,
      rate: tot ? Math.round((sch / tot) * 100) : 0,
    };
  }).sort((a, b) => b.total - a.total);

  const max = Math.max(1, ...ranking.map((r) => r.total));

  // Distribuição por hora (0-23) por corretor — identifica horário de pico
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
      <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-4 flex flex-wrap items-end gap-3">
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="Ligações" value={k.total} color="#c9a24c" />
        <Kpi label="Atendidas" value={k.attended} color="#22c55e" />
        <Kpi label="Não atend." value={k.notAttended} color="#ef4444" />
        <Kpi label="Agendamentos" value={k.scheduled} color="#eab308" />
        <Kpi label="Taxa Agend." value={`${rate}%`} color="#c9a24c" />
      </div>

      <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-6">
        <h3 className="mb-1 text-xl font-bold uppercase tracking-wider" style={fontDisplay}>Horário de Pico por Corretor</h3>
        <p className="mb-5 text-xs text-zinc-500">Distribuição de ligações ao longo do dia (0h–23h)</p>
        {hourly.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">Sem ligações no período selecionado.</p>
        ) : (
          <div className="space-y-5">
            {hourly.map((row) => {
              const peakIdx = row.hours.indexOf(Math.max(...row.hours));
              return (
                <div key={row.broker.id} className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-zinc-100">{row.broker.name}</span>
                    <span className="text-xs text-zinc-500">
                      {row.total} ligação(ões) · pico às <b className="text-[#c9a24c]">{String(peakIdx).padStart(2, "0")}h</b>
                    </span>
                  </div>
                  {(() => {
                    const W = 600, H = 110, P = 6;
                    const n = row.hours.length;
                    const stepX = (W - P * 2) / (n - 1);
                    const pts = row.hours.map((v, h) => {
                      const x = P + h * stepX;
                      const y = H - P - (v / maxHour) * (H - P * 2);
                      return [x, y] as const;
                    });
                    // Catmull-Rom -> Bezier para curva suave
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
                      <div className="rounded-md bg-gradient-to-b from-zinc-900/80 to-zinc-900/40 p-2">
                        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full">
                          <defs>
                            <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                              <stop offset="0%" stopColor="#c9a24c" stopOpacity="0.55" />
                              <stop offset="100%" stopColor="#c9a24c" stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          {[0.25, 0.5, 0.75].map((f) => (
                            <line key={f} x1={P} x2={W - P} y1={P + (H - P * 2) * f} y2={P + (H - P * 2) * f}
                              stroke="#3f3f46" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.4" />
                          ))}
                          <path d={area} fill={`url(#${gid})`} />
                          <path d={path} fill="none" stroke="#c9a24c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          {row.hours[peakIdx] > 0 && (
                            <>
                              <line x1={peakX} x2={peakX} y1={peakY} y2={H - P} stroke="#c9a24c" strokeWidth="0.7" strokeDasharray="2 2" opacity="0.6" />
                              <circle cx={peakX} cy={peakY} r="3.5" fill="#0b0d12" stroke="#c9a24c" strokeWidth="1.6" />
                            </>
                          )}
                        </svg>
                      </div>
                    );
                  })()}
                  <div className="flex justify-between px-1 text-[10px] tabular-nums text-zinc-600">
                    <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-6">
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
                        i === 0 ? "bg-[#c9a24c] text-black" : i === 1 ? "bg-zinc-700 text-zinc-100" : i === 2 ? "bg-zinc-800 text-zinc-300" : "bg-zinc-900 text-zinc-500"
                      }`}
                      style={fontDisplay}
                    >{i + 1}</span>
                  </Td>
                  <Td className="font-semibold text-zinc-100">{r.broker.name}</Td>
                  <Td className="text-right text-3xl tracking-tight" style={fontNumeric}>{r.total}</Td>
                  <Td>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-[#c9a24c] transition-all" style={{ width: `${(r.total / max) * 100}%` }} />
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums text-emerald-400">{r.attended}</Td>
                  <Td className="text-right tabular-nums text-yellow-400">{r.scheduled}</Td>
                  <Td className="text-right tabular-nums font-semibold text-[#c9a24c]">{r.rate}%</Td>
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

/* ---------------- Atoms ---------------- */

const inputCls =
  "h-10 w-full rounded-md border border-zinc-700 bg-[#0f1117] px-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-[#c9a24c] focus:ring-2 focus:ring-[#c9a24c]/30";

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500" style={fontDisplay}>{label}</span>
      {children}
    </label>
  );
}

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => onChange(true)}
        className={`flex h-10 items-center justify-center gap-1.5 rounded-md border text-sm font-bold uppercase tracking-wider transition ${
          value === true
            ? "border-emerald-500 bg-emerald-500/20 text-emerald-400 shadow-[0_0_18px_-8px_#22c55e]"
            : "border-zinc-700 bg-[#0f1117] text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-400"
        }`}
        style={fontDisplay}
      >
        <Check className="h-4 w-4" strokeWidth={3} /> Sim
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        className={`flex h-10 items-center justify-center gap-1.5 rounded-md border text-sm font-bold uppercase tracking-wider transition ${
          value === false
            ? "border-red-500 bg-red-500/20 text-red-400 shadow-[0_0_18px_-8px_#ef4444]"
            : "border-zinc-700 bg-[#0f1117] text-zinc-400 hover:border-red-500/50 hover:text-red-400"
        }`}
        style={fontDisplay}
      >
        <X className="h-4 w-4" strokeWidth={3} /> Não
      </button>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-gradient-to-b from-[#13161f] to-[#0f1117] p-4 sm:p-5">
      <div className="text-[10px] font-medium uppercase tracking-[0.28em] text-zinc-500">{label}</div>
      <div
        className="mt-2 text-[44px] sm:text-[56px] font-semibold leading-[0.95] tracking-[-0.04em]"
        style={{ ...fontNumeric, color }}
      >
        {value}
      </div>
    </div>
  );
}

function Badge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-emerald-400" style={fontDisplay}>
      <Check className="h-3 w-3" strokeWidth={3} /> Sim
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-red-400" style={fontDisplay}>
      <X className="h-3 w-3" strokeWidth={3} /> Não
    </span>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 text-left font-semibold ${className}`}>{children}</th>;
}
function Td({ children, className = "", title, style }: { children?: React.ReactNode; className?: string; title?: string; style?: React.CSSProperties }) {
  return <td className={`px-3 py-2.5 ${className}`} title={title} style={style}>{children}</td>;
}

/* ---------------- DISCADOR ---------------- */

function DiscadorTab({ state, setState, goFila, refetchCloud }: { state: State; setState: React.Dispatch<React.SetStateAction<State>>; goFila: () => void; refetchCloud: () => Promise<void> }) {
  const [brokerId, setBrokerId] = useState(state.brokers[0]?.id ?? "");
  const [selectedList, setSelectedList] = useState<string>("all");
  const [note, setNote] = useState("");
  const [calledAt, setCalledAt] = useState<number | null>(null);
  const [waMsg, setWaMsg] = useState<string>(DEFAULT_WA_TEMPLATE);
  const [waEditing, setWaEditing] = useState(false);
  const [submittingOutcome, setSubmittingOutcome] = useState(false);
  const lastOutcomeRef = useRef<string>("");

  useEffect(() => { if (!brokerId && state.brokers[0]) setBrokerId(state.brokers[0].id); }, [state.brokers, brokerId]);

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

  const retryContactId = useMemo(() => {
    const lastCall = state.calls.find(
      (c) => c.brokerId === brokerId && c.contactId && !c.attended && !c.scheduled,
    );
    if (!lastCall?.contactId) return null;
    const contact = state.contacts.find((c) => c.id === lastCall.contactId);
    if (!contact) return null;
    const progress = contactProgress.get(sameContactKey(contact));
    const effectiveAttempts = Math.max(contact.attempts, progress?.attempts ?? 0);
    if (contact.status !== "pendente") return null;
    if (progress?.resolved) return null;
    if (effectiveAttempts !== 1) return null;
    if (!(contact.brokerId === brokerId || contact.brokerId === null)) return null;
    return contact.id;
  }, [state.calls, state.contacts, brokerId, contactProgress]);

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
    [state.contacts, brokerId, contactProgress, selectedList]
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
    if (!retryContactId) return myQueue;
    const retryContact = myQueue.find((c) => c.id === retryContactId);
    if (!retryContact) return myQueue;
    return [retryContact, ...myQueue.filter((c) => c.id !== retryContactId)];
  }, [myQueue, retryContactId]);

  const current = prioritizedQueue[0];
  const next = prioritizedQueue[1];

  useEffect(() => {
    lastOutcomeRef.current = "";
    setSubmittingOutcome(false);
  }, [current?.id, current?.attempts]);

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

  async function recordOutcome(attended: boolean, scheduled: boolean) {
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
    if (submittingOutcome || lastOutcomeRef.current === outcomeKey) return;
    lastOutcomeRef.current = outcomeKey;
    setSubmittingOutcome(true);

    const contactId = current.id;
    const contactName = current.name;
    const attemptsBefore = current.attempts;
    const startedAtIso = calledAt ? new Date(calledAt).toISOString() : undefined;
    const endedAtIso = new Date().toISOString();
    const duration = calledAt ? Math.max(0, Math.round((Date.now() - calledAt) / 1000)) : 0;

    try {
      const { data, error } = await supabase.rpc("record_call_outcome", {
        _contact_id: contactId,
        _attended: attended,
        _scheduled: scheduled,
        _notes: note.trim() || undefined,
        _started_at: startedAtIso,
        _ended_at: endedAtIso,
        _duration_seconds: duration,
      });
      if (error) throw error;
      const result = (data ?? {}) as { attempts?: number; inserted?: boolean };
      const newAttempts = Math.min(result.attempts ?? attemptsBefore + 1, 2);
      const keepForRetry = !attended && !scheduled && newAttempts < 2;
      if (keepForRetry) {
        toast(`Sem resposta — faça a 2ª tentativa agora`, { description: contactName });
      }
    } catch (e: any) {
      console.error("Falha ao registrar ligação", e);
      toast.error(e?.message || "Falha ao registrar ligação");
      void logDialerError({
        action: "record_call_outcome",
        error: e,
        listName: current?.listName,
        contactId,
        contactName,
        details: { attended, scheduled, attemptsBefore },
      });
      lastOutcomeRef.current = "";
      setSubmittingOutcome(false);
      return;
    }

    setNote("");
    setCalledAt(null);
    await refetchCloud();
    window.setTimeout(() => {
      lastOutcomeRef.current = "";
      setSubmittingOutcome(false);
    }, 150);

    if (!reached && k.total + 1 === meta) {
      toast.success(`🎉 META BATIDA! ${meta} ligações hoje`, { duration: 5000 });
    }
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
    setCalledAt(null);
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
    setCalledAt(null);
    window.setTimeout(() => setSubmittingOutcome(false), 800);
    toast("Movido pro fim da fila");
  }

  function startCall() {
    if (!current || submittingOutcome) return;
    setCalledAt(Date.now());
  }

  const brokerName = state.brokers.find((b) => b.id === brokerId)?.name ?? "—";

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
            <span>{myQueue.length} pendente{myQueue.length === 1 ? "" : "s"}</span>
          </div>

          <div className="my-4">
            <div className="text-[40px] sm:text-[56px] leading-[1.02] tracking-[-0.02em] font-semibold text-zinc-50" style={fontDisplay}>
              {current.name}
            </div>
            <div className="mt-3 text-2xl sm:text-3xl tracking-tight text-[#c9a24c]" style={fontNumeric}>
              {current.phone || "(sem telefone)"}
            </div>
            {current.attempts > 0 && (
              <div className="mt-2 inline-block rounded bg-amber-500/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-amber-300" style={fontDisplay}>
                Tentativa {current.attempts + 1} de 2
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
              <div className="text-[11px] uppercase tracking-[0.22em] text-emerald-400" style={fontDisplay}>Em ligação</div>
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

/* ---------------- ERROS (admin) ---------------- */

type DialerErrorRow = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  broker_id: string | null;
  broker_name: string | null;
  list_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  action: string | null;
  error_message: string;
  details: any;
  created_at: string;
};

function ErrosTab() {
  const [rows, setRows] = useState<DialerErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc("recent_dialer_errors", { _limit: 200 });
    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as DialerErrorRow[]);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  function fmt(d: string) {
    try {
      return new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    } catch { return d; }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold uppercase tracking-wider text-[#c9a24c]" style={fontDisplay}>
            Erros do Discador
          </h2>
          <p className="text-sm text-zinc-500 mt-1">Últimas 200 falhas registradas no sistema.</p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-xs font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
          style={fontDisplay}
        >
          <RefreshCw className="h-4 w-4" /> Atualizar
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 bg-[#171a23] overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-sm text-zinc-500">Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-zinc-500">Nenhum erro registrado. 🎉</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-[10px] uppercase tracking-[0.18em] text-zinc-500" style={fontDisplay}>
                <tr>
                  <th className="px-3 py-2 text-left">Quando</th>
                  <th className="px-3 py-2 text-left">Usuário</th>
                  <th className="px-3 py-2 text-left">Corretor</th>
                  <th className="px-3 py-2 text-left">Lista</th>
                  <th className="px-3 py-2 text-left">Contato</th>
                  <th className="px-3 py-2 text-left">Ação</th>
                  <th className="px-3 py-2 text-left">Erro</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-800/80 align-top">
                    <td className="px-3 py-2 text-zinc-300 whitespace-nowrap" style={fontNumeric}>{fmt(r.created_at)}</td>
                    <td className="px-3 py-2 text-zinc-300">{r.user_email || "—"}</td>
                    <td className="px-3 py-2 text-zinc-300">{r.broker_name || "—"}</td>
                    <td className="px-3 py-2 text-zinc-300">{r.list_name || "—"}</td>
                    <td className="px-3 py-2 text-zinc-300">{r.contact_name || "—"}</td>
                    <td className="px-3 py-2 text-zinc-400">{r.action || "—"}</td>
                    <td className="px-3 py-2 text-red-300">{r.error_message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
