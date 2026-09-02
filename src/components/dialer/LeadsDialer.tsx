import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Phone,
  MessageCircle,
  SkipForward,
  RefreshCw,
  Check,
  X,
  Copy,
  ChevronDown,
  Sliders,
  List,
  Sun,
  Sunset,
} from "lucide-react";
import {
  telHref,
  normalizePhone,
  DEFAULT_WA_TEMPLATE,
  DEFAULT_WA_TEMPLATE_2,
  renderWaMessage,
  waHrefFromMessage,
} from "@/lib/dialer-shared";

// Mesma paleta do Discador — a aba Leads passa a ter a mesma cara.
const T = {
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
  red: "#dc2626",
  redSoft: "#fef2f2",
  grotesk: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
  sans: "'DM Sans', ui-sans-serif, system-ui, sans-serif",
};

export type PeriodState = "pendente" | "nao_atendeu" | "atendeu";

export type DialerLead = {
  id: string;
  name: string;
  phone: string;
  source: string | null;
  received_at: string;
  brokerName?: string | null;
  triedBefore: number;
  isToday: boolean;
  manha: PeriodState;
  tarde: PeriodState;
  totalAttempts: number;
  coldAfter: number;
};


export default function LeadsDialer({
  queue,
  period,
  brokerName,
  stats,
  goal,
  busy,
  loading,
  onOutcome,
  onRefresh,
  onOpenList,
}: {
  queue: DialerLead[];
  period: "manha" | "tarde";
  brokerName: string;
  stats: { atendidos: number; restantes: number; semResposta: number; novosHoje: number };
  goal?: { done: number; meta: number };
  busy: boolean;
  loading: boolean;
  onOutcome: (lead: DialerLead, attended: boolean) => Promise<void> | void;
  onRefresh: () => void;
  onOpenList: () => void;
}) {

  const [skipped, setSkipped] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [waTemplate, setWaTemplate] = useState<1 | 2>(1);
  const [dialing, setDialing] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const dialStartRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  const waTexts = useMemo(() => {
    if (typeof window === "undefined") return { 1: DEFAULT_WA_TEMPLATE, 2: DEFAULT_WA_TEMPLATE_2 };
    return {
      1: window.localStorage.getItem("dialer:wa_msg_1") || DEFAULT_WA_TEMPLATE,
      2: window.localStorage.getItem("dialer:wa_msg_2") || DEFAULT_WA_TEMPLATE_2,
    } as { 1: string; 2: string };
  }, []);

  // Ao virar de manhã para tarde, tudo que foi ligado/pulado de manhã volta
  // para a fila: são justamente as ligações do turno da tarde.
  useEffect(() => {
    setSkipped([]);
    setPinnedId(null);
  }, [period]);

  const pending = useMemo(() => queue.filter((l) => !skipped.includes(l.id)), [queue, skipped]);

  // Lead "travado": só muda quando o corretor registra o resultado ou pula.
  // Sem isso, qualquer recarga (realtime/refetch) reordenava a fila e o app
  // trocava de lead sozinho no meio da ligação.
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const current = useMemo(() => {
    const pinned = pinnedId ? pending.find((l) => l.id === pinnedId) : undefined;
    return pinned ?? pending[0] ?? null;
  }, [pending, pinnedId]);

  const nextOne = useMemo(() => pending.find((l) => l.id !== current?.id) ?? null, [pending, current?.id]);

  useEffect(() => {
    if (current && current.id !== pinnedId) setPinnedId(current.id);
    if (!current && pinnedId) setPinnedId(null);
  }, [current, pinnedId]);

  useEffect(() => {
    setNote("");
    setDialing(false);
    dialStartRef.current = null;
    setCallSeconds(0);
  }, [current?.id]);


  useEffect(() => {
    if (!dialing) return;
    const id = window.setInterval(() => {
      if (dialStartRef.current) setCallSeconds(Math.floor((Date.now() - dialStartRef.current) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [dialing]);

  const phoneValid = !!current && normalizePhone(current.phone).replace(/\D/g, "").length >= 10;
  const waMsg = current ? renderWaMessage(waTexts[waTemplate], current.name) : "";
  const wa = current ? waHrefFromMessage(current.phone, waMsg) : "#";
  const dial = current ? telHref(current.phone) : "#";
  const callSecFmt = `${String(Math.floor(callSeconds / 60)).padStart(2, "0")}:${String(callSeconds % 60).padStart(2, "0")}`;
  const periodLabel = period === "manha" ? "Manhã (9h–14h)" : "Tarde (14h–22h)";
  const PeriodIcon = period === "manha" ? Sun : Sunset;
  const done = stats.atendidos;
  const total = Math.max(1, stats.restantes + done);
  const pct = Math.min(100, Math.round((done / total) * 100));

  async function register(attended: boolean) {
    if (!current || busy || inFlightRef.current) return;
    inFlightRef.current = true;
    const doneId = current.id;
    try {
      await onOutcome(current, attended);
      setDialing(false);
      dialStartRef.current = null;
      setCallSeconds(0);
      // Libera o lead atual: se ele continuar na fila (ex.: falta o outro
      // período), ele sai da vez e o próximo assume.
      setSkipped((s) => (s.includes(doneId) ? s : [...s, doneId]));
      setPinnedId(null);
    } finally {
      inFlightRef.current = false;
    }
  }


  function skip() {
    if (current) setSkipped((s) => [...s, current.id]);
  }

  function copyPhone() {
    if (!current?.phone) return;
    navigator.clipboard?.writeText(current.phone).then(
      () => toast.success("Telefone copiado"),
      () => toast.error("Não foi possível copiar"),
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8" style={{ fontFamily: T.sans, color: T.ink }}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p
              className="text-[11px] font-medium uppercase tracking-[0.22em]"
              style={{ color: T.mute, fontFamily: T.grotesk }}
            >
              Leads C2S · {brokerName}
            </p>
            <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.02em]" style={{ fontFamily: T.grotesk }}>
              {stats.restantes}
              <span style={{ color: T.mute, fontWeight: 500 }}> leads para ligar agora</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-medium"
              style={{ background: T.blueSoft, color: T.blueDeep }}
            >
              <PeriodIcon className="h-3.5 w-3.5" /> {periodLabel}
            </span>
            <button
              type="button"
              onClick={onOpenList}
              className="flex items-center gap-2 rounded-full px-3.5 py-2 text-[13px] font-medium"
              style={{ border: `1px solid ${T.line}`, background: T.surface, color: T.dim }}
            >
              <List className="h-3.5 w-3.5" /> Lista
            </button>
          </div>
        </div>
        {goal && (
          <div
            className="flex items-center justify-between rounded-2xl px-4 py-3"
            style={{ background: T.soft, border: `1px solid ${T.line}` }}
          >
            <span className="text-[12px] font-medium" style={{ color: T.dim }}>
              Meta diária de ligações
            </span>
            <span className="text-[13px] font-semibold tabular-nums" style={{ fontFamily: T.grotesk, color: goal.done >= goal.meta ? T.green : T.ink }}>
              {goal.done} / {goal.meta}
            </span>
          </div>
        )}

        <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: T.lineSoft }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: T.blue }} />
        </div>
      </div>

      {loading && pending.length === 0 ? (
        <p className="py-24 text-center text-sm" style={{ color: T.mute }}>
          Carregando leads…
        </p>
      ) : !current ? (
        <div className="py-20 text-center">
          <p className="text-2xl font-semibold tracking-[-0.02em]" style={{ fontFamily: T.grotesk }}>
            Nenhum lead pendente agora
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm" style={{ color: T.dim }}>
            Você já ligou para todos os leads do C2S deste período. Novos leads aparecem aqui automaticamente.
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <button
              onClick={onRefresh}
              className="rounded-full px-5 py-2.5 text-sm font-semibold"
              style={{ background: T.blue, color: "#fff", fontFamily: T.grotesk }}
            >
              Atualizar
            </button>
            {skipped.length > 0 && (
              <button
                onClick={() => setSkipped([])}
                className="rounded-full px-5 py-2.5 text-sm font-semibold"
                style={{ background: T.soft, color: T.dim, fontFamily: T.grotesk }}
              >
                Voltar os {skipped.length} pulados
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="text-center">
            <span
              className="inline-block rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{
                background: current.triedBefore > 0 ? T.redSoft : T.blueSoft,
                color: current.triedBefore > 0 ? T.red : T.blueDeep,
                fontFamily: T.grotesk,
              }}
            >
              {current.isToday ? "Caiu hoje" : "Dias anteriores"}
              {current.triedBefore > 0 ? ` · ${current.triedBefore} tentativa(s)` : ""}
            </span>

            <h2
              className="mt-5 break-words text-[34px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[44px]"
              style={{ fontFamily: T.grotesk }}
            >
              {current.name}
            </h2>

            <div className="mt-2 inline-flex items-center gap-1.5">
              <p className="text-lg tabular-nums" style={{ color: T.dim }}>
                {current.phone || "(sem telefone)"}
              </p>
              {current.phone && (
                <button type="button" onClick={copyPhone} aria-label="Copiar telefone" className="rounded-full p-1.5" style={{ color: T.mute }}>
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <p className="mt-2 text-[12px]" style={{ color: T.mute }}>
              {current.source ? `Origem: ${current.source}` : "Origem: C2S"}
              {current.brokerName ? ` · ${current.brokerName}` : ""}
            </p>

            {/* Situação por período + tentativas acumuladas */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <PeriodChip label="Manhã" icon={Sun} state={current.manha} active={period === "manha"} />
              <PeriodChip label="Tarde" icon={Sunset} state={current.tarde} active={period === "tarde"} />
              <span
                className="rounded-full px-3 py-1.5 text-[12px] font-semibold"
                style={{
                  background: current.totalAttempts >= current.coldAfter - 1 ? T.redSoft : T.soft,
                  color: current.totalAttempts >= current.coldAfter - 1 ? T.red : T.dim,
                  fontFamily: T.grotesk,
                }}
              >
                {current.totalAttempts} de {current.coldAfter} tentativas
              </span>
            </div>
            <p className="mt-2 text-[11px]" style={{ color: T.mute }}>
              Após {current.coldAfter} tentativas o lead vai automaticamente para a lista fria.
            </p>
          </div>


          {!phoneValid ? (
            <div className="text-center">
              <p className="text-sm font-semibold" style={{ color: T.red }}>
                Telefone inválido
              </p>
              <button
                type="button"
                onClick={skip}
                className="mt-3 rounded-full px-6 py-3.5 text-sm font-semibold"
                style={{ background: T.ink, color: "#fff", fontFamily: T.grotesk }}
              >
                Pular lead
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <a
                href={dial}
                target="_top"
                onClick={() => {
                  dialStartRef.current = Date.now();
                  setDialing(true);
                  setCallSeconds(0);
                }}
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

          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={busy}
              onClick={() => void register(false)}
              className="flex flex-col items-center gap-1.5 rounded-2xl py-4 text-[12px] font-semibold disabled:opacity-50"
              style={{ background: T.surface, border: `1px solid ${T.line}`, color: T.red, fontFamily: T.grotesk }}
            >
              <X className="h-4 w-4" /> Não atendeu
            </button>
            <button
              disabled={busy}
              onClick={() => void register(true)}
              className="flex flex-col items-center gap-1.5 rounded-2xl py-4 text-[12px] font-semibold disabled:opacity-50"
              style={{ background: T.surface, border: `1px solid ${T.line}`, color: T.green, fontFamily: T.grotesk }}
            >
              <Check className="h-4 w-4" /> Atendeu
            </button>
          </div>

          <div className="flex flex-col gap-4">
            <button
              type="button"
              onClick={() => setDetailsOpen((o) => !o)}
              className="mx-auto flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: T.mute, fontFamily: T.grotesk }}
            >
              <Sliders className="h-3.5 w-3.5" />
              {detailsOpen ? "Ocultar detalhes" : "Mensagens, fila e números"}
              <ChevronDown className="h-3.5 w-3.5" style={{ transform: detailsOpen ? "rotate(180deg)" : "none" }} />
            </button>

            {detailsOpen && (
              <div className="flex flex-col gap-5 rounded-3xl p-5" style={{ background: T.surface, border: `1px solid ${T.line}` }}>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Anotação rápida (uso pessoal)…"
                  className="w-full resize-none rounded-2xl p-4 text-sm focus:outline-none"
                  style={{ background: T.soft, border: `1px solid ${T.line}`, minHeight: 72, color: T.ink }}
                />

                <div className="flex flex-1 rounded-full p-1" style={{ background: T.soft }}>
                  {([1, 2] as const).map((n) => (
                    <button
                      key={n}
                      onClick={() => setWaTemplate(n)}
                      className="flex-1 rounded-full py-1.5 text-[12px] font-semibold"
                      style={{
                        background: waTemplate === n ? T.surface : "transparent",
                        color: waTemplate === n ? T.blueDeep : T.mute,
                        fontFamily: T.grotesk,
                      }}
                    >
                      Msg {n}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-3 border-t pt-4 text-[12px]" style={{ borderColor: T.lineSoft, color: T.dim }}>
                  <span className="min-w-0 truncate">
                    A seguir: {nextOne ? `${nextOne.name} · ${nextOne.phone || "sem telefone"}` : "fila vazia"}
                  </span>
                  <button onClick={onOpenList} className="shrink-0 font-semibold" style={{ color: T.blueDeep }}>
                    Ver lista
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: "Novos hoje", value: stats.novosHoje, color: T.ink },
                    { label: "Atendidos", value: stats.atendidos, color: T.green },
                    { label: "Restam", value: stats.restantes, color: T.blueDeep },
                    { label: "Sem resp.", value: stats.semResposta, color: T.red },
                  ].map((s) => (
                    <div key={s.label}>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: T.mute, fontFamily: T.grotesk }}>
                        {s.label}
                      </p>
                      <p className="text-xl font-semibold tabular-nums" style={{ color: s.color, fontFamily: T.grotesk }}>
                        {s.value}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-3 text-[12px] font-semibold uppercase tracking-[0.14em]" style={{ color: T.mute, fontFamily: T.grotesk }}>
                  <button type="button" onClick={onRefresh} className="flex items-center gap-1.5">
                    <RefreshCw className="h-3 w-3" /> Recarregar
                  </button>
                  <button type="button" onClick={skip} className="flex items-center gap-1.5">
                    <SkipForward className="h-3 w-3" /> Pular
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

function PeriodChip({
  label,
  icon: Icon,
  state,
  active,
}: {
  label: string;
  icon: typeof Sun;
  state: PeriodState;
  active: boolean;
}) {
  const bg = state === "atendeu" ? "#eafaf0" : state === "nao_atendeu" ? T.redSoft : T.soft;
  const fg = state === "atendeu" ? T.green : state === "nao_atendeu" ? T.red : T.dim;
  const txt = state === "atendeu" ? "atendeu" : state === "nao_atendeu" ? "não atendeu" : "pendente";
  return (
    <span
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"
      style={{
        background: bg,
        color: fg,
        fontFamily: T.grotesk,
        border: active ? `1px solid ${fg}33` : "1px solid transparent",
      }}
    >
      <Icon className="h-3.5 w-3.5" /> {label}: {txt}
    </span>
  );
}
