import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useCloudState } from "@/lib/cloud-state";
import { supabase } from "@/integrations/supabase/client";
import { useContactBuffer, recordContactAttempt } from "@/hooks/useContactBuffer";
import {
  attemptLabel,
  telHref,
  DEFAULT_WA_TEMPLATE,
  DEFAULT_WA_TEMPLATE_2,
  renderWaMessage,
  waHrefFromMessage,
  todayISO,
} from "@/lib/dialer-shared";

export const Route = createFileRoute("/_authenticated/redesign")({
  head: () => ({
    meta: [
      { title: "FORTAL — Novo Discador (preview)" },
      { name: "description", content: "Preview do novo design do discador FORTAL — Soft Bento." },
    ],
  }),
  component: RedesignPreview,
});

// Paleta Warm Sand + tipografia Sora/Manrope — locked design tokens.
const T = {
  bg: "#faf8f5",
  surface: "#f0ebe3",
  surface2: "#ffffff",
  muted: "#c9b99a",
  accent: "#8b7355",
  accentDark: "#725e46",
  text: "#2b2622",
  textDim: "#6b6157",
  border: "rgba(43,38,34,0.06)",
  borderStrong: "rgba(43,38,34,0.10)",
  sora: "'Sora', ui-sans-serif, system-ui, sans-serif",
  manrope: "'Manrope', ui-sans-serif, system-ui, sans-serif",
};

type Tab = "discador" | "fila" | "lembretes" | "rapido" | "historico" | "painel" | "equipe" | "erros";
const TABS: { key: Tab; label: string }[] = [
  { key: "discador", label: "Discador" },
  { key: "fila", label: "Fila" },
  { key: "lembretes", label: "Lembretes" },
  { key: "rapido", label: "Rápido" },
  { key: "historico", label: "Histórico" },
  { key: "painel", label: "Painel" },
  { key: "equipe", label: "Equipe" },
  { key: "erros", label: "Erros" },
];

function RedesignPreview() {
  const { state, hydrated, me } = useCloudState();
  const brokerId = me?.brokerId ?? state.brokers[0]?.id ?? null;
  const brokerName = state.brokers.find((b) => b.id === brokerId)?.name ?? me?.brokerName ?? "Corretor";
  const brokerInitials = brokerName
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();

  const { current, peekNext, advance, incrementAttempt, refresh, loading, error } =
    useContactBuffer(brokerId, null);

  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => { setNote(""); }, [current?.id]);

  // KPIs de hoje (a partir do cache local, escopado ao corretor)
  const today = todayISO();
  const k = useMemo(() => {
    const myCalls = state.calls.filter((c) => c.brokerId === brokerId && c.date === today);
    return {
      total: myCalls.length,
      attended: myCalls.filter((c) => c.attended).length,
      noAnswer: myCalls.filter((c) => !c.attended).length,
      scheduled: myCalls.filter((c) => c.scheduled).length,
    };
  }, [state.calls, brokerId, today]);
  const meta = state.metaDaily || 50;
  const pct = Math.min(100, Math.round((k.total / Math.max(1, meta)) * 100));
  const reached = k.total >= meta;

  // Última ligação para o contato atual (fallback via DB)
  type LastCallInfo = { createdAt: number; attended: boolean; scheduled: boolean; note: string | null };
  const [lastCall, setLastCall] = useState<LastCallInfo | null>(null);
  useEffect(() => {
    if (!current || current.attempt_count < 1) { setLastCall(null); return; }
    const local = state.calls
      .filter((c) => c.contactId === current.id)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (local) {
      setLastCall({
        createdAt: local.createdAt,
        attended: local.attended,
        scheduled: local.scheduled,
        note: local.note || null,
      });
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

  const [tab, setTab] = useState<Tab>("discador");

  // Registrar resultado (usa o mesmo RPC do discador atual)
  async function registerOutcome(kind: "no_answer" | "answered" | "scheduled") {
    if (!current || submitting) return;
    setSubmitting(true);
    const nextAttempt = (current.attempt_count ?? 0) + 1;
    incrementAttempt(current.id);
    try {
      const { data, error: rpcError } = await (supabase as any).rpc("record_call_outcome", {
        _contact_id: current.id,
        _attended: kind !== "no_answer",
        _scheduled: kind === "scheduled",
        _notes: note.trim() || null,
        _started_at: null,
        _ended_at: null,
        _duration_seconds: 0,
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
      const done = (data as any)?.inserted !== false || nextAttempt >= 2 || kind !== "no_answer";
      if (done) advance();
      setNote("");
      toast.success(
        kind === "scheduled" ? "Agendou!" : kind === "answered" ? "Registrado" : "Sem atendimento — registrado"
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao registrar");
      void refresh();
    } finally {
      setSubmitting(false);
    }
  }

  function skip() { if (current) advance(); }

  const wa1 = current ? waHrefFromMessage(current.phone, renderWaMessage(DEFAULT_WA_TEMPLATE, current.name)) : "#";
  const wa2 = current ? waHrefFromMessage(current.phone, renderWaMessage(DEFAULT_WA_TEMPLATE_2, current.name)) : "#";
  const dial = current ? telHref(current.phone) : "#";

  const isLast = (current?.attempt_count ?? 0) >= 1;
  const lastWhen = lastCall
    ? new Date(lastCall.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;
  const lastResult = lastCall
    ? lastCall.attended && lastCall.scheduled
      ? { text: "Agendou", color: "#4a7a4e" }
      : lastCall.attended
      ? { text: "Atendeu", color: "#4a7a4e" }
      : { text: "Não atendeu", color: "#9b4a4a" }
    : null;

  return (
    <div
      className="min-h-screen w-full p-4 sm:p-6"
      style={{ background: T.bg, color: T.text, fontFamily: T.manrope }}
    >
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        {/* Preview banner */}
        <div
          className="flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5"
          style={{ background: T.surface, border: `1px solid ${T.border}`, fontSize: 12 }}
        >
          <span style={{ color: T.textDim }}>
            <strong style={{ color: T.text }}>Preview</strong> — visual novo. A tela atual continua em{" "}
            <Link to="/" style={{ color: T.accent, textDecoration: "underline" }}>/</Link>.
          </span>
          <span style={{ color: T.textDim, fontFamily: T.sora, letterSpacing: "-0.02em" }}>Soft Bento · Warm Sand</span>
        </div>

        {/* Nav */}
        <nav
          className="flex items-center justify-center rounded-[24px] p-2"
          style={{ background: T.surface, border: `1px solid ${T.border}` }}
        >
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {TABS.map((t) => {
              const active = t.key === tab;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className="px-4 sm:px-5 py-2.5 rounded-[18px] text-sm whitespace-nowrap transition-all"
                  style={{
                    background: active ? T.accent : "transparent",
                    color: active ? T.bg : T.textDim,
                    fontWeight: active ? 600 : 500,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Bento */}
        <div className="grid grid-cols-12 gap-6 items-start">
          {/* Left col */}
          <div className="col-span-12 lg:col-span-4 flex flex-col gap-6">
            {/* Corretor + meta */}
            <div className="p-6 rounded-[24px]" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
              <div className="flex items-center gap-4 mb-6">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-xl shrink-0"
                  style={{ background: T.muted, color: T.bg, fontFamily: T.sora }}
                >
                  {brokerInitials}
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: T.textDim }}>
                    Corretor
                  </p>
                  <h3
                    className="text-lg font-bold truncate"
                    style={{ fontFamily: T.sora, letterSpacing: "-0.02em", color: T.text }}
                  >
                    {brokerName}
                  </h3>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span style={{ color: T.textDim }}>Meta diária</span>
                  <span className="font-bold" style={{ fontFamily: T.sora }}>
                    {k.total}/{meta}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.5)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, background: reached ? "#4a7a4e" : T.accent }}
                  />
                </div>
              </div>
            </div>

            {/* A seguir */}
            <div
              className="p-6 rounded-[24px]"
              style={{ background: "rgba(255,255,255,0.4)", border: `1px dashed ${T.muted}` }}
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: T.textDim }}>
                A seguir
              </p>
              {nextOne ? (
                <div className="flex justify-between items-center gap-3">
                  <div className="min-w-0">
                    <h4 className="font-bold truncate" style={{ color: T.text, fontFamily: T.sora }}>
                      {nextOne.name}
                    </h4>
                    <p className="text-sm truncate" style={{ color: T.textDim }}>
                      {nextOne.phone || "(sem telefone)"}
                    </p>
                  </div>
                  <span
                    className="text-[11px] px-2 py-1 rounded-md shrink-0"
                    style={{ background: T.surface, color: T.textDim }}
                  >
                    {nextOne.attempt_count >= 1 ? "2ª tent." : "1ª tent."}
                  </span>
                </div>
              ) : (
                <p className="text-sm" style={{ color: T.textDim }}>
                  Fila vazia por enquanto.
                </p>
              )}
              {next3.length > 1 && (
                <div className="mt-4 pt-4 space-y-2" style={{ borderTop: `1px solid ${T.border}` }}>
                  {next3.slice(1).map((c) => (
                    <div key={c.id} className="flex justify-between text-xs" style={{ color: T.textDim }}>
                      <span className="truncate">{c.name}</span>
                      <span className="shrink-0 ml-3">{c.phone}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Center: Dialer */}
          <div className="col-span-12 lg:col-span-8">
            <div className="p-6 sm:p-8 rounded-[24px]" style={{ background: T.surface, border: `1px solid ${T.border}` }}>
              {!hydrated ? (
                <div className="py-20 text-center" style={{ color: T.textDim }}>Carregando fila…</div>
              ) : error ? (
                <div className="py-16 text-center">
                  <p style={{ color: "#9b4a4a" }}>Erro ao carregar: {error}</p>
                  <button
                    onClick={() => refresh()}
                    className="mt-4 px-5 py-2.5 rounded-[16px] text-sm font-semibold"
                    style={{ background: T.accent, color: T.bg }}
                  >
                    Tentar novamente
                  </button>
                </div>
              ) : !current ? (
                <div className="py-16 text-center">
                  <p style={{ color: T.text, fontFamily: T.sora, fontSize: 20, letterSpacing: "-0.02em" }}>
                    Nenhum contato pendente
                  </p>
                  <p className="mt-2 text-sm" style={{ color: T.textDim }}>
                    {loading ? "Buscando novos leads…" : "Volte mais tarde ou importe uma lista nova."}
                  </p>
                </div>
              ) : (
                <>
                  {/* Top badge + last call */}
                  <div className="flex flex-wrap justify-between items-center gap-3 mb-8">
                    <span
                      className="px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest"
                      style={{
                        background: isLast ? "rgba(155,74,74,0.10)" : T.surface2,
                        color: isLast ? "#9b4a4a" : T.accent,
                        border: `1px solid ${isLast ? "rgba(155,74,74,0.15)" : T.border}`,
                      }}
                    >
                      {attemptLabel(current.attempt_count) ?? "1ª tentativa"}
                    </span>
                    {lastCall && lastResult && (
                      <p className="text-xs font-medium italic flex items-center gap-2" style={{ color: T.textDim }}>
                        <span>Última: {lastWhen}</span>
                        <span style={{ opacity: 0.4 }}>•</span>
                        <span style={{ color: lastResult.color, fontWeight: 700, fontStyle: "normal" }}>
                          {lastResult.text}
                        </span>
                      </p>
                    )}
                  </div>

                  {/* Contact identity */}
                  <div className="text-center mb-8 sm:mb-10">
                    <h2
                      className="text-3xl sm:text-4xl font-bold mb-1 break-words"
                      style={{ fontFamily: T.sora, letterSpacing: "-0.03em", color: T.text, lineHeight: 1.1 }}
                    >
                      {current.name}
                    </h2>
                    <p className="text-lg sm:text-xl font-medium" style={{ color: T.textDim }}>
                      {current.phone || "(sem telefone)"}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-4 max-w-md mx-auto">
                    <a
                      href={dial}
                      target="_top"
                      className="w-full py-5 rounded-[20px] text-lg font-bold text-center transition-all active:scale-[0.98]"
                      style={{
                        background: T.accent,
                        color: T.bg,
                        fontFamily: T.sora,
                        letterSpacing: "-0.01em",
                        boxShadow: "0 8px 24px -12px rgba(139,115,85,0.35)",
                      }}
                    >
                      LIGAR AGORA
                    </a>
                    <div className="grid grid-cols-2 gap-3">
                      <a
                        href={wa1}
                        target="_blank"
                        rel="noreferrer"
                        className="py-3.5 rounded-[18px] text-sm font-semibold text-center transition-all active:scale-[0.98]"
                        style={{ background: T.surface2, color: T.textDim, border: `1px solid ${T.border}` }}
                      >
                        WhatsApp 1
                      </a>
                      <a
                        href={wa2}
                        target="_blank"
                        rel="noreferrer"
                        className="py-3.5 rounded-[18px] text-sm font-semibold text-center transition-all active:scale-[0.98]"
                        style={{ background: T.surface2, color: T.textDim, border: `1px solid ${T.border}` }}
                      >
                        WhatsApp 2
                      </a>
                    </div>
                  </div>

                  {/* Notes + chips + outcomes */}
                  <div className="mt-10 pt-10" style={{ borderTop: `1px solid ${T.borderStrong}` }}>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Adicionar observação sobre o lead..."
                      className="w-full p-4 rounded-[18px] text-sm resize-none focus:outline-none mb-6"
                      style={{
                        background: "rgba(255,255,255,0.6)",
                        border: `1px solid ${T.border}`,
                        minHeight: 100,
                        color: T.text,
                        lineHeight: 1.55,
                      }}
                    />

                    <div className="flex flex-wrap gap-2 mb-8">
                      {["Sem interesse", "Investimento", "Primeiro imóvel", "Fora de área", "Preço alto"].map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setNote((n) => (n ? `${n} · ${chip}` : chip))}
                          className="px-4 py-2 rounded-full text-xs font-medium transition-colors"
                          style={{ background: T.surface2, color: T.textDim, border: `1px solid ${T.border}` }}
                        >
                          {chip}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-3 gap-3 mb-6">
                      <button
                        disabled={submitting}
                        onClick={() => registerOutcome("no_answer")}
                        className="py-4 rounded-[18px] text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-60"
                        style={{
                          background: "rgba(239,68,68,0.10)",
                          color: "#9b4a4a",
                          border: "1px solid rgba(239,68,68,0.20)",
                        }}
                      >
                        Não atendeu
                      </button>
                      <button
                        disabled={submitting}
                        onClick={() => registerOutcome("answered")}
                        className="py-4 rounded-[18px] text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-60"
                        style={{ background: T.accent, color: T.bg }}
                      >
                        Atendeu
                      </button>
                      <button
                        disabled={submitting}
                        onClick={() => registerOutcome("scheduled")}
                        className="py-4 rounded-[18px] text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-60"
                        style={{
                          background: "rgba(74,122,78,0.14)",
                          color: "#3f6b43",
                          border: "1px solid rgba(74,122,78,0.20)",
                        }}
                      >
                        Agendou
                      </button>
                    </div>

                    <div className="flex justify-between items-center flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => refresh()}
                        className="text-xs font-bold uppercase tracking-tighter"
                        style={{ color: T.textDim }}
                      >
                        Retornar
                      </button>
                      <button
                        type="button"
                        onClick={skip}
                        className="text-xs font-bold uppercase tracking-tighter"
                        style={{ color: T.textDim }}
                      >
                        Pular
                      </button>
                      <button
                        type="button"
                        onClick={() => toast.info("Agendar lembrete: use a aba Lembretes na tela atual.")}
                        className="text-xs font-bold uppercase tracking-tighter"
                        style={{ color: T.accent, textDecoration: "underline" }}
                      >
                        Agendar Lembrete
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer KPIs */}
        <footer
          className="grid grid-cols-2 md:grid-cols-4 gap-6 p-6 rounded-[24px]"
          style={{ background: T.surface, border: `1px solid ${T.border}` }}
        >
          {[
            { label: "Ligações", value: k.total, color: T.text },
            { label: "Atendidas", value: k.attended, color: T.accent },
            { label: "Não atend.", value: k.noAnswer, color: T.text },
            { label: "Agendadas", value: k.scheduled, color: "#4a7a4e" },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <p
                className="text-[10px] font-bold uppercase tracking-widest mb-1"
                style={{ color: T.textDim }}
              >
                {s.label}
              </p>
              <p
                className="text-2xl font-bold tabular-nums"
                style={{ fontFamily: T.sora, letterSpacing: "-0.02em", color: s.color }}
              >
                {String(s.value).padStart(2, "0")}
              </p>
            </div>
          ))}
        </footer>

        <div className="text-center text-xs" style={{ color: T.textDim }}>
          <Link to="/" style={{ color: T.accent, textDecoration: "underline" }}>← Voltar para o discador atual</Link>
        </div>
      </div>

      <style>{`.no-scrollbar::-webkit-scrollbar{display:none} .no-scrollbar{-ms-overflow-style:none;scrollbar-width:none}`}</style>
    </div>
  );
}
