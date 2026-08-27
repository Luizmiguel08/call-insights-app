import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Phone, History, BarChart3, Users, Trash2, Plus, Check, X, Calendar, UserCircle2, Zap, Undo2, Upload, PhoneCall, SkipForward, Target, ListPlus, LogOut, Cloud, MessageCircle, Pencil, Save, AlertTriangle, RefreshCw, Bell, Flame, Menu } from "lucide-react";
import fortalLogo from "@/assets/fortal-logo.png.asset.json";
import wolfBg from "@/assets/wolf-wall-street.png.asset.json";
import { useCloudState, newId, type Me } from "@/lib/cloud-state";
import { supabase } from "@/integrations/supabase/client";
import { useDialerSession } from "@/hooks/useDialerSession";
import { recordContactAttempt, useContactBuffer } from "@/hooks/useContactBuffer";
import { useConnectionWatchdog } from "@/hooks/useConnectionWatchdog";
import { ConnectionIndicator } from "@/components/dialer/ConnectionIndicator";
import {
  type Broker, type Call, type Contact, type State, type Tab,
  todayISO, normalizedContactKey, callContactKey, uniqueContactCountWhere,
  normalizePhone, telHref, DEFAULT_WA_TEMPLATE, DEFAULT_WA_TEMPLATE_2, renderWaMessage, waHrefFromMessage, logDialerError,
  fontDisplay, fontNumeric, inputCls, attemptLabel,
  Field, YesNo, Kpi, Badge, Th, Td,
} from "@/lib/dialer-shared";


// Lazy-loaded heavy/secondary tabs — keeps initial bundle small for mobile.
const HistoricoTab = lazy(() => import("@/components/dialer/HistoricoTab"));
const DashboardTab = lazy(() => import("@/components/dialer/DashboardTab"));
const ErrosTab = lazy(() => import("@/components/dialer/ErrosTab"));
const LembretesTab = lazy(() => import("@/components/dialer/LembretesTab"));
const importDiscador = () => import("@/components/dialer/DiscadorTab");
const importLeads = () => import("@/components/dialer/LeadsTab");
const DiscadorTab = lazy(importDiscador);
const LeadsTab = lazy(importLeads);
import { ReminderForm, useReminderNotifier } from "@/components/dialer/LembretesTab";

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


  // Aguardando aprovação do admin (renderizado depois de TODOS os hooks)
  const awaitingApproval = Boolean(
    hydrated && me && !me.isAdmin && !me.approved && !me.profileUnknown && me.brokerId,
  );


  const isAdmin = me?.isAdmin ?? false;

  // Contagem de lembretes pendentes (para badge na aba Lembretes)
  const [pendingReminders, setPendingReminders] = useState(0);
  useEffect(() => {
    if (!me?.userId) return;
    let alive = true;
    const load = async () => {
      const q = (supabase as any)
        .from("call_reminders")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "snoozed"]);
      if (!isAdmin) q.eq("user_id", me.userId);
      const { count } = await q;
      if (alive) setPendingReminders(count ?? 0);
    };
    void load();
    const ch = (supabase as any)
      .channel(`reminders-badge-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "call_reminders" }, () => void load())
      .subscribe();
    return () => { alive = false; (supabase as any).removeChannel(ch); };
  }, [me?.userId, isAdmin]);

  // Contagem de leads novos do C2S (badge)
  const [newLeads, setNewLeads] = useState(0);
  useEffect(() => {
    if (!me?.userId) return;
    let alive = true;
    const load = async () => {
      const { count } = await (supabase as any)
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("status", "novo");
      if (alive) setNewLeads(count ?? 0);
    };
    void load();
    const ch = (supabase as any)
      .channel(`crm-leads-badge-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_leads" }, () => void load())
      .subscribe();
    return () => { alive = false; (supabase as any).removeChannel(ch); };
  }, [me?.userId]);

  const primaryTabs: { id: Tab; label: string; icon: typeof Phone; badge?: number }[] = [
    { id: "discador", label: "Discador", icon: PhoneCall },
    { id: "leads", label: "Leads", icon: Flame, badge: newLeads },
  ];
  const menuTabs: { id: Tab; label: string; icon: typeof Phone; admin?: boolean; badge?: number }[] = [
    { id: "fila", label: "Fila de contatos", icon: ListPlus },
    { id: "lembretes", label: "Lembretes", icon: Bell, badge: pendingReminders },
    { id: "rapido", label: "Registro rápido", icon: Zap },
    { id: "historico", label: "Histórico", icon: History },
    { id: "dashboard", label: "Painel", icon: BarChart3 },
    { id: "corretores", label: isAdmin ? "Equipe" : "Minha conta", icon: Users },
    { id: "erros", label: "Erros", icon: AlertTriangle, admin: true },
  ].filter((t) => !(t as any).admin || isAdmin) as typeof menuTabs;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const activeMenuTab = menuTabs.find((t) => t.id === tab) ?? null;
  const menuBadge = menuTabs.reduce((a, t) => a + (t.badge ?? 0), 0);

  useReminderNotifier(me, () => setTab("lembretes"));

  if (awaitingApproval && me) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-[#0c0e14] text-zinc-100 px-4 relative" style={{ fontFamily: "'DM Sans', system-ui, sans-serif", backgroundImage: `linear-gradient(rgba(11,13,19,0.85), rgba(11,13,19,0.92)), url(${wolfBg.url})`, backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "fixed" }}>
        <div className="w-full max-w-md text-center">
          <img src={fortalLogo.url} alt="Fortal" width={96} height={96} className="mx-auto h-24 w-24 object-contain mb-6" />
          <div className="text-2xl text-[#c9a84c] tracking-[0.28em] font-medium mb-2" style={fontDisplay}>FORTAL</div>
          <div className="rounded-2xl border border-zinc-800 bg-[#13151e] p-6 mt-6">
            <h1 className="text-xl font-bold uppercase tracking-wider text-[#c9a84c]" style={fontDisplay}>Aguardando aprovação</h1>
            <p className="mt-3 text-sm text-zinc-400">Sua conta <strong className="text-zinc-200">{me.email}</strong> foi criada e está aguardando o Miguel aprovar e definir seu nome de corretor.</p>
            <button onClick={signOut} className="mt-6 w-full h-11 rounded-md border border-zinc-700 text-xs font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800" style={fontDisplay}>
              <LogOut className="inline h-4 w-4 mr-2" /> Sair
            </button>
          </div>
        </div>
      </div>
    );
  }



  return (
    <div
      className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)]"
      style={{ fontFamily: "'DM Sans', system-ui, sans-serif", background: "#fafbfc", color: "#101725" }}
    >
      <header
        className="sticky top-0 z-30 pt-[env(safe-area-inset-top)]"
        style={{ background: "rgba(250,251,252,0.88)", backdropFilter: "blur(12px)", borderBottom: "1px solid #e8ecf1" }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src={fortalLogo.url} alt="Fortal" width={32} height={32} className="h-8 w-8 object-contain" />
            <span
              className="text-[15px] font-bold tracking-[0.16em]"
              style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: "#101725" }}
            >
              FORTAL
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Abas principais */}
            <div className="flex items-center gap-1 rounded-full p-1" style={{ background: "#eef1f5" }}>
              {primaryTabs.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className="relative rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-all sm:px-4"
                    style={{
                      fontFamily: "'Space Grotesk', system-ui, sans-serif",
                      background: active ? "#ffffff" : "transparent",
                      color: active ? "#1d4ed8" : "#64748b",
                      boxShadow: active ? "0 1px 2px rgba(16,23,37,0.10)" : "none",
                    }}
                  >
                    {t.label}
                    {(t.badge ?? 0) > 0 && (
                      <span
                        className="ml-1.5 inline-flex items-center rounded-full px-1.5 text-[10px] font-bold"
                        style={{ background: "#3b82f6", color: "#fff" }}
                      >
                        {t.badge! > 99 ? "99+" : t.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Menu com o resto */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-label="Abrir menu"
                className="relative flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-semibold transition-colors"
                style={{
                  fontFamily: "'Space Grotesk', system-ui, sans-serif",
                  border: "1px solid #e2e8f0",
                  background: menuOpen || activeMenuTab ? "#101725" : "#ffffff",
                  color: menuOpen || activeMenuTab ? "#ffffff" : "#475569",
                }}
              >
                <Menu className="h-4 w-4" />
                <span className="hidden sm:inline">{activeMenuTab ? activeMenuTab.label : "Menu"}</span>
                {!menuOpen && menuBadge > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full" style={{ background: "#ef4444" }} />
                )}
              </button>

              {menuOpen && (
                <div
                  className="absolute right-0 mt-2 w-60 overflow-hidden rounded-2xl p-1.5"
                  style={{ background: "#ffffff", border: "1px solid #e8ecf1", boxShadow: "0 18px 45px -20px rgba(16,23,37,0.30)" }}
                >
                  {menuTabs.map((t) => {
                    const Icon = t.icon;
                    const active = tab === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => { setTab(t.id); setMenuOpen(false); }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors"
                        style={{ background: active ? "#eff4ff" : "transparent", color: active ? "#1d4ed8" : "#334155" }}
                      >
                        <Icon className="h-4 w-4 shrink-0" style={{ color: active ? "#3b82f6" : "#94a3b8" }} />
                        <span className="flex-1">{t.label}</span>
                        {(t.badge ?? 0) > 0 && (
                          <span
                            className="rounded-full px-1.5 text-[10px] font-bold"
                            style={{ background: "#ef4444", color: "#fff" }}
                          >
                            {t.badge! > 99 ? "99+" : t.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  <div className="my-1.5 h-px" style={{ background: "#eef1f5" }} />
                  <div className="flex items-center justify-between px-3 pb-1 pt-0.5">
                    <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "#94a3b8" }}>
                      <ConnectionIndicator state={dialerSession.isConnected} lastSyncAt={dialerSession.lastSyncAt} />
                    </div>
                    <span className="text-[11px] tabular-nums" style={{ color: "#94a3b8" }}>
                      {new Date().toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                  <button
                    onClick={signOut}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium"
                    style={{ color: "#dc2626" }}
                  >
                    <LogOut className="h-4 w-4" /> Sair
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>


      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        {visited.discador && (
          <div style={{ display: tab === "discador" ? undefined : "none" }}>
            <Suspense fallback={<TabFallback />}><DiscadorTab goFila={() => setTab("fila")} state={state} me={me} /></Suspense>
          </div>
        )}
        {visited.leads && (
          <div style={{ display: tab === "leads" ? undefined : "none" }}>
            <Suspense fallback={<TabFallback />}><LeadsTab me={me} isAdmin={isAdmin} state={state} /></Suspense>
          </div>
        )}
        {tab !== "discador" && tab !== "leads" && (
        <div className="rounded-3xl p-3 sm:p-5" style={{ background: "#0b0d13", border: "1px solid #e2e8f0" }}>
        {tab === "fila" && <FilaTab state={state} setState={setState} isAdmin={isAdmin} me={me} refetchCloud={refetchCloud} />}
        {tab === "rapido" && <RapidoTab state={state} setState={setState} />}
        {tab === "lembretes" && <LembretesTab me={me} isAdmin={isAdmin} />}
        {tab === "historico" && <HistoricoTab state={state} setState={setState} me={me} isAdmin={isAdmin} />}
        {tab === "dashboard" && <DashboardTab state={state} />}
        {tab === "corretores" && <CorretoresTab state={state} fullState={fullState} setState={setState} isAdmin={isAdmin} me={me} />}
        {tab === "erros" && isAdmin && <ErrosTab />}
        </div>
        )}

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

  // Cronômetro da ligação (aba Rápido)
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!callStartedAt) return;
    setElapsed(Math.floor((Date.now() - callStartedAt) / 1000));
    const t = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - callStartedAt) / 1000));
    }, 500);
    return () => window.clearInterval(t);
  }, [callStartedAt]);

  useEffect(() => {
    if (!state.brokers.length) return;
    if (!brokerId || !state.brokers.some((b) => b.id === brokerId)) setBrokerId(state.brokers[0].id);
  }, [state.brokers, brokerId]);
  useEffect(() => { nameRef.current?.focus(); }, [brokerId, date]);

  function fmtElapsed(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  function startCallTimer() {
    if (!callStartedAt) setCallStartedAt(Date.now());
  }

  function quickSave(attended: boolean, scheduled: boolean) {
    const name = client.trim();
    if (!name) { toast.error("Digite o nome do cliente"); nameRef.current?.focus(); return; }
    if (!brokerId) { toast.error("Selecione um corretor"); return; }
    if (!callStartedAt) {
      toast.error("Clique em Discar antes de marcar o desfecho", {
        description: "O cronômetro registra a duração da ligação.",
      });
      return;
    }
    const endedAt = Date.now();
    const duration = Math.max(0, Math.round((endedAt - callStartedAt) / 1000));
    const normalized = phone.trim() ? normalizePhone(phone) : undefined;
    const call: Call = {
      id: uid(), date, brokerId, client: name, phone: normalized,
      attended, scheduled, note: note.trim(), createdAt: Date.now(),
      startedAt: callStartedAt, endedAt, durationSeconds: duration,
    };
    setState((s) => ({ ...s, calls: [call, ...s.calls] }));
    if (duration < 4) toast.warning(`Ligação registrada (${duration}s — fantasma)`);
    setClient("");
    setPhone("");
    setNote("");
    setCallStartedAt(null);
    setElapsed(0);
    setTimeout(() => nameRef.current?.focus(), 0);
  }

  function addOnly() {
    const name = client.trim();
    if (!name) { toast.error("Digite o nome do cliente"); nameRef.current?.focus(); return; }
    if (!brokerId) { toast.error("Selecione um corretor"); return; }
    const normalized = phone.trim() ? normalizePhone(phone) : undefined;
    const call: Call = { id: uid(), date, brokerId, client: name, phone: normalized, attended: false, scheduled: false, note: note.trim(), createdAt: Date.now(), startedAt: null, endedAt: null, durationSeconds: 0 };
    setState((s) => ({ ...s, calls: [call, ...s.calls] }));
    toast.success("Adicionado ao histórico", { description: name });
    setClient("");
    setPhone("");
    setNote("");
    setCallStartedAt(null);
    setElapsed(0);
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
  const k = {
    total: today.length,
    attended: attendedUnique,
    notAttended: today.filter((c) => !c.attended).length,
    scheduled: uniqueContactCountWhere(today, (c) => c.scheduled),
  };

  const brokerName = state.brokers.find((b) => b.id === brokerId)?.name ?? "—";

  return (
    <div className="space-y-5">
      {/* Barra: corretor + data + desfazer */}
      <div className="grid gap-3 sm:grid-cols-[1fr_220px_auto] items-end rounded-lg border border-zinc-800 bg-[#13151e] p-4">
        <Field label="Corretor">
          <div className="relative">
            <UserCircle2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <select value={brokerId} onChange={(e) => setBrokerId(e.target.value)} className={inputCls + " pl-9 appearance-none text-base font-semibold"}>
              {state.brokers.map((b) => <option key={b.id} value={b.id} className="bg-[#13151e]">{b.name}</option>)}
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
      <div className="rounded-lg border-2 border-[#c9a84c]/40 bg-[#13151e] p-6 shadow-[0_0_40px_-12px_#c9a84c]">
        <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-2xl font-bold uppercase tracking-wider" style={fontDisplay}>
            <Zap className="inline h-5 w-5 text-[#c9a84c] mb-1" /> Ligação avulsa — {brokerName}
          </h2>
          {callStartedAt ? (
            <div className="inline-flex items-center gap-2 rounded-md border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.22em] text-emerald-300" style={fontDisplay}>
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              Em ligação · <span className="tabular-nums">{fmtElapsed(elapsed)}</span>
            </div>
          ) : (
            <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>
              Cronômetro inicia ao clicar em Discar
            </div>
          )}
        </div>


        <div className="grid gap-3 sm:grid-cols-[1fr_240px]">
          <Field label="Nome do cliente">
            <input
              ref={nameRef}
              value={client}
              onChange={(e) => setClient(e.target.value)}
              onKeyDown={onNameKeyDown}
              placeholder="Ex.: João Silva"
              className="h-12 w-full rounded-md border border-zinc-700 bg-[#0c0e14] px-4 text-base font-semibold text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-[#c9a84c] focus:ring-2 focus:ring-[#c9a84c]/30"
              autoFocus
            />
          </Field>
          <Field label="Telefone">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(11) 99999-8888"
              inputMode="tel"
              className="h-12 w-full rounded-md border border-zinc-700 bg-[#0c0e14] px-4 text-base font-mono text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-[#c9a84c] focus:ring-2 focus:ring-[#c9a84c]/30"
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
              className="w-full rounded-md border border-zinc-700 bg-[#0c0e14] px-4 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-[#c9a84c] focus:ring-2 focus:ring-[#c9a84c]/30 resize-y"
            />
          </Field>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
          <a
            href={dialHref}
            onClick={(e) => {
              if (!dialReady) { e.preventDefault(); return; }
              startCallTimer();
            }}
            className={`flex items-center justify-center gap-2 h-14 rounded-md text-base font-bold uppercase tracking-[0.18em] transition ${
              dialReady
                ? "bg-[#c9a84c] text-black hover:bg-[#d4b968]"
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
            className="flex items-center justify-center gap-2 h-14 rounded-md border-2 border-zinc-600 bg-[#0c0e14] px-6 text-base font-bold uppercase tracking-[0.18em] text-zinc-200 hover:bg-zinc-800 hover:border-zinc-500 transition"
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
        <Kpi label="Ligações hoje" value={k.total} color="#c9a84c" />
        <Kpi label="Atendidas" value={k.attended} color="#22c55e" />
        <Kpi label="Não atend." value={k.notAttended} color="#ef4444" />
        <Kpi label="Agendadas" value={k.scheduled} color="#eab308" />
      </div>

      {/* Últimas registradas hoje */}
      {today.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-[#13151e] p-5">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-zinc-400" style={fontDisplay}>
            Últimas registradas — {brokerName}
          </h3>
          <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
            {today.slice(0, 30).map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded border border-zinc-800 bg-[#0c0e14] px-3 py-2">
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
    orange: "border-[#c9a84c]/60 bg-[#c9a84c]/15 text-[#c9a84c] hover:bg-[#c9a84c]/25 hover:border-[#c9a84c]",
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
    <div className="flex flex-col items-center justify-center rounded-md border border-zinc-800 bg-[#1a1d28] px-2 py-1.5">
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
        <div className="rounded-lg border border-zinc-800 bg-[#13151e] p-6">
          <div className="text-[11px] uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>Sua conta</div>
          <div className="mt-2 text-3xl font-bold text-zinc-100" style={fontDisplay}>{myBroker?.name ?? me?.email}</div>
          <div className="mt-1 text-sm text-zinc-500">{me?.email}</div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Kpi label="Total ligações" value={myCalls.length} color="#c9a84c" />
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
        <div className="rounded-lg border border-[#c9a84c]/40 bg-[#c9a84c]/10 p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-bold uppercase tracking-[0.2em] text-[#c9a84c]" style={fontDisplay}>Você ainda não é corretor</div>
            <div className="text-xs text-zinc-400 mt-1">Adicione-se à equipe pra ter sua própria fila de contatos.</div>
          </div>
          <button onClick={addMeAsBroker} className="h-10 rounded-md bg-[#c9a84c] px-4 text-xs font-bold uppercase tracking-wider text-black hover:bg-[#d4b968]" style={fontDisplay}>
            <Plus className="inline h-4 w-4 mr-1" strokeWidth={3} /> Me adicionar como corretor
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="rounded-lg border border-[#c9a84c]/40 bg-[#c9a84c]/10 p-4">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-[#c9a84c]" style={fontDisplay}>
            Aguardando aprovação ({pending.length})
          </h3>
          <div className="space-y-2">
            {pending.map((b) => (
              <PendingRow key={b.id} broker={b} onRename={(n) => rename(b.id, n)} onApprove={() => approve(b.id)} onReject={() => remove(b.id)} />
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-[#13151e]">
        <table className="w-full text-sm">
          <thead className="bg-[#0c0e14] text-[11px] uppercase tracking-[0.18em] text-zinc-500" style={fontDisplay}>
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
              const tot = own.length;
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
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-[#13151e] p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== broker.name && onRename(name.trim())}
        className="flex-1 min-w-[180px] h-9 rounded-md border border-zinc-700 bg-[#0c0e14] px-3 text-sm text-zinc-100 outline-none focus:border-[#c9a84c]"
        placeholder="Nome do corretor"
      />
      <button
        onClick={() => { if (name.trim() && name !== broker.name) onRename(name.trim()); onApprove(); }}
        className="h-9 rounded-md bg-[#c9a84c] px-4 text-xs font-bold uppercase tracking-wider text-black hover:bg-[#d4b968]"
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



function QuickReminderSheet({
  me, contact, onClose, onSaved,
}: {
  me: { userId: string; brokerId: string | null };
  contact: { id: string; name: string; phone: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reminderTime, setReminderTime] = useState<string>("Hoje às 17h");
  const [customWhen, setCustomWhen] = useState<string>("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  function resolveWhen(): Date | null {
    const now = new Date();
    const at = (d: Date, h: number, m = 0) => {
      const x = new Date(d);
      x.setHours(h, m, 0, 0);
      return x;
    };
    if (reminderTime === "Hoje às 17h") {
      const d = at(now, 17);
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
      return d;
    }
    if (reminderTime === "Amanhã às 9h") {
      const d = new Date(now); d.setDate(d.getDate() + 1); return at(d, 9);
    }
    if (reminderTime === "Amanhã às 14h") {
      const d = new Date(now); d.setDate(d.getDate() + 1); return at(d, 14);
    }
    if (reminderTime === "Escolher data") {
      if (!customWhen) return null;
      return new Date(customWhen);
    }
    return null;
  }

  async function save() {
    if (!me.brokerId) { toast.error("Corretor não identificado"); return; }
    const when = resolveWhen();
    if (!when || isNaN(when.getTime())) { toast.error("Escolha uma data/hora"); return; }
    setSaving(true);
    const r = await (supabase as any).from("call_reminders").insert({
      broker_id: me.brokerId,
      user_id: me.userId,
      contact_id: contact.id,
      contact_name: contact.name,
      contact_phone: contact.phone,
      scheduled_for: when.toISOString(),
      note: note.trim() || null,
    });
    setSaving(false);
    if (r.error) { toast.error("Falha ao salvar"); console.error(r.error); return; }
    onSaved();
  }

  const options = ["Hoje às 17h", "Amanhã às 9h", "Amanhã às 14h", "Escolher data"];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 50,
        background: "rgba(12,14,20,0.92)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 520,
          background: "var(--surface-1)",
          borderRadius: "var(--radius-lg) var(--radius-lg) 0 0",
          border: "1px solid var(--border)",
          padding: 20,
          paddingBottom: "max(env(safe-area-inset-bottom), 20px)",
        }}
      >
        <div style={{ ...fontDisplay, fontSize: 14, fontWeight: 500, color: "#fff", marginBottom: 4 }}>
          Agendar lembrete
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 14 }}>
          {contact.name}{contact.phone ? ` · ${contact.phone}` : ""}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          {options.map((opt) => {
            const active = reminderTime === opt;
            return (
              <button
                key={opt}
                onClick={() => setReminderTime(opt)}
                style={{
                  padding: 10,
                  background: active ? "#c9a84c0f" : "var(--surface-0)",
                  border: `0.5px solid ${active ? "var(--gold-border)" : "var(--border)"}`,
                  borderRadius: "var(--radius-sm)",
                  fontSize: 11,
                  color: active ? "var(--gold)" : "var(--text-secondary)",
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                }}
              >
                {opt}
              </button>
            );
          })}
        </div>

        {reminderTime === "Escolher data" && (
          <input
            type="datetime-local"
            value={customWhen}
            onChange={(e) => setCustomWhen(e.target.value)}
            style={{
              width: "100%", padding: "9px 12px",
              background: "var(--surface-0)",
              border: "0.5px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontSize: 12, color: "#ffffffcc",
              outline: "none", marginBottom: 12,
              colorScheme: "dark",
            }}
          />
        )}

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="O que o cliente pediu? (opcional)"
          rows={2}
          style={{
            width: "100%", padding: "9px 12px",
            background: "var(--surface-0)",
            border: "0.5px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            fontSize: 12, color: "#ffffffcc",
            resize: "none", outline: "none", marginBottom: 12,
            fontFamily: "inherit",
          }}
        />

        <button
          onClick={save}
          disabled={saving}
          style={{
            width: "100%", padding: 12,
            background: "var(--gold)", border: "none",
            borderRadius: "var(--radius-md)",
            fontSize: 12, fontWeight: 600, color: "var(--surface-0)",
            cursor: saving ? "wait" : "pointer",
            letterSpacing: "0.06em", marginBottom: 8,
            opacity: saving ? 0.7 : 1,
            ...fontDisplay,
          }}
        >
          {saving ? "SALVANDO..." : "SALVAR E AVANÇAR"}
        </button>
        <button
          onClick={onClose}
          style={{
            width: "100%", padding: 10,
            background: "transparent",
            border: "0.5px solid var(--border)",
            borderRadius: "var(--radius-md)",
            fontSize: 11, color: "var(--text-muted)",
            cursor: "pointer", letterSpacing: "0.04em",
            ...fontDisplay,
          }}
        >
          CANCELAR
        </button>
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

function CallTimerInline({ startedAt }: { startedAt: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);
  const secs = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  const color = secs < 4 ? "var(--red)" : secs < 60 ? "var(--amber)" : "var(--green)";
  return (
    <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color, fontWeight: 600 }}>
      {mm}:{ss}{secs < 4 && secs > 0 ? " ⚠ Muito curta" : ""}
    </span>
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
  // Contagem REAL vinda do banco. O estado local guarda só uma amostra (200
  // linhas) para não baixar dezenas de milhares de contatos no bootstrap —
  // por isso uma lista de 1.000 aparecia com número menor na tela.
  const [dbCounts, setDbCounts] = useState<{ pending: number; done: number; skipped: number } | null>(null);
  const [countsLoading, setCountsLoading] = useState(false);



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

  // Contagem exata no banco, respeitando os filtros da tela.
  const refreshCounts = useCallback(async () => {
    setCountsLoading(true);
    try {
      const base = () => {
        let q: any = (supabase.from("contacts_queue") as any).select("id", { count: "exact", head: true });
        if (!isAdmin) {
          q = me?.brokerId ? q.eq("broker_id", me.brokerId) : q.is("broker_id", null);
        } else if (filterBroker === "geral") {
          q = q.is("broker_id", null);
        } else if (filterBroker !== "all") {
          q = q.eq("broker_id", filterBroker);
        }
        if (filterList !== "all") q = q.eq("list_name", filterList);
        return q;
      };
      const [p, d, s] = await Promise.all([
        base().eq("status", "pending"),
        base().eq("status", "done"),
        base().eq("status", "skipped"),
      ]);
      setDbCounts({ pending: p.count ?? 0, done: d.count ?? 0, skipped: s.count ?? 0 });
    } catch {
      setDbCounts(null);
    } finally {
      setCountsLoading(false);
    }
  }, [isAdmin, me?.brokerId, filterBroker, filterList]);

  useEffect(() => { void refreshCounts(); }, [refreshCounts]);



  // Parser tolerante: aceita "Nome; telefone", "Nome telefone", "telefone Nome",
  // telefone sozinho e também nome numa linha com o telefone na linha seguinte
  // (formato comum ao copiar contatos do celular/WhatsApp).
  // Só entra na fila quem tem telefone com pelo menos 10 dígitos — números
  // quebrados (ex.: "+021") eram salvos e travavam a fila inteira.
  type ParsedRow = { name: string; phone: string; raw: string; valid: boolean };
  function parseLines(text: string): ParsedRow[] {
    const out: ParsedRow[] = [];
    const digitsOf = (s: string) => (s || "").replace(/\D/g, "");
    const extract = (line: string) => {
      const candidates = line.match(/\+?\d[\d\s().\-]{7,}\d/g) ?? [];
      let best = "";
      for (const c of candidates) if (digitsOf(c).length > digitsOf(best).length) best = c;
      if (!best) return null;
      const name = line.replace(best, " ").replace(/[;,\t|]+/g, " ").replace(/\s+/g, " ").trim();
      return { name, phone: best.trim() };
    };

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let pendingName: string | null = null;

    for (const line of lines) {
      const hit = extract(line);
      if (!hit) {
        // Linha sem telefone: guarda como nome para casar com a próxima linha.
        if (pendingName) out.push({ name: pendingName, phone: "", raw: pendingName, valid: false });
        pendingName = line.replace(/[;,\t|]+/g, " ").replace(/\s+/g, " ").trim();
        continue;
      }
      let name = hit.name;
      if (!name && pendingName) name = pendingName;
      pendingName = null;
      const phone = normalizePhone(hit.phone);
      const valid = digitsOf(phone).length >= 10;
      out.push({ name: name || digitsOf(hit.phone), phone, raw: line, valid });
    }
    if (pendingName) out.push({ name: pendingName, phone: "", raw: pendingName, valid: false });
    return out;
  }

  const parsed = useMemo(() => parseLines(bulk), [bulk]);
  const preview = useMemo(() => parsed.filter((p) => p.valid), [parsed]);
  const invalidRows = useMemo(() => parsed.filter((p) => !p.valid), [parsed]);


  // Relatório da sincronização: se o banco recusou alguma linha, o corretor
  // precisa saber quantas entraram de fato (antes o lote inteiro sumia calado).
  useEffect(() => {
    const onReport = (e: Event) => {
      const d = (e as CustomEvent).detail ?? {};
      if (d.table !== "contacts_queue") return;
      if (d.error) {
        toast.error("Parte da importação falhou", {
          description: `${d.inserted} salvo(s), ${d.skipped} repetido(s). ${d.error}`,
        });
      } else if (d.skipped > 0) {
        toast.warning(`${d.skipped} contato(s) repetido(s) não foram salvos`, {
          description: `${d.inserted} contato(s) salvos com sucesso`,
        });
      }
    };
    window.addEventListener("dialer:import-report", onReport);
    return () => window.removeEventListener("dialer:import-report", onReport);
  }, []);


  async function importContacts() {
    if (preview.length === 0) {
      toast.error("Nenhum contato com telefone válido", {
        description: invalidRows.length
          ? `${invalidRows.length} linha(s) sem telefone com pelo menos 10 dígitos`
          : "Cole pelo menos um contato",
      });
      return;
    }

    const brokerId = assignTo || null;
    const cleanList = (listName.trim() || "Geral").slice(0, 80);
    const digits = (p: string) => (p || "").replace(/\D/g, "");

    // O banco só aceita 1 pendente por corretor + telefone. Consultamos o
    // BANCO (não a amostra local de 200 linhas) para saber quais já existem —
    // antes, uma lista grande perdia linhas silenciosamente no insert.
    const existing = new Set<string>();
    try {
      const phones = Array.from(new Set(preview.map((p) => p.phone).filter(Boolean)));
      for (let i = 0; i < phones.length; i += 300) {
        const slice = phones.slice(i, i + 300);
        let q: any = (supabase.from("contacts_queue") as any)
          .select("phone")
          .eq("status", "pending")
          .in("phone", slice);
        q = brokerId ? q.eq("broker_id", brokerId) : q.is("broker_id", null);
        const { data } = await q;
        for (const row of (data ?? []) as any[]) existing.add(digits(row.phone));
      }
    } catch {
      /* sem checagem prévia: o insert linha-a-linha ainda protege o lote */
    }

    const seen = new Set<string>();
    const kept: typeof preview = [];
    let duplicates = 0;
    for (const p of preview) {
      const d = digits(p.phone);
      if (d && (existing.has(d) || seen.has(d))) { duplicates += 1; continue; }
      if (d) seen.add(d);
      kept.push(p);
    }
    if (kept.length === 0) {
      toast.error("Todos os contatos colados já estão na fila", {
        description: `${duplicates} número(s) repetido(s) ignorado(s)`,
      });
      return;
    }

    const newContacts: Contact[] = kept.map((p, i) => ({
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
    toast.success(`${newContacts.length} contato(s) enviado(s) para a lista "${cleanList}"`, {
      description: [
        brokerId ? `Atribuído a ${state.brokers.find(b => b.id === brokerId)?.name}` : "Fila geral",
        duplicates > 0 ? `${duplicates} já estavam na fila` : null,
        invalidRows.length > 0 ? `${invalidRows.length} sem telefone válido` : null,
      ].filter(Boolean).join(" · "),

    });
    setBulk("");
    // Confere no banco quantos realmente entraram (evita "sumiço" silencioso).
    window.setTimeout(() => { void refreshCounts(); }, 2500);
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

  // Números reais do banco quando disponíveis; a amostra local é só fallback.
  const pending = dbCounts?.pending ?? visible.filter((c) => c.status === "pendente").length;
  const done = dbCounts?.done ?? visible.filter((c) => c.status === "feito").length;
  const skipped = dbCounts?.skipped ?? visible.filter((c) => c.status === "pulado").length;


  return (
    <div className="space-y-5">
      {/* Config meta */}
      <div className="rounded-lg border border-zinc-800 bg-[#13151e] p-5 flex flex-wrap items-end gap-4">
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
              className="h-10 rounded-md bg-[#c9a84c] px-4 text-xs font-bold uppercase tracking-wider text-black hover:bg-[#d4b968]"
              style={fontDisplay}
            >Salvar</button>
          </div>
        </Field>
        <div className="flex flex-1 items-end gap-3 justify-end">
          <Kpi label="Pendentes" value={pending} color="#c9a84c" />
          <Kpi label="Feitos" value={done} color="#22c55e" />
          <Kpi label="Pulados" value={skipped} color="#71717a" />
          <button
            onClick={() => { void refreshCounts(); }}
            disabled={countsLoading}
            className="h-10 rounded-md border border-zinc-700 px-3 text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            style={fontDisplay}
          >{countsLoading ? "Contando…" : "Atualizar"}</button>
        </div>
      </div>


      {/* Importar */}
      <div className="rounded-lg border border-zinc-800 bg-[#13151e] p-5">
        <h2 className="mb-4 text-2xl font-bold uppercase tracking-wider" style={fontDisplay}>
          <Upload className="inline h-5 w-5 text-[#c9a84c] mb-1 mr-2" />
          Importar contatos do Excel
        </h2>
        <p className="mb-3 text-xs text-zinc-400">
          Cole 1 contato por linha. Formatos aceitos: <code className="text-[#c9a84c]">Nome, Telefone</code> · <code className="text-[#c9a84c]">Nome; Telefone</code> · <code className="text-[#c9a84c]">Nome \t Telefone</code> (cópia direta do Excel).
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
                  <option value="" className="bg-[#13151e]">Fila geral (qualquer corretor)</option>
                  {state.brokers.map((b) => (
                    <option key={b.id} value={b.id} className="bg-[#13151e]">{b.name}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <div className="rounded-md border border-zinc-800 bg-[#0c0e14] p-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>Atribuído a</div>
                <div className="mt-1 text-sm font-semibold text-zinc-100">{me?.brokerName ?? "—"}</div>
                <div className="text-xs text-zinc-500">Contatos importados ficam só com você.</div>
              </div>
            )}
            <div className="rounded-md border border-zinc-800 bg-[#0c0e14] p-3">
              <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>Pré-visualização</div>
              <div className="mt-1 text-4xl tracking-tight text-[#c9a84c]" style={fontNumeric}>
                {preview.length}
              </div>
              <div className="text-xs text-zinc-500">contato(s) válido(s)</div>
              {invalidRows.length > 0 && (
                <div className="mt-1 text-xs text-amber-400">
                  {invalidRows.length} linha(s) sem telefone válido serão ignoradas
                </div>
              )}

            </div>
            <button
              onClick={importContacts}
              className="h-12 w-full rounded-md bg-[#c9a84c] text-sm font-bold uppercase tracking-[0.2em] text-black hover:bg-[#d4b968]"
              style={fontDisplay}
            >
              Importar {preview.length > 0 ? `${preview.length} contato(s)` : ""}
            </button>
          </div>
        </div>
      </div>

      {/* Lista de contatos */}
      <div className="rounded-lg border border-zinc-800 bg-[#13151e]">
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-zinc-800">
          <Field label="Filtrar por corretor" className="min-w-[200px]">
            <select value={filterBroker} onChange={(e) => setFilterBroker(e.target.value)} className={inputCls + " appearance-none"}>
              <option value="all" className="bg-[#13151e]">Todos</option>
              <option value="geral" className="bg-[#13151e]">Fila geral</option>
              {state.brokers.map((b) => (
                <option key={b.id} value={b.id} className="bg-[#13151e]">{b.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Filtrar por lista" className="min-w-[200px]">
            <select value={filterList} onChange={(e) => setFilterList(e.target.value)} className={inputCls + " appearance-none"}>
              <option value="all" className="bg-[#13151e]">Todas</option>
              {availableLists.map((l) => (
                <option key={l} value={l} className="bg-[#13151e]">{l}</option>
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
            <thead className="bg-[#0c0e14] text-[11px] uppercase tracking-[0.18em] text-zinc-500" style={fontDisplay}>
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
                        className="h-8 rounded border border-zinc-700 bg-[#0c0e14] px-2 text-xs text-zinc-200 outline-none focus:border-[#c9a84c]"
                      >
                        <option value="" className="bg-[#13151e]">Geral</option>
                        {state.brokers.map((b) => (
                          <option key={b.id} value={b.id} className="bg-[#13151e]">{b.name}</option>
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
      className="w-full bg-transparent px-1 py-0.5 outline-none rounded hover:bg-zinc-800/40 focus:bg-zinc-800/60 focus:ring-1 focus:ring-[#c9a84c]/50"
    />
  );
}

function StatusDot({ status }: { status: Contact["status"] }) {
  const map = {
    pendente: { color: "#c9a84c", label: "Pendente" },
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

