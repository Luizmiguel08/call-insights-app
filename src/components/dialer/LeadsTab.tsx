import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Flame, Link2, PhoneCall, RefreshCw, Sun, Sunset, Check, X, ChevronDown } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/integrations/supabase/client";
import type { Me, State } from "@/lib/cloud-state";
import { fontDisplay, fontNumeric, inputCls, telHref, normalizePhone } from "@/lib/dialer-shared";
import { syncC2sNow } from "@/lib/c2s.functions";



const db = supabase as any;

type Lead = {
  id: string;
  c2s_lead_id: string;
  name: string;
  phone: string;
  email: string | null;
  source: string | null;
  c2s_broker_alias: string | null;
  c2s_broker_email: string | null;
  broker_id: string | null;
  status: string;
  received_at: string;
  attended_at: string | null;
};

type Attempt = {
  id: string;
  lead_id: string;
  period: string;
  result: string;
  attempt_date: string;
  called_at: string;
};

type Broker = { id: string; name: string; color: string; email: string | null };

const SP_TZ = "America/Sao_Paulo";

function spToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SP_TZ }).format(new Date());
}

function currentPeriod(): "manha" | "tarde" {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: SP_TZ, hour: "2-digit", hour12: false }).format(new Date()),
  );
  return hour < 12 ? "manha" : "tarde";
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

const VIRTUAL_THRESHOLD = 80;
const CARD_HEIGHT_ESTIMATE = 120;

export default function LeadsTab({ me, isAdmin }: { me: Me | null; isAdmin: boolean }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [view, setView] = useState<"novo" | "atendido" | "fria">("novo");
  const [focus, setFocus] = useState<"todos" | "falta_manha" | "falta_tarde" | "sem_resposta" | "pendentes_anteriores">("todos");
  const [brokerFilter, setBrokerFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Debounce ref for realtime reload
  const reloadTimerRef = useRef<number | null>(null);

  const today = spToday();
  const period = currentPeriod();

  const load = useCallback(async (statusFilter?: string) => {
    const since = new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10);
    const effectiveStatus = statusFilter ?? view;

    let leadsQuery = db.from("crm_leads").select("*").eq("status", effectiveStatus).order("received_at", { ascending: false }).limit(1000);

    const [leadsR, attemptsR, brokersR] = await Promise.all([
      leadsQuery,
      db.from("crm_lead_attempts").select("*").gte("attempt_date", since),
      db.from("brokers").select("id,name,color,email").order("name"),
    ]);
    if (leadsR.error) toast.error(`Falha ao carregar leads: ${leadsR.error.message}`);
    setLeads((leadsR.data ?? []) as Lead[]);
    setAttempts((attemptsR.data ?? []) as Attempt[]);
    setBrokers((brokersR.data ?? []) as Broker[]);
    setLoading(false);
  }, [view]);

  // Debounced reload triggered by realtime events
  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = window.setTimeout(() => {
      void load();
    }, 700);
  }, [load]);

  useEffect(() => {
    void load();
    const ch = db
      .channel(`crm-leads-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_leads" }, () => scheduleReload())
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_lead_attempts" }, () => scheduleReload())
      .subscribe();
    const onFocus = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
      db.removeChannel(ch);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load, scheduleReload]);

  // Reload when view changes
  useEffect(() => {
    setLoading(true);
    void load();
  }, [view, load]);

  type PeriodState = "pendente" | "nao_atendeu" | "atendeu";
  type LeadProgress = {
    manha: PeriodState;
    tarde: PeriodState;
    triedToday: number;
    triedBefore: number;
  };

  const progressByLead = useMemo(() => {
    const map = new Map<string, LeadProgress>();
    const get = (id: string) =>
      map.get(id) ?? { manha: "pendente" as PeriodState, tarde: "pendente" as PeriodState, triedToday: 0, triedBefore: 0 };
    for (const a of attempts) {
      const cur = get(a.lead_id);
      if (a.attempt_date === today) {
        cur.triedToday += 1;
        const key = a.period === "manha" ? "manha" : "tarde";
        if (a.result === "atendeu") cur[key] = "atendeu";
        else if (cur[key] !== "atendeu") cur[key] = "nao_atendeu";
      } else {
        cur.triedBefore += 1;
      }
      map.set(a.lead_id, cur);
    }
    return map;
  }, [attempts, today]);

  const progressOf = useCallback(
    (id: string): LeadProgress =>
      progressByLead.get(id) ?? { manha: "pendente", tarde: "pendente", triedToday: 0, triedBefore: 0 },
    [progressByLead],
  );

  const visible = useMemo(() => {
    const byView = leads.filter((l) => {
      // Status already filtered at query level, but double-check for safety
      if (l.status !== view) return false;
      if (isAdmin && brokerFilter !== "all") {
        if (brokerFilter === "none") return !l.broker_id;
        return l.broker_id === brokerFilter;
      }
      return true;
    });
    if (view !== "novo" || focus === "todos") return byView;
    return byView.filter((l) => {
      const p = progressOf(l.id);
      if (focus === "falta_manha") return p.manha === "pendente";
      if (focus === "falta_tarde") return p.tarde === "pendente";
      if (focus === "sem_resposta") return p.manha === "nao_atendeu" && p.tarde === "nao_atendeu";
      if (focus === "pendentes_anteriores") return p.triedBefore > 0;
      return true;
    });
  }, [leads, view, isAdmin, brokerFilter, focus, progressOf]);

  const todayNew = useMemo(
    () => leads.filter((l) => l.status === "novo" && spDate(l.received_at) === today),
    [leads, today],
  );
  const novos = useMemo(
    () =>
      leads.filter((l) => {
        if (l.status !== "novo") return false;
        if (isAdmin && brokerFilter !== "all") {
          if (brokerFilter === "none") return !l.broker_id;
          return l.broker_id === brokerFilter;
        }
        return true;
      }),
    [leads, isAdmin, brokerFilter],
  );
  const counts = useMemo(() => {
    let faltaManha = 0, faltaTarde = 0, semResposta = 0, anteriores = 0;
    for (const l of novos) {
      const p = progressOf(l.id);
      if (p.manha === "pendente") faltaManha += 1;
      if (p.tarde === "pendente") faltaTarde += 1;
      if (p.manha === "nao_atendeu" && p.tarde === "nao_atendeu") semResposta += 1;
      if (p.triedBefore > 0) anteriores += 1;
    }
    return { faltaManha, faltaTarde, semResposta, anteriores };
  }, [novos, progressOf]);
  const pendingPeriod = period === "manha" ? counts.faltaManha : counts.faltaTarde;

  /** Resumo do dia por corretor: quem atendeu de manhã, de tarde e quem não respondeu. */
  const dailySummary = useMemo(() => {
    const rows = new Map<string, { name: string; color: string; manha: number; tarde: number; semResposta: number; total: number }>();
    for (const l of leads) {
      const p = progressOf(l.id);
      if (p.triedToday === 0 && p.manha === "pendente" && p.tarde === "pendente") continue;
      const key = l.broker_id ?? "none";
      const broker = brokers.find((b) => b.id === l.broker_id);
      const cur =
        rows.get(key) ??
        { name: broker?.name ?? "Sem corretor", color: broker?.color ?? "#71717a", manha: 0, tarde: 0, semResposta: 0, total: 0 };
      cur.total += 1;
      if (p.manha === "atendeu") cur.manha += 1;
      if (p.tarde === "atendeu") cur.tarde += 1;
      if (p.manha === "nao_atendeu" && p.tarde === "nao_atendeu") cur.semResposta += 1;
      rows.set(key, cur);
    }
    return [...rows.values()].sort((a, b) => b.manha + b.tarde - (a.manha + a.tarde) || a.name.localeCompare(b.name));
  }, [leads, brokers, progressOf]);




  async function syncNow() {
    setSyncing(true);
    try {
      const r = await syncC2sNow({ data: { sinceHours: 72 } });
      toast.success(`C2S sincronizado: ${r.saved} lead(s) atualizados`);
      if (r.unmapped.length > 0) toast.warning(`Sem vínculo de corretor: ${r.unmapped.join(", ")}`);
      void load();
    } catch (e) {
      toast.error(`Falha ao sincronizar C2S: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function register(lead: Lead, attended: boolean) {

    setBusy(lead.id);
    const { error } = await db.rpc("crm_register_lead_attempt", {
      _lead_id: lead.id,
      _attended: attended,
      _result: attended ? "atendeu" : "nao_atendeu",
    });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(attended ? `${lead.name} atendeu — saiu dos novos` : `Tentativa registrada (${period === "manha" ? "manhã" : "tarde"})`);
    void load();
  }

  const hoje = useMemo(() => visible.filter((l) => spDate(l.received_at) === today), [visible, today]);
  const anteriores = useMemo(() => visible.filter((l) => spDate(l.received_at) !== today), [visible, today]);

  const LeadCard = ({ lead }: { lead: Lead }) => {
    const p = progressOf(lead.id);
    const broker = brokers.find((b) => b.id === lead.broker_id);
    const age = daysSince(lead.received_at);
    const phoneOk = normalizePhone(lead.phone).length >= 10;
    const semResposta = p.manha === "nao_atendeu" && p.tarde === "nao_atendeu";
    const atendeu = p.manha === "atendeu" || p.tarde === "atendeu";
    return (
      <div
        className="rounded-2xl bg-white p-4"
        style={{
          border: `1px solid ${semResposta ? "#fecaca" : atendeu ? "#bbf7d0" : "#e8ecf1"}`,
          boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold" style={{ ...fontDisplay, color: "#0f172a" }}>
              {lead.name}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "#64748b" }}>
              <span style={fontNumeric}>{lead.phone || "sem telefone"}</span>
              {lead.source && <span>{lead.source}</span>}
              {broker ? (
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: broker.color }} />
                  {broker.name}
                </span>
              ) : (
                <span style={{ color: "#b45309" }}>sem corretor</span>
              )}
              <span>{age === 0 ? "hoje" : `há ${age} dia(s)`}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <PeriodPill label="Manhã" state={p.manha} icon={Sun} active={period === "manha"} />
              <PeriodPill label="Tarde" state={p.tarde} icon={Sunset} active={period === "tarde"} />
              {p.triedBefore > 0 && (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: "#fff7ed", color: "#b45309" }}
                >
                  {p.triedBefore} tentativa(s) antes
                </span>
              )}
            </div>
          </div>

          {lead.status === "novo" && (
            <div className="flex items-center gap-2">
              {phoneOk ? (
                <a
                  href={telHref(lead.phone)}
                  target="_top"
                  className="flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white"
                  style={{ ...fontDisplay, background: "#3b82f6", boxShadow: "0 6px 16px -8px rgba(59,130,246,0.8)" }}
                >
                  <PhoneCall className="h-4 w-4" /> Ligar
                </a>
              ) : (
                <span className="text-xs" style={{ color: "#dc2626" }}>telefone inválido</span>
              )}
              <button
                disabled={busy === lead.id}
                onClick={() => void register(lead, true)}
                className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold disabled:opacity-50"
                style={{ background: "#ecfdf5", color: "#047857" }}
              >
                <Check className="h-4 w-4" /> Atendeu
              </button>
              <button
                disabled={busy === lead.id}
                onClick={() => void register(lead, false)}
                className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold disabled:opacity-50"
                style={{ background: "#f1f5f9", color: "#475569" }}
              >
                <X className="h-4 w-4" /> Não atendeu
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight" style={{ ...fontDisplay, color: "#0f172a" }}>
            Leads
          </h2>
          <p className="text-sm" style={{ color: "#64748b" }}>
            1 ligação na manhã (9h–12h) e 1 na tarde (14h–19h). Sai da lista quando atender.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => void syncNow()}
              disabled={syncing}
              className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold disabled:opacity-60"
              style={{ background: "#eff6ff", color: "#1d4ed8" }}
            >
              <Link2 className="h-4 w-4" /> {syncing ? "Sincronizando…" : "Sincronizar"}
            </button>
          )}
          <button
            onClick={() => void load()}
            className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium"
            style={{ background: "#f1f5f9", color: "#475569" }}
          >
            <RefreshCw className="h-4 w-4" /> Atualizar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Novos hoje" value={todayNew.length} icon={Flame} />
        <Stat
          label={period === "manha" ? "Faltam na manhã" : "Faltam na tarde"}
          value={pendingPeriod}
          icon={period === "manha" ? Sun : Sunset}
        />
        <Stat label="Sem resposta" value={counts.semResposta} icon={X} />
        <Stat label="Atendidos" value={leads.filter((l) => l.status === "atendido").length} icon={Check} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["novo", "atendido", "fria"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="h-9 rounded-full px-4 text-sm font-semibold"
            style={
              view === v
                ? { background: "#0f172a", color: "#ffffff" }
                : { background: "#f1f5f9", color: "#475569" }
            }
          >
            {v === "novo" ? "Para ligar" : v === "atendido" ? "Atendidos" : "Frias"}
          </button>
        ))}
        {isAdmin && (
          <select
            value={brokerFilter}
            onChange={(e) => setBrokerFilter(e.target.value)}
            className="ml-auto h-9 max-w-[220px] rounded-full px-3 text-sm outline-none"
            style={{ background: "#f1f5f9", color: "#334155" }}
          >
            <option value="all">Todos os corretores</option>
            <option value="none">Sem corretor</option>
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>

      {view === "novo" && (
        <div className="flex flex-wrap items-center gap-2">
          {([
            ["todos", `Todos (${novos.length})`],
            [period === "manha" ? "falta_manha" : "falta_tarde", `Falta ligar agora (${pendingPeriod})`],
            ["sem_resposta", `Sem resposta (${counts.semResposta})`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFocus(key)}
              className="h-8 rounded-full px-3 text-xs font-semibold"
              style={
                focus === key
                  ? { background: "#eff6ff", color: "#1d4ed8" }
                  : { background: "transparent", color: "#64748b", border: "1px solid #e2e8f0" }
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm" style={{ color: "#94a3b8" }}>Carregando leads…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl bg-white py-16 text-center text-sm" style={{ border: "1px solid #e8ecf1", color: "#94a3b8" }}>
          Nenhum lead nessa lista.
        </div>
      ) : (
        <div className="space-y-8">
          <LeadSection
            title="Caíram hoje"
            items={hoje}
            LeadCard={LeadCard}
          />
          <LeadSection
            title={`Dias anteriores ${view === "novo" ? "— ainda sem atender" : ""}`}
            items={anteriores}
            LeadCard={LeadCard}
          />
        </div>
      )}

      {isAdmin && dailySummary.length > 0 && (
        <div className="rounded-2xl bg-white p-4" style={{ border: "1px solid #e8ecf1" }}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold" style={{ ...fontDisplay, color: "#0f172a" }}>Resumo de hoje por corretor</p>
            <span className="text-xs" style={{ color: "#94a3b8" }}>{today.split("-").reverse().join("/")}</span>
          </div>
          <div className="mt-2 divide-y" style={{ borderColor: "#f1f5f9" }}>
            {dailySummary.map((r) => (
              <div key={r.name} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2" style={{ color: "#334155" }}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                  <span className="truncate">{r.name}</span>
                </span>
                <span className="flex items-center gap-2 text-xs font-semibold" style={fontNumeric}>
                  <span className="rounded-full px-2 py-0.5" style={{ background: "#ecfdf5", color: "#047857" }}>{r.manha} manhã</span>
                  <span className="rounded-full px-2 py-0.5" style={{ background: "#ecfdf5", color: "#047857" }}>{r.tarde} tarde</span>
                  <span className="rounded-full px-2 py-0.5" style={{ background: "#fef2f2", color: "#b91c1c" }}>{r.semResposta} sem resposta</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && <AliasManager brokers={brokers} leads={leads} onChange={load} />}
    </div>
  );
}

/** Virtualized or plain lead list section */
function LeadSection({
  title,
  items,
  LeadCard,
}: {
  title: string;
  items: Lead[];
  LeadCard: React.ComponentType<{ lead: Lead }>;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = items.length > VIRTUAL_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? items.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_HEIGHT_ESTIMATE,
    overscan: 5,
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ ...fontDisplay, color: "#0f172a" }}>
          {title}
        </h3>
        <span className="text-xs" style={{ color: "#94a3b8" }}>{items.length} lead(s)</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm" style={{ color: "#94a3b8" }}>Nenhum lead nessa seção.</p>
      ) : shouldVirtualize ? (
        <div
          ref={parentRef}
          className="max-h-[70vh] overflow-auto rounded-xl"
          style={{ contain: "strict" }}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={items[virtualRow.index].id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
              >
                <div className="pb-3">
                  <LeadCard lead={items[virtualRow.index]} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
        </div>
      )}
    </section>
  );
}

function spDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SP_TZ }).format(new Date(iso));
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Flame }) {
  return (
    <div className="rounded-2xl bg-white p-3" style={{ border: "1px solid #e8ecf1" }}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#64748b" }}>
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-1 text-2xl font-semibold" style={{ ...fontNumeric, color: "#0f172a" }}>{value}</div>
    </div>
  );
}

function PeriodPill({
  label,
  state,
  active,
  icon: Icon,
}: {
  label: string;
  state: "pendente" | "nao_atendeu" | "atendeu";
  active: boolean;
  icon: typeof Sun;
}) {
  const style =
    state === "atendeu"
      ? { background: "#ecfdf5", color: "#047857" }
      : state === "nao_atendeu"
        ? { background: "#fef2f2", color: "#b91c1c" }
        : active
          ? { background: "#eff6ff", color: "#1d4ed8" }
          : { background: "#f1f5f9", color: "#94a3b8" };
  const suffix = state === "atendeu" ? "atendeu" : state === "nao_atendeu" ? "não atendeu" : "pendente";
  return (
    <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={style}>
      <Icon className="h-3 w-3" /> {label}: {suffix}
    </span>
  );
}



/** Mapeia apelidos/e-mails do C2S para corretores daqui (admin). */
function AliasManager({ brokers, leads, onChange }: { brokers: Broker[]; leads: Lead[]; onChange: () => void }) {
  const [alias, setAlias] = useState("");
  const [email, setEmail] = useState("");
  const [brokerId, setBrokerId] = useState("");
  const [rows, setRows] = useState<{ id: string; c2s_alias: string | null; c2s_email: string | null; broker_id: string }[]>([]);

  const loadRows = useCallback(async () => {
    const { data } = await db.from("crm_broker_aliases").select("*").order("created_at", { ascending: false });
    setRows(data ?? []);
  }, []);

  useEffect(() => { void loadRows(); }, [loadRows]);

  const unmapped = useMemo(() => {
    const set = new Map<string, string>();
    for (const l of leads) {
      if (l.broker_id) continue;
      const key = (l.c2s_broker_email ?? l.c2s_broker_alias ?? "").toLowerCase();
      if (key) set.set(key, l.c2s_broker_alias ?? l.c2s_broker_email ?? key);
    }
    return [...set.entries()];
  }, [leads]);

  async function save() {
    if (!brokerId || (!alias.trim() && !email.trim())) {
      toast.error("Informe o apelido ou e-mail do C2S e o corretor.");
      return;
    }
    const { error } = await db.from("crm_broker_aliases").insert({
      c2s_alias: alias.trim() || null,
      c2s_email: email.trim().toLowerCase() || null,
      broker_id: brokerId,
    });
    if (error) { toast.error(error.message); return; }

    // Vincula retroativamente os leads que usavam esse apelido/e-mail
    if (email.trim()) await db.from("crm_leads").update({ broker_id: brokerId }).is("broker_id", null).ilike("c2s_broker_email", email.trim());
    if (alias.trim()) await db.from("crm_leads").update({ broker_id: brokerId }).is("broker_id", null).ilike("c2s_broker_alias", alias.trim());

    setAlias(""); setEmail(""); setBrokerId("");
    toast.success("Vínculo criado");
    void loadRows();
    onChange();
  }

  async function remove(id: string) {
    await db.from("crm_broker_aliases").delete().eq("id", id);
    void loadRows();
  }

  return (
    <div className="rounded-2xl bg-white p-4 sm:p-5" style={{ border: "1px solid #e8ecf1" }}>
      <h3 className="flex items-center gap-2 text-sm font-semibold" style={{ ...fontDisplay, color: "#0f172a" }}>
        <Link2 className="h-4 w-4" /> Apelidos do C2S → corretores
      </h3>
      <p className="mt-1 text-xs" style={{ color: "#64748b" }}>
        O vínculo é automático pelo e-mail do corretor. Use esta tabela apenas quando o e-mail do C2S for diferente do cadastrado aqui.
      </p>

      {unmapped.length > 0 && (
        <div className="mt-3 rounded-xl p-3 text-xs" style={{ background: "#fff7ed", color: "#b45309" }}>
          <p className="font-semibold">Leads sem vínculo de corretor ({unmapped.length}):</p>
          <ul className="mt-1 list-disc pl-4">
            {unmapped.slice(0, 10).map(([key, label]) => (
              <li key={key}>{label}</li>
            ))}
            {unmapped.length > 10 && <li>… e mais {unmapped.length - 10}</li>}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs font-medium" style={{ color: "#475569" }}>Apelido C2S</label>
          <input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="ex: João Silva"
            className={inputCls + " mt-1 h-9 w-40"}
          />
        </div>
        <div>
          <label className="text-xs font-medium" style={{ color: "#475569" }}>E-mail C2S</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ex: joao@c2s.com"
            className={inputCls + " mt-1 h-9 w-48"}
          />
        </div>
        <div>
          <label className="text-xs font-medium" style={{ color: "#475569" }}>Corretor</label>
          <select
            value={brokerId}
            onChange={(e) => setBrokerId(e.target.value)}
            className={inputCls + " mt-1 h-9 w-44"}
          >
            <option value="">Selecionar…</option>
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => void save()}
          className="h-9 rounded-xl px-4 text-sm font-semibold text-white"
          style={{ background: "#3b82f6" }}
        >
          Salvar
        </button>
      </div>

      {rows.length > 0 && (
        <div className="mt-4 divide-y" style={{ borderColor: "#f1f5f9" }}>
          {rows.map((r) => {
            const broker = brokers.find((b) => b.id === r.broker_id);
            return (
              <div key={r.id} className="flex items-center justify-between py-2 text-sm">
                <span style={{ color: "#334155" }}>
                  {r.c2s_alias || r.c2s_email} → <strong>{broker?.name ?? "?"}</strong>
                </span>
                <button
                  onClick={() => void remove(r.id)}
                  className="text-xs font-medium" style={{ color: "#dc2626" }}
                >
                  Remover
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
