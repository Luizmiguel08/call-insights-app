import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Phone, MessageCircle, SkipForward, RefreshCw, Bell, Check, X, Calendar, Copy, ListFilter, Pencil, RotateCcw } from "lucide-react";
import { useCloudState } from "@/lib/cloud-state";
import { supabase } from "@/integrations/supabase/client";
import { useContactBuffer, recordContactAttempt } from "@/hooks/useContactBuffer";
import { usePresencePublisher, useTeamPresence } from "@/hooks/useLivePresence";

import {
  attemptLabel,
  telHref,
  DEFAULT_WA_TEMPLATE,
  DEFAULT_WA_TEMPLATE_2,
  renderWaMessage,
  waHrefFromMessage,
  todayISO,
  uniqueContactCount,
  uniqueContactCountWhere,
} from "@/lib/dialer-shared";

// Paleta Fortal — navy profundo + dourado editorial + areia quente para respiro.
const T = {
  bg: "#0b0d13",
  bgSoft: "#10131c",
  surface: "#161a25",
  surface2: "#1d2231",
  line: "rgba(201,168,76,0.12)",
  lineSoft: "rgba(255,255,255,0.06)",
  gold: "#c9a84c",
  goldSoft: "#e2c46e",
  goldDim: "rgba(201,168,76,0.15)",
  sand: "#e8dcc0",
  text: "#f2ede1",
  textDim: "rgba(242,237,225,0.55)",
  textMute: "rgba(242,237,225,0.35)",
  green: "#6fbf7a",
  greenSoft: "rgba(111,191,122,0.15)",
  red: "#e07a7a",
  redSoft: "rgba(224,122,122,0.15)",
  sora: "'Sora', ui-sans-serif, system-ui, sans-serif",
  manrope: "'Manrope', ui-sans-serif, system-ui, sans-serif",
  fraunces: "'Fraunces', ui-serif, Georgia, serif",
};

export default function DiscadorTab({ goFila }: { goFila?: () => void }) {
  const { state, hydrated, me } = useCloudState();
  const brokerId = me?.brokerId ?? state.brokers[0]?.id ?? null;
  const brokerName = state.brokers.find((b) => b.id === brokerId)?.name ?? me?.brokerName ?? "Corretor";
  const brokerInitials = brokerName
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();

  type ListRow = { list_name: string; total: number; pending: number; done: number; skipped: number };
  const [lists, setLists] = useState<ListRow[]>([]);
  const [selectedList, setSelectedList] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("dialer:selected_list");
  });
  const [listsOpen, setListsOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedList) window.localStorage.setItem("dialer:selected_list", selectedList);
    else window.localStorage.removeItem("dialer:selected_list");
  }, [selectedList]);

  const loadLists = async () => {
    if (!brokerId) return;
    const { data, error: e } = await (supabase as any).rpc("broker_contact_lists", { _broker: brokerId });
    if (!e && data) setLists(data as ListRow[]);
  };
  useEffect(() => { void loadLists(); }, [brokerId]);

  // Se a lista salva no aparelho não existe mais, volta para "todas" em vez de mostrar fila vazia
  useEffect(() => {
    if (!selectedList || lists.length === 0) return;
    if (!lists.some((l) => l.list_name === selectedList)) setSelectedList(null);
  }, [lists, selectedList]);


  const { current, peekNext, advance, incrementAttempt, pin, unpin, refresh, loading, error } =
    useContactBuffer(brokerId, selectedList);


  // Presença ao vivo: espelha "estou ligando para X" entre celular e computador.
  const { publish, clear, deviceLabel: thisDevice } = usePresencePublisher();
  const { get: getPresence } = useTeamPresence();
  const myPresence = getPresence(brokerId);
  const otherDeviceCall =
    myPresence && myPresence.device_label !== thisDevice ? myPresence : null;

  // As listas dependem da fila: quando outro aparelho conclui contatos,
  // os contadores precisam acompanhar.
  useEffect(() => {
    if (!brokerId) return;
    const ch = supabase
      .channel(`lists-sync-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts_queue" }, () => {
        window.clearTimeout((window as any).__listsSyncT);
        (window as any).__listsSyncT = window.setTimeout(() => void loadLists(), 1200);
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [brokerId]);

  // Faxina leve: apaga "ligando agora" preso de aparelhos que fecharam de
  // forma abrupta, sessões abandonadas e lembretes vencidos. No máximo 1x a
  // cada 10 minutos por aparelho.
  useEffect(() => {
    if (!brokerId) return;
    const KEY = "dialer.housekeeping.at";
    const last = Number(localStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 10 * 60 * 1000) return;
    localStorage.setItem(KEY, String(Date.now()));
    void (supabase as any).rpc("dialer_housekeeping");
  }, [brokerId]);





  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [waTemplate, setWaTemplate] = useState<1 | 2>(1);
  const [waEditing, setWaEditing] = useState(false);
  const [waTexts, setWaTexts] = useState<{ 1: string; 2: string }>(() => {
    if (typeof window === "undefined") return { 1: DEFAULT_WA_TEMPLATE, 2: DEFAULT_WA_TEMPLATE_2 };
    return {
      1: window.localStorage.getItem("dialer:wa_msg_1") || DEFAULT_WA_TEMPLATE,
      2: window.localStorage.getItem("dialer:wa_msg_2") || DEFAULT_WA_TEMPLATE_2,
    };
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("dialer:wa_msg_1", waTexts[1]);
    window.localStorage.setItem("dialer:wa_msg_2", waTexts[2]);
  }, [waTexts]);
  const [dialing, setDialing] = useState(false);
  const dialStartRef = useRef<number | null>(null);
  const [callSeconds, setCallSeconds] = useState(0);

  useEffect(() => { setNote(""); setDialing(false); dialStartRef.current = null; setCallSeconds(0); }, [current?.id]);

  useEffect(() => {
    if (!dialing) return;
    const id = window.setInterval(() => {
      if (dialStartRef.current) setCallSeconds(Math.floor((Date.now() - dialStartRef.current) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [dialing]);

  const today = todayISO();
  const k = useMemo(() => {
    const myCalls = state.calls.filter((c) => c.brokerId === brokerId && c.date === today);
    // Mesma contagem do Painel: contatos únicos, não tentativas.
    const total = uniqueContactCount(myCalls);
    const attended = uniqueContactCountWhere(myCalls, (c) => c.attended);
    return {
      total,
      attended,
      noAnswer: Math.max(0, total - attended),
      scheduled: uniqueContactCountWhere(myCalls, (c) => c.scheduled),
    };
  }, [state.calls, brokerId, today]);
  const meta = state.metaDaily || 50;
  const pct = Math.min(100, Math.round((k.total / Math.max(1, meta)) * 100));
  const reached = k.total >= meta;
  const attendRate = k.total > 0 ? Math.round((k.attended / k.total) * 100) : 0;

  type LastCallInfo = { createdAt: number; attended: boolean; scheduled: boolean; note: string | null };
  const [lastCall, setLastCall] = useState<LastCallInfo | null>(null);
  useEffect(() => {
    if (!current || current.attempt_count < 1) { setLastCall(null); return; }
    const local = state.calls
      .filter((c) => c.contactId === current.id)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (local) {
      setLastCall({ createdAt: local.createdAt, attended: local.attended, scheduled: local.scheduled, note: local.note || null });
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("calls")
        .select("created_at, attended, scheduled, notes")
        .eq("contact_id", current.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || !data) return;
      setLastCall({
        createdAt: new Date(data.created_at as string).getTime(),
        attended: !!data.attended,
        scheduled: !!data.scheduled,
        note: (data.notes as string | null) ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [current?.id, current?.attempt_count, state.calls]);

  const next3 = peekNext(3);
  const nextOne = next3[0] ?? null;

  async function registerOutcome(kind: "no_answer" | "answered" | "scheduled") {
    if (!current || submitting) return;
    setSubmitting(true);
    const nextAttempt = (current.attempt_count ?? 0) + 1;
    const durationSeconds = dialStartRef.current ? Math.floor((Date.now() - dialStartRef.current) / 1000) : 0;
    incrementAttempt(current.id);
    try {
      const { data, error: rpcError } = await (supabase as any).rpc("record_call_outcome", {
        _contact_id: current.id,
        _attended: kind !== "no_answer",
        _scheduled: kind === "scheduled",
        _notes: note.trim() || null,
        _started_at: dialStartRef.current ? new Date(dialStartRef.current).toISOString() : null,
        _ended_at: dialStartRef.current ? new Date().toISOString() : null,
        _duration_seconds: durationSeconds,
      });
      if (rpcError) throw rpcError;
      void recordContactAttempt({
        contactId: current.id,
        userId: me?.userId ?? "",
        brokerId: brokerId,
        result: kind === "scheduled" ? "scheduled" : kind === "answered" ? "answered" : "no_answer",
        attemptNumber: nextAttempt,
        observation: note.trim() || null,
      });
      // "Não atendeu" na 1ª tentativa mantém o mesmo cliente na tela;
      // só avança após a 2ª tentativa (ou em atendeu/agendou).
      const stayOnContact = kind === "no_answer" && nextAttempt < 2;
      if (stayOnContact) pin(current.id);
      else advance();

      setNote("");
      setDialing(false);
      dialStartRef.current = null;
      setCallSeconds(0);
      void clear();
      toast.success(
        kind === "scheduled"
          ? "Agendou!"
          : kind === "answered"
            ? "Registrado"
            : stayOnContact
              ? "1ª tentativa registrada — ligue de novo"
              : "Sem atendimento — registrado",
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao registrar");
      void refresh();
    } finally {
      setSubmitting(false);
    }
  }

  function skip() { if (current) { unpin(); void clear(); advance(); } }

  function startDial() {
    if (!current?.phone) return;
    // Trava o contato no topo da fila: sair do app para discar (iOS/Android)
    // dispara um recarregamento, e sem o pin outro cliente tomaria a tela.
    pin(current.id);
    dialStartRef.current = Date.now();
    setDialing(true);
    setCallSeconds(0);
    void publish({ id: current.id, name: current.name, phone: current.phone });
  }



  function copyPhone() {
    if (!current?.phone) return;
    navigator.clipboard?.writeText(current.phone).then(
      () => toast.success("Telefone copiado"),
      () => toast.error("Não foi possível copiar")
    );
  }

  const waMsg = current ? renderWaMessage(waTexts[waTemplate], current.name) : "";
  const wa = current ? waHrefFromMessage(current.phone, waMsg) : "#";
  const dial = current ? telHref(current.phone) : "#";
  // Contato sem telefone discável: nunca oferecer um botão de ligar quebrado.
  const phoneValid = !!current && (current.phone ?? "").replace(/\D/g, "").length >= 10;


  const isLast = (current?.attempt_count ?? 0) >= 1;
  const lastWhen = lastCall
    ? new Date(lastCall.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;
  const lastResult = lastCall
    ? lastCall.attended && lastCall.scheduled
      ? { text: "Agendou", color: T.gold }
      : lastCall.attended
      ? { text: "Atendeu", color: T.green }
      : { text: "Não atendeu", color: T.red }
    : null;

  const callSecFmt = `${String(Math.floor(callSeconds / 60)).padStart(2, "0")}:${String(callSeconds % 60).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-5" style={{ fontFamily: T.manrope, color: T.text }}>
      {/* List selector */}
      <div className="rounded-3xl p-4 sm:p-5" style={{ background: T.surface, border: `1px solid ${T.line}` }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: T.goldDim, color: T.gold, border: `1px solid ${T.gold}` }}>
              <ListFilter className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em]" style={{ color: T.textMute, fontFamily: T.sora }}>Lista ativa</p>
              <p className="text-sm font-semibold truncate" style={{ color: T.sand, fontFamily: T.sora }}>
                {selectedList ?? "Todas as listas"}
                {selectedList && (() => {
                  const info = lists.find((l) => l.list_name === selectedList);
                  return info ? <span className="ml-2 text-[11px] tabular-nums" style={{ color: T.textDim }}>({info.pending} pendentes · {info.total} total)</span> : null;
                })()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void loadLists(); setListsOpen((o) => !o); }}
              className="px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-[0.18em] transition-all"
              style={{ background: listsOpen ? T.gold : T.bgSoft, color: listsOpen ? T.bg : T.gold, border: `1px solid ${T.gold}`, fontFamily: T.sora }}
            >
              {listsOpen ? "Fechar" : "Trocar lista"}
            </button>
          </div>
        </div>
        {listsOpen && (
          <div className="mt-4 pt-4 grid grid-cols-2 sm:grid-cols-3 gap-2" style={{ borderTop: `1px solid ${T.lineSoft}` }}>
            <button
              onClick={() => { setSelectedList(null); setListsOpen(false); void refresh(); }}
              className="text-left p-3 rounded-xl transition-all"
              style={{
                background: selectedList === null ? T.goldDim : T.bgSoft,
                border: `1px solid ${selectedList === null ? T.gold : T.lineSoft}`,
                color: T.text,
              }}
            >
              <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: selectedList === null ? T.gold : T.textMute, fontFamily: T.sora }}>Todas</p>
              <p className="text-sm font-semibold mt-0.5" style={{ color: T.sand }}>Fila completa</p>
              <p className="text-[11px] mt-1 tabular-nums" style={{ color: T.textDim }}>
                {lists.reduce((a, l) => a + l.pending, 0)} pendentes
              </p>
            </button>
            {lists.length === 0 && (
              <p className="col-span-full text-xs" style={{ color: T.textDim }}>Nenhuma lista encontrada.</p>
            )}
            {lists.map((l) => {
              const active = selectedList === l.list_name;
              return (
                <button
                  key={l.list_name}
                  onClick={() => { setSelectedList(l.list_name); setListsOpen(false); void refresh(); }}
                  className="text-left p-3 rounded-xl transition-all"
                  style={{
                    background: active ? T.goldDim : T.bgSoft,
                    border: `1px solid ${active ? T.gold : T.lineSoft}`,
                  }}
                >
                  <p className="text-[10px] uppercase tracking-widest font-bold truncate" style={{ color: active ? T.gold : T.textMute, fontFamily: T.sora }}>
                    {l.list_name}
                  </p>
                  <p className="text-[11px] mt-1 tabular-nums" style={{ color: T.textDim }}>
                    {l.pending} pend. · {l.done} feitas · {l.total} total
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Espelho ao vivo: ligação em andamento em outro aparelho */}
      {otherDeviceCall && (
        <div
          className="flex items-center gap-3 rounded-2xl px-4 py-3"
          style={{ background: T.greenSoft, border: `1px solid rgba(111,191,122,0.3)` }}
        >
          <span className="h-2.5 w-2.5 rounded-full animate-pulse" style={{ background: T.green }} />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: T.green, fontFamily: T.sora }}>
              Em ligação no {otherDeviceCall.device_label.toLowerCase()}
            </p>
            <p className="truncate text-sm" style={{ color: T.sand }}>
              {otherDeviceCall.contact_name}
              {otherDeviceCall.phone ? ` · ${otherDeviceCall.phone}` : ""}
            </p>
          </div>
        </div>
      )}

      {/* Bento */}

      <div className="grid grid-cols-12 gap-5 items-start">

        {/* Left col */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-5">
          {/* Corretor + meta */}
          <div className="p-6 rounded-3xl" style={{ background: T.surface, border: `1px solid ${T.line}` }}>
            <div className="flex items-center gap-4 mb-6">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center font-bold text-lg shrink-0"
                style={{ background: T.goldDim, color: T.gold, fontFamily: T.sora, border: `1px solid ${T.gold}` }}
              >
                {brokerInitials}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em]" style={{ color: T.textMute }}>Corretor</p>
                <h3 className="text-lg font-semibold truncate" style={{ fontFamily: T.sora, letterSpacing: "-0.01em", color: T.sand }}>
                  {brokerName}
                </h3>
              </div>
            </div>
            <div className="space-y-2.5">
              <div className="flex justify-between items-baseline text-sm">
                <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: T.textMute }}>Meta diária</span>
                <span className="font-bold tabular-nums text-lg" style={{ fontFamily: T.sora, color: reached ? T.green : T.gold }}>
                  {k.total}<span style={{ color: T.textMute, fontSize: 13 }}>/{meta}</span>
                </span>
              </div>
              <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: reached ? T.green : `linear-gradient(90deg, ${T.gold}, ${T.goldSoft})` }}
                />
              </div>
              <div className="flex justify-between text-[10px] uppercase tracking-[0.2em]" style={{ color: T.textMute }}>
                <span>{pct}% concluído</span>
                <span>Taxa atend. {attendRate}%</span>
              </div>
            </div>
          </div>

          {/* A seguir */}
          <div className="p-6 rounded-3xl" style={{ background: T.bgSoft, border: `1px dashed ${T.line}` }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em]" style={{ color: T.textMute }}>A seguir</p>
              {goFila && (
                <button
                  onClick={goFila}
                  className="text-[10px] uppercase tracking-widest transition-colors hover:text-white"
                  style={{ color: T.gold, fontFamily: T.sora }}
                >
                  Ver fila
                </button>
              )}
            </div>
            {nextOne ? (
              <div className="flex justify-between items-center gap-3">
                <div className="min-w-0">
                  <h4 className="font-semibold truncate" style={{ color: T.sand, fontFamily: T.sora }}>{nextOne.name}</h4>
                  <p className="text-sm truncate tabular-nums" style={{ color: T.textDim }}>{nextOne.phone || "(sem telefone)"}</p>
                </div>
                <span
                  className="text-[10px] px-2.5 py-1 rounded-full shrink-0 uppercase tracking-wider"
                  style={{ background: T.goldDim, color: T.gold, fontFamily: T.sora, fontWeight: 600 }}
                >
                  {nextOne.attempt_count >= 1 ? "2ª" : "1ª"}
                </span>
              </div>
            ) : (
              <p className="text-sm" style={{ color: T.textDim }}>Fila vazia por enquanto.</p>
            )}
            {next3.length > 1 && (
              <div className="mt-4 pt-4 space-y-2" style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                {next3.slice(1).map((c) => (
                  <div key={c.id} className="flex justify-between text-xs" style={{ color: T.textDim }}>
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 ml-3 tabular-nums">{c.phone}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* KPIs de hoje */}
          <div className="grid grid-cols-4 gap-0 rounded-3xl overflow-hidden" style={{ background: T.surface, border: `1px solid ${T.line}` }}>
            {[
              { label: "Total", value: k.total, color: T.sand },
              { label: "Atend.", value: k.attended, color: T.green },
              { label: "N.At.", value: k.noAnswer, color: T.red },
              { label: "Agend.", value: k.scheduled, color: T.gold },
            ].map((s, i) => (
              <div key={s.label} className="text-center py-4" style={{ borderLeft: i === 0 ? "none" : `1px solid ${T.lineSoft}` }}>
                <p className="text-[9px] font-bold uppercase tracking-[0.2em] mb-1" style={{ color: T.textMute, fontFamily: T.sora }}>{s.label}</p>
                <p className="text-xl font-semibold tabular-nums" style={{ fontFamily: T.sora, color: s.color }}>
                  {String(s.value).padStart(2, "0")}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Center: Dialer */}
        <div className="col-span-12 lg:col-span-8">
          <div
            className="p-6 sm:p-8 rounded-3xl relative overflow-hidden"
            style={{
              background: `linear-gradient(180deg, ${T.surface} 0%, ${T.bgSoft} 100%)`,
              border: `1px solid ${T.line}`,
            }}
          >
            <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${T.gold}, transparent)`, opacity: 0.4 }} />

            {!hydrated ? (
              <div className="py-20 text-center" style={{ color: T.textDim }}>Carregando fila…</div>
            ) : error ? (
              <div className="py-16 text-center">
                <p style={{ color: T.red }}>Erro ao carregar: {error}</p>
                <button
                  onClick={() => refresh()}
                  className="mt-4 px-5 py-2.5 rounded-full text-sm font-semibold uppercase tracking-wider"
                  style={{ background: T.gold, color: T.bg, fontFamily: T.sora }}
                >
                  Tentar novamente
                </button>
              </div>
            ) : !current ? (
              <div className="py-16 text-center">
                <p style={{ color: T.sand, fontFamily: T.fraunces, fontSize: 24, letterSpacing: "-0.02em" }}>
                  {selectedList ? "Esta lista não tem contatos pendentes" : "Nenhum contato pendente"}
                </p>
                <p className="mt-2 text-sm" style={{ color: T.textDim }}>
                  {loading
                    ? "Buscando novos leads…"
                    : selectedList
                      ? `A lista "${selectedList}" está sem pendentes para você. Veja as outras listas.`
                      : "Volte mais tarde ou importe uma lista nova."}
                </p>
                {!loading && selectedList && (
                  <button
                    onClick={() => { setSelectedList(null); void loadLists(); void refresh(); }}
                    className="mt-4 px-5 py-2.5 rounded-full text-sm font-semibold uppercase tracking-wider"
                    style={{ background: T.gold, color: T.bg, fontFamily: T.sora }}
                  >
                    Ver todas as listas
                  </button>
                )}
              </div>

            ) : (
              <>
                {/* Top badge + last call */}
                <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                  <span
                    className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.2em]"
                    style={{
                      background: isLast ? T.redSoft : T.goldDim,
                      color: isLast ? T.red : T.gold,
                      border: `1px solid ${isLast ? "rgba(224,122,122,0.25)" : "rgba(201,168,76,0.25)"}`,
                      fontFamily: T.sora,
                    }}
                  >
                    {attemptLabel(current.attempt_count) ?? "1ª tentativa"}
                  </span>
                  {lastCall && lastResult && (
                    <p className="text-xs flex items-center gap-2" style={{ color: T.textDim }}>
                      <span>Última: {lastWhen}</span>
                      <span style={{ opacity: 0.4 }}>•</span>
                      <span style={{ color: lastResult.color, fontWeight: 700 }}>{lastResult.text}</span>
                      {lastCall.note && (
                        <>
                          <span style={{ opacity: 0.4 }}>•</span>
                          <span className="truncate max-w-[180px] italic" style={{ color: T.textMute }}>"{lastCall.note}"</span>
                        </>
                      )}
                    </p>
                  )}
                </div>

                {/* Contact identity */}
                <div className="text-center mb-8">
                  <h2
                    className="text-4xl sm:text-5xl font-medium mb-2 break-words"
                    style={{ fontFamily: T.fraunces, letterSpacing: "-0.02em", color: T.sand, lineHeight: 1.05 }}
                  >
                    {current.name}
                  </h2>
                  <div className="inline-flex items-center gap-2">
                    <p className="text-lg tabular-nums" style={{ color: T.textDim, fontFamily: T.sora }}>
                      {current.phone || "(sem telefone)"}
                    </p>
                    {current.phone && (
                      <button
                        type="button"
                        onClick={copyPhone}
                        className="p-1.5 rounded-full transition-colors hover:bg-white/5"
                        style={{ color: T.textMute }}
                        aria-label="Copiar telefone"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {dialing && (
                    <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full" style={{ background: T.greenSoft, border: `1px solid rgba(111,191,122,0.25)` }}>
                      <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: T.green }} />
                      <span className="text-[11px] uppercase tracking-widest tabular-nums" style={{ color: T.green, fontFamily: T.sora, fontWeight: 600 }}>
                        Em ligação · {callSecFmt}
                      </span>
                    </div>
                  )}
                </div>

                {/* Round dial button */}
                <div className="flex flex-col items-center gap-5 mb-8">
                  {!phoneValid ? (
                    <>
                      <div
                        className="flex items-center justify-center rounded-full"
                        style={{ width: 140, height: 140, background: T.bgSoft, border: `1px dashed ${T.line}` }}
                      >
                        <Phone className="w-12 h-12" style={{ color: T.textMute }} strokeWidth={2} />
                      </div>
                      <div className="text-center">
                        <p className="text-[11px] uppercase tracking-[0.28em] font-bold" style={{ color: T.red, fontFamily: T.sora }}>Telefone inválido</p>
                        <p className="text-[10px] mt-1" style={{ color: T.textMute }}>Este contato não tem número discável</p>
                      </div>
                      <button
                        type="button"
                        onClick={skip}
                        className="rounded-full px-6 py-3 text-[12px] uppercase tracking-[0.2em] font-bold transition active:scale-95"
                        style={{ background: T.gold, color: T.bg, fontFamily: T.sora }}
                      >
                        Pular contato
                      </button>
                    </>
                  ) : (
                    <>
                      <a
                        href={dial}
                        target="_top"
                        onClick={startDial}
                        className="group relative flex items-center justify-center rounded-full transition-all active:scale-95"
                        style={{
                          width: 140,
                          height: 140,
                          background: `radial-gradient(circle at 30% 30%, ${T.goldSoft}, ${T.gold} 60%, #a68a3a 100%)`,
                          boxShadow: `0 0 0 8px ${T.goldDim}, 0 20px 60px -20px rgba(201,168,76,0.6), inset 0 -6px 20px rgba(0,0,0,0.25)`,
                        }}
                        aria-label="Ligar agora"
                      >
                        <span className="absolute inset-0 rounded-full animate-ping opacity-30" style={{ background: T.gold, animationDuration: "2.4s" }} />
                        <Phone className="w-12 h-12 relative z-10" style={{ color: T.bg }} strokeWidth={2.4} />
                      </a>
                      <div className="text-center">
                        <p className="text-[11px] uppercase tracking-[0.28em] font-bold" style={{ color: T.gold, fontFamily: T.sora }}>Ligar agora</p>
                        <p className="text-[10px] mt-1" style={{ color: T.textMute }}>Toque para discar no seu aparelho</p>
                      </div>
                    </>
                  )}


                  {/* WA templates */}
                  <div className="w-full max-w-md mt-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 flex rounded-full p-1" style={{ background: T.bgSoft, border: `1px solid ${T.lineSoft}` }}>
                        {([1, 2] as const).map((n) => (
                          <button
                            key={n}
                            onClick={() => setWaTemplate(n)}
                            className="flex-1 py-1.5 text-[10px] uppercase tracking-widest rounded-full transition-all"
                            style={{
                              background: waTemplate === n ? T.surface2 : "transparent",
                              color: waTemplate === n ? T.gold : T.textMute,
                              fontFamily: T.sora, fontWeight: 600,
                            }}
                          >
                            Msg {n}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setWaEditing((v) => !v)}
                        title={`Editar mensagem ${waTemplate}`}
                        aria-label={`Editar mensagem ${waTemplate}`}
                        className="flex items-center justify-center rounded-full transition-all active:scale-95"
                        style={{
                          width: 38, height: 38,
                          background: waEditing ? T.goldDim : T.bgSoft,
                          border: `1px solid ${waEditing ? T.gold : T.lineSoft}`,
                          color: waEditing ? T.gold : T.textMute,
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <a
                        href={wa}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 py-2.5 px-4 rounded-full text-xs font-semibold uppercase tracking-widest transition-all active:scale-95"
                        style={{ background: T.greenSoft, color: T.green, border: `1px solid rgba(111,191,122,0.3)`, fontFamily: T.sora }}
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        WhatsApp
                      </a>
                    </div>

                    {waEditing && (
                      <div className="mt-3 p-3 rounded-2xl text-left" style={{ background: T.bgSoft, border: `1px solid ${T.lineSoft}` }}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[10px] uppercase tracking-widest" style={{ color: T.textMute, fontFamily: T.sora, fontWeight: 600 }}>
                            Editando Msg {waTemplate}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setWaTexts((t) => ({ ...t, [waTemplate]: waTemplate === 1 ? DEFAULT_WA_TEMPLATE : DEFAULT_WA_TEMPLATE_2 }))
                            }
                            className="flex items-center gap-1 text-[10px] uppercase tracking-widest"
                            style={{ color: T.textMute, fontFamily: T.sora }}
                          >
                            <RotateCcw className="w-3 h-3" /> Restaurar
                          </button>
                        </div>
                        <textarea
                          value={waTexts[waTemplate]}
                          onChange={(e) => setWaTexts((t) => ({ ...t, [waTemplate]: e.target.value }))}
                          className="w-full p-3 rounded-xl text-sm resize-none focus:outline-none focus:ring-1"
                          style={{
                            background: T.surface,
                            border: `1px solid ${T.lineSoft}`,
                            minHeight: 80,
                            color: T.text,
                            lineHeight: 1.5,
                            // @ts-expect-error css var
                            "--tw-ring-color": T.gold,
                          }}
                        />
                        <p className="mt-2 text-[10px]" style={{ color: T.textMute }}>
                          Use <span style={{ color: T.gold }}>{"{nome}"}</span> para inserir o primeiro nome do cliente. Salvo automaticamente neste aparelho.
                        </p>
                        <p className="mt-2 text-[11px] italic" style={{ color: T.textDim }}>
                          Prévia: {waMsg || renderWaMessage(waTexts[waTemplate], "Cliente")}
                        </p>
                      </div>
                    )}
                  </div>

                </div>

                {/* Notes + chips + outcomes */}
                <div className="pt-6" style={{ borderTop: `1px solid ${T.lineSoft}` }}>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Observação sobre o lead (perfil, imóvel, próximo passo)..."
                    className="w-full p-4 rounded-2xl text-sm resize-none focus:outline-none focus:ring-1 mb-4 transition-all"
                    style={{
                      background: T.bgSoft,
                      border: `1px solid ${T.lineSoft}`,
                      minHeight: 90,
                      color: T.text,
                      lineHeight: 1.55,
                      // @ts-expect-error css var
                      "--tw-ring-color": T.gold,
                    }}
                  />

                  <div className="flex flex-wrap gap-2 mb-6">
                    {["Sem interesse", "Investidor", "Primeiro imóvel", "Fora de área", "Preço alto", "Retornar"].map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setNote((n) => (n ? `${n} · ${chip}` : chip))}
                        className="px-3.5 py-1.5 rounded-full text-[11px] font-medium transition-all hover:bg-white/5"
                        style={{ background: T.bgSoft, color: T.textDim, border: `1px solid ${T.lineSoft}`, fontFamily: T.sora, letterSpacing: "0.02em" }}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2.5 mb-4">
                    <button
                      disabled={submitting}
                      onClick={() => registerOutcome("no_answer")}
                      className="py-3.5 rounded-2xl text-[11px] font-bold uppercase tracking-[0.15em] transition-all active:scale-95 disabled:opacity-60 flex flex-col items-center gap-1"
                      style={{ background: T.redSoft, color: T.red, border: `1px solid rgba(224,122,122,0.25)`, fontFamily: T.sora }}
                    >
                      <X className="w-4 h-4" />
                      Não atendeu
                    </button>
                    <button
                      disabled={submitting}
                      onClick={() => registerOutcome("answered")}
                      className="py-3.5 rounded-2xl text-[11px] font-bold uppercase tracking-[0.15em] transition-all active:scale-95 disabled:opacity-60 flex flex-col items-center gap-1"
                      style={{ background: T.gold, color: T.bg, fontFamily: T.sora, boxShadow: `0 8px 24px -12px rgba(201,168,76,0.5)` }}
                    >
                      <Check className="w-4 h-4" />
                      Atendeu
                    </button>
                    <button
                      disabled={submitting}
                      onClick={() => registerOutcome("scheduled")}
                      className="py-3.5 rounded-2xl text-[11px] font-bold uppercase tracking-[0.15em] transition-all active:scale-95 disabled:opacity-60 flex flex-col items-center gap-1"
                      style={{ background: T.greenSoft, color: T.green, border: `1px solid rgba(111,191,122,0.25)`, fontFamily: T.sora }}
                    >
                      <Calendar className="w-4 h-4" />
                      Agendou
                    </button>
                  </div>

                  <div className="flex justify-between items-center flex-wrap gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => refresh()}
                      className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors hover:text-white"
                      style={{ color: T.textMute, fontFamily: T.sora }}
                    >
                      <RefreshCw className="w-3 h-3" /> Recarregar
                    </button>
                    <button
                      type="button"
                      onClick={skip}
                      className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors hover:text-white"
                      style={{ color: T.textMute, fontFamily: T.sora }}
                    >
                      <SkipForward className="w-3 h-3" /> Pular
                    </button>
                    <button
                      type="button"
                      onClick={() => toast.info("Abra a aba Lembretes para agendar.")}
                      className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em]"
                      style={{ color: T.gold, fontFamily: T.sora }}
                    >
                      <Bell className="w-3 h-3" /> Agendar lembrete
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
