import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Phone, MessageCircle, SkipForward, RefreshCw, Bell, Check, X, Calendar, Copy, ListFilter, Pencil, RotateCcw, ChevronDown, Sliders } from "lucide-react";
import type { State, Me } from "@/lib/cloud-state";
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

  uniqueContactCountWhere,
} from "@/lib/dialer-shared";

// Paleta Fortal — navy profundo + dourado editorial + areia quente para respiro.
const T = {
  bg: "#fafbfc",
  surface: "#ffffff",
  soft: "#f3f6f9",
  line: "#e8ecf1",
  lineSoft: "#eef1f5",
  ink: "#101725",
  dim: "#64748b",
  mute: "#94a3b8",
  blue: "#3b82f6",
  blueDeep: "#1d4ed8",
  blueSoft: "#eff4ff",
  green: "#16a34a",
  greenSoft: "#ecfdf5",
  red: "#dc2626",
  redSoft: "#fef2f2",
  gold: "#b98a1e",
  grotesk: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
  sans: "'DM Sans', ui-sans-serif, system-ui, sans-serif",
};

export default function DiscadorTab({
  goFila,
  state,
  me,
}: {
  goFila?: () => void;
  state: State;
  me: Me | null;
}) {
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


  const { current, peekNext, advance, remove, incrementAttempt, pin, unpin, refresh, loading, error } =
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
  const [detailsOpen, setDetailsOpen] = useState(false);
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
    // Cada tentativa registrada conta como uma ligação (1ª e 2ª tentativa somam).
    const total = myCalls.length;
    const attended = uniqueContactCountWhere(myCalls, (c) => c.attended);
    return {
      total,
      attended,
      noAnswer: Math.max(0, myCalls.filter((c) => !c.attended).length),
      scheduled: uniqueContactCountWhere(myCalls, (c) => c.scheduled),
    };

  }, [state.calls, brokerId, today]);
  const meta = state.metaDaily || 50;
  const pct = Math.min(100, Math.round((k.total / Math.max(1, meta)) * 100));
  const reached = k.total >= meta;
  const attendRate = k.total > 0 ? Math.round((k.attended / k.total) * 100) : 0;

  type LastCallInfo = { createdAt: number; attended: boolean; scheduled: boolean; note: string | null };
  const [lastCall, setLastCall] = useState<LastCallInfo | null>(null);
  // Trava síncrona: o state `submitting` só atualiza no próximo render e não
  // impede dois toques muito rápidos (comum ao voltar do discador no celular).
  const outcomeInFlightRef = useRef(false);
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
    if (!current || submitting || outcomeInFlightRef.current) return;
    outcomeInFlightRef.current = true;
    setSubmitting(true);
    const submittedContact = current;
    const nextAttempt = (submittedContact.attempt_count ?? 0) + 1;
    const durationSeconds = dialStartRef.current ? Math.floor((Date.now() - dialStartRef.current) / 1000) : 0;
    incrementAttempt(submittedContact.id);
    try {
      const { data, error: rpcError } = await (supabase as any).rpc("record_call_outcome", {
        _contact_id: submittedContact.id,
        _attended: kind !== "no_answer",
        _scheduled: kind === "scheduled",
        _notes: note.trim() || null,
        _started_at: dialStartRef.current ? new Date(dialStartRef.current).toISOString() : null,
        _ended_at: dialStartRef.current ? new Date().toISOString() : null,
        _duration_seconds: durationSeconds,
      });
      if (rpcError) throw rpcError;
      void recordContactAttempt({
        contactId: submittedContact.id,
        userId: me?.userId ?? "",
        brokerId: brokerId,
        result: kind === "scheduled" ? "scheduled" : kind === "answered" ? "answered" : "no_answer",
        attemptNumber: nextAttempt,
        observation: note.trim() || null,
      });
      // "Não atendeu" na 1ª tentativa mantém o mesmo cliente na tela;
      // só avança após a 2ª tentativa (ou em atendeu/agendou).
      const stayOnContact = kind === "no_answer" && nextAttempt < 2;
      if (stayOnContact) {
        pin(submittedContact.id);
      } else {
        // O Realtime pode já ter removido o contato concluído enquanto o RPC
        // estava em andamento. Remover pelo ID é idempotente; usar advance()
        // aqui removia também o próximo cliente e causava o salto relatado.
        remove(submittedContact.id);
      }

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
      outcomeInFlightRef.current = false;
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
      ? { text: "Agendou", color: T.blueDeep }
      : lastCall.attended
      ? { text: "Atendeu", color: T.green }
      : { text: "Não atendeu", color: T.red }
    : null;

  const callSecFmt = `${String(Math.floor(callSeconds / 60)).padStart(2, "0")}:${String(callSeconds % 60).padStart(2, "0")}`;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8" style={{ fontFamily: T.sans, color: T.ink }}>

      {/* Linha de contexto: corretor, meta e lista — texto, não caixas */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em]" style={{ color: T.mute, fontFamily: T.grotesk }}>
              {brokerInitials} · {brokerName}
            </p>
            <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em]" style={{ fontFamily: T.grotesk }}>
              {k.total}<span style={{ color: T.mute, fontWeight: 500 }}> / {meta} ligações hoje</span>
            </h1>
          </div>
          <button
            type="button"
            onClick={() => { void loadLists(); setListsOpen((o) => !o); }}
            className="flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium transition-colors"
            style={{ border: `1px solid ${T.line}`, background: listsOpen ? T.blueSoft : T.surface, color: listsOpen ? T.blueDeep : T.dim }}
          >
            <ListFilter className="h-3.5 w-3.5" />
            <span className="max-w-[160px] truncate">{selectedList ?? "Todas as listas"}</span>
          </button>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: T.lineSoft }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: reached ? T.green : T.blue }}
          />
        </div>

        {listsOpen && (
          <div className="grid grid-cols-1 gap-1 rounded-2xl p-1.5 sm:grid-cols-2" style={{ background: T.surface, border: `1px solid ${T.line}` }}>
            <button
              onClick={() => { setSelectedList(null); setListsOpen(false); void refresh(); }}
              className="rounded-xl px-3 py-2.5 text-left text-sm"
              style={{ background: selectedList === null ? T.blueSoft : "transparent", color: selectedList === null ? T.blueDeep : T.ink }}
            >
              Todas as listas
              <span className="ml-2 text-xs tabular-nums" style={{ color: T.mute }}>
                {lists.reduce((a, l) => a + l.pending, 0)} pendentes
              </span>
            </button>
            {lists.map((l) => {
              const active = selectedList === l.list_name;
              return (
                <button
                  key={l.list_name}
                  onClick={() => { setSelectedList(l.list_name); setListsOpen(false); void refresh(); }}
                  className="truncate rounded-xl px-3 py-2.5 text-left text-sm"
                  style={{ background: active ? T.blueSoft : "transparent", color: active ? T.blueDeep : T.ink }}
                >
                  {l.list_name}
                  <span className="ml-2 text-xs tabular-nums" style={{ color: T.mute }}>{l.pending} pend.</span>
                </button>
              );
            })}
            {lists.length === 0 && <p className="px-3 py-2 text-sm" style={{ color: T.mute }}>Nenhuma lista encontrada.</p>}
          </div>
        )}
      </div>

      {otherDeviceCall && (
        <p className="flex items-center gap-2 text-[13px]" style={{ color: T.green }}>
          <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: T.green }} />
          Em ligação no {otherDeviceCall.device_label.toLowerCase()} · {otherDeviceCall.contact_name}
        </p>
      )}

      {/* Contato atual */}
      {!me ? (
        <p className="py-24 text-center text-sm" style={{ color: T.mute }}>Carregando fila…</p>
      ) : error ? (
        <div className="py-20 text-center">
          <p style={{ color: T.red }}>Erro ao carregar: {error}</p>
          <button
            onClick={() => refresh()}
            className="mt-4 rounded-full px-5 py-2.5 text-sm font-semibold"
            style={{ background: T.blue, color: "#fff", fontFamily: T.grotesk }}
          >
            Tentar novamente
          </button>
        </div>
      ) : !brokerId ? (
        <div className="py-20 text-center">
          <p className="text-2xl font-semibold tracking-[-0.02em]" style={{ fontFamily: T.grotesk }}>
            Não conseguimos carregar seu cadastro
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm" style={{ color: T.dim }}>
            Sua sessão pode ter expirado. Recarregue a página — sua fila continua salva.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-5 rounded-full px-5 py-2.5 text-sm font-semibold"
            style={{ background: T.blue, color: "#fff", fontFamily: T.grotesk }}
          >
            Recarregar
          </button>
        </div>
      ) : !current ? (
        <div className="py-20 text-center">
          <p className="text-2xl font-semibold tracking-[-0.02em]" style={{ fontFamily: T.grotesk }}>
            {selectedList ? "Esta lista não tem contatos pendentes" : "Nenhum contato pendente"}
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm" style={{ color: T.dim }}>
            {loading ? "Buscando novos leads…" : selectedList ? `A lista "${selectedList}" está sem pendentes para você.` : "Volte mais tarde ou importe uma lista nova."}
          </p>
          {!loading && selectedList && (
            <button
              onClick={() => { setSelectedList(null); void loadLists(); void refresh(); }}
              className="mt-5 rounded-full px-5 py-2.5 text-sm font-semibold"
              style={{ background: T.blue, color: "#fff", fontFamily: T.grotesk }}
            >
              Ver todas as listas
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="text-center">
            <span
              className="inline-block rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{ background: isLast ? T.redSoft : T.blueSoft, color: isLast ? T.red : T.blueDeep, fontFamily: T.grotesk }}
            >
              {attemptLabel(current.attempt_count) ?? "1ª tentativa"}
            </span>

            <h2
              className="mt-5 break-words text-[34px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[44px]"
              style={{ fontFamily: T.grotesk }}
            >
              {current.name}
            </h2>

            <div className="mt-2 inline-flex items-center gap-1.5">
              <p className="text-lg tabular-nums" style={{ color: T.dim }}>{current.phone || "(sem telefone)"}</p>
              {current.phone && (
                <button type="button" onClick={copyPhone} aria-label="Copiar telefone" className="rounded-full p-1.5" style={{ color: T.mute }}>
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {lastCall && lastResult && (
              <p className="mt-2 text-[12px]" style={{ color: T.mute }}>
                Última: {lastWhen} · <span style={{ color: lastResult.color, fontWeight: 600 }}>{lastResult.text}</span>
                {lastCall.note ? ` · "${lastCall.note}"` : ""}
              </p>
            )}
          </div>

          {/* Ação principal */}
          {!phoneValid ? (
            <div className="text-center">
              <p className="text-sm font-semibold" style={{ color: T.red }}>Telefone inválido</p>
              <button
                type="button"
                onClick={skip}
                className="mt-3 rounded-full px-6 py-3.5 text-sm font-semibold"
                style={{ background: T.ink, color: "#fff", fontFamily: T.grotesk }}
              >
                Pular contato
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <a
                href={dial}
                target="_top"
                onClick={startDial}
                className="flex w-full items-center justify-center gap-2.5 rounded-2xl py-5 text-[15px] font-semibold tracking-[0.02em] transition-all active:scale-[0.99]"
                style={{
                  background: dialing ? T.green : T.blue,
                  color: "#fff",
                  fontFamily: T.grotesk,
                  boxShadow: `0 14px 30px -14px ${dialing ? "rgba(22,163,74,0.6)" : "rgba(59,130,246,0.65)"}`,
                }}
              >
                <Phone className="h-5 w-5" strokeWidth={2.4} />
                {dialing ? `Em ligação · ${callSecFmt}` : "Ligar agora"}
              </a>
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-[13px] font-semibold"
                style={{ background: T.surface, border: `1px solid ${T.line}`, color: T.green, fontFamily: T.grotesk }}
              >
                <MessageCircle className="h-4 w-4" /> WhatsApp (Msg {waTemplate})
              </a>
            </div>
          )}

          {/* Desfecho */}
          <div className="grid grid-cols-3 gap-2">
            <button
              disabled={submitting}
              onClick={() => registerOutcome("no_answer")}
              className="flex flex-col items-center gap-1.5 rounded-2xl py-4 text-[12px] font-semibold disabled:opacity-50"
              style={{ background: T.surface, border: `1px solid ${T.line}`, color: T.red, fontFamily: T.grotesk }}
            >
              <X className="h-4 w-4" /> Não atendeu
            </button>
            <button
              disabled={submitting}
              onClick={() => registerOutcome("answered")}
              className="flex flex-col items-center gap-1.5 rounded-2xl py-4 text-[12px] font-semibold disabled:opacity-50"
              style={{ background: T.surface, border: `1px solid ${T.line}`, color: T.green, fontFamily: T.grotesk }}
            >
              <Check className="h-4 w-4" /> Atendeu
            </button>
            <button
              disabled={submitting}
              onClick={() => registerOutcome("scheduled")}
              className="flex flex-col items-center gap-1.5 rounded-2xl py-4 text-[12px] font-semibold disabled:opacity-50"
              style={{ background: T.blueSoft, border: `1px solid #dbe6ff`, color: T.blueDeep, fontFamily: T.grotesk }}
            >
              <Calendar className="h-4 w-4" /> Agendou
            </button>
          </div>

          {/* Tudo o resto fica escondido aqui */}
          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => setDetailsOpen((o) => !o)}
              className="mx-auto flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: T.mute, fontFamily: T.grotesk }}
            >
              <Sliders className="h-3.5 w-3.5" />
              {detailsOpen ? "Ocultar detalhes" : "Observação, mensagens e fila"}
              <ChevronDown className="h-3.5 w-3.5" style={{ transform: detailsOpen ? "rotate(180deg)" : "none" }} />
            </button>

            {detailsOpen && (
              <div className="flex flex-col gap-5 rounded-3xl p-5" style={{ background: T.surface, border: `1px solid ${T.line}` }}>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Observação sobre o lead (perfil, imóvel, próximo passo)..."
                  className="w-full resize-none rounded-2xl p-4 text-sm focus:outline-none"
                  style={{ background: T.soft, border: `1px solid ${T.line}`, minHeight: 84, color: T.ink, lineHeight: 1.55 }}
                />
                <div className="flex flex-wrap gap-2">
                  {["Sem interesse", "Investidor", "Primeiro imóvel", "Fora de área", "Preço alto", "Retornar"].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setNote((n) => (n ? `${n} · ${chip}` : chip))}
                      className="rounded-full px-3 py-1.5 text-[12px]"
                      style={{ background: T.soft, color: T.dim, border: `1px solid ${T.line}` }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex flex-1 rounded-full p-1" style={{ background: T.soft }}>
                    {([1, 2] as const).map((n) => (
                      <button
                        key={n}
                        onClick={() => setWaTemplate(n)}
                        className="flex-1 rounded-full py-1.5 text-[12px] font-semibold"
                        style={{ background: waTemplate === n ? T.surface : "transparent", color: waTemplate === n ? T.blueDeep : T.mute, fontFamily: T.grotesk }}
                      >
                        Msg {n}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setWaEditing((v) => !v)}
                    aria-label={`Editar mensagem ${waTemplate}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full"
                    style={{ background: waEditing ? T.blueSoft : T.soft, color: waEditing ? T.blueDeep : T.mute, border: `1px solid ${T.line}` }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>

                {waEditing && (
                  <div className="rounded-2xl p-3" style={{ background: T.soft, border: `1px solid ${T.line}` }}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: T.mute, fontFamily: T.grotesk }}>
                        Editando Msg {waTemplate}
                      </span>
                      <button
                        type="button"
                        onClick={() => setWaTexts((t) => ({ ...t, [waTemplate]: waTemplate === 1 ? DEFAULT_WA_TEMPLATE : DEFAULT_WA_TEMPLATE_2 }))}
                        className="flex items-center gap-1 text-[11px] uppercase tracking-widest"
                        style={{ color: T.mute }}
                      >
                        <RotateCcw className="h-3 w-3" /> Restaurar
                      </button>
                    </div>
                    <textarea
                      value={waTexts[waTemplate]}
                      onChange={(e) => setWaTexts((t) => ({ ...t, [waTemplate]: e.target.value }))}
                      className="w-full resize-none rounded-xl p-3 text-sm focus:outline-none"
                      style={{ background: T.surface, border: `1px solid ${T.line}`, minHeight: 76, color: T.ink }}
                    />
                    <p className="mt-2 text-[11px]" style={{ color: T.mute }}>
                      Use <span style={{ color: T.blueDeep }}>{"{nome}"}</span> para inserir o primeiro nome. Salvo neste aparelho.
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 border-t pt-4 text-[12px]" style={{ borderColor: T.lineSoft, color: T.dim }}>
                  <span className="min-w-0 truncate">
                    A seguir: {nextOne ? `${nextOne.name} · ${nextOne.phone || "sem telefone"}` : "fila vazia"}
                  </span>
                  {goFila && (
                    <button onClick={goFila} className="shrink-0 font-semibold" style={{ color: T.blueDeep }}>Ver fila</button>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: "Total", value: k.total, color: T.ink },
                    { label: "Atendeu", value: k.attended, color: T.green },
                    { label: "Não at.", value: k.noAnswer, color: T.red },
                    { label: "Agendou", value: k.scheduled, color: T.blueDeep },
                  ].map((s) => (
                    <div key={s.label}>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: T.mute, fontFamily: T.grotesk }}>{s.label}</p>
                      <p className="text-xl font-semibold tabular-nums" style={{ color: s.color, fontFamily: T.grotesk }}>{s.value}</p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-3 text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: T.mute, fontFamily: T.grotesk }}>
                  <button type="button" onClick={() => refresh()} className="flex items-center gap-1.5">
                    <RefreshCw className="h-3 w-3" /> Recarregar
                  </button>
                  <button type="button" onClick={skip} className="flex items-center gap-1.5">
                    <SkipForward className="h-3 w-3" /> Pular
                  </button>
                  <button type="button" onClick={() => toast.info("Abra o menu › Lembretes para agendar.")} className="flex items-center gap-1.5">
                    <Bell className="h-3 w-3" /> Lembrete
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
