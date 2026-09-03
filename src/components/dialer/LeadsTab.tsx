import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Flame, Link2, PhoneCall, RefreshCw, Sun, Sunset, Check, X, ChevronDown } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/integrations/supabase/client";
import type { Me, State } from "@/lib/cloud-state";
import { fontDisplay, fontNumeric, inputCls, telHref, normalizePhone } from "@/lib/dialer-shared";
import { syncC2sNow } from "@/lib/c2s.functions";
import LeadsDialer, { type DialerLead } from "@/components/dialer/LeadsDialer";
import { withTimeout } from "@/lib/async-resilience";




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

/** Cobertura móvel de 24h: 2 ligações em períodos diferentes = 1 tentativa. */
type CoverageState = {
  attempts_done: number;
  open_first_period: string | null;
  open_first_called_at: string | null;
  open_expires_at: string | null;
  last_first_called_at: string | null;
  last_second_called_at: string | null;
  last_attempt_number: number | null;
};

const EMPTY_COVERAGE: CoverageState = {
  attempts_done: 0,
  open_first_period: null,
  open_first_called_at: null,
  open_expires_at: null,
  last_first_called_at: null,
  last_second_called_at: null,
  last_attempt_number: null,
};

const SP_TZ = "America/Sao_Paulo";

function spToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SP_TZ }).format(new Date());
}

function spHour() {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: SP_TZ, hour: "2-digit", hour12: false }).format(new Date()),
  );
}

function currentPeriod(): "manha" | "tarde" {
  return spHour() < 14 ? "manha" : "tarde";
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function spMonth(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SP_TZ, year: "numeric", month: "2-digit" }).format(new Date(iso));
}

const VIRTUAL_THRESHOLD = 80;
const CARD_HEIGHT_ESTIMATE = 120;
const LEAD_COLUMNS = "id,c2s_lead_id,name,phone,email,source,c2s_broker_alias,c2s_broker_email,broker_id,status,received_at,attended_at";
/** Limite real de linhas por resposta da API (não adianta pedir mais). */
const PAGE_ROWS = 1000;

// Piso de histórico: puxa leads desde 01/06/2026 (não apenas os últimos dias)
const LEADS_FLOOR = "2026-06-01T00:00:00.000Z";
/** Após este número de tentativas o lead vai para a lista fria (regra também no banco). */
const COLD_AFTER_ATTEMPTS = 7;
const SNAPSHOT_RETRY_DELAYS = [700, 1800, 4000] as const;

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error ?? "Erro desconhecido");
}

function isTransientLoadError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("load failed") ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("connection") ||
    message.includes("gateway") ||
    message.includes("temporarily")
  );
}


export default function LeadsTab({ me, isAdmin, state }: { me: Me | null; isAdmin: boolean; state: State }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [totalsByLead, setTotalsByLead] = useState<Map<string, number>>(new Map());
  const [coverageByLead, setCoverageByLead] = useState<Map<string, CoverageState>>(new Map());

  const [mode, setMode] = useState<"dial" | "lista">("dial");
  const [view, setView] = useState<"novo" | "atendido" | "fria">("novo");

  const [focus, setFocus] = useState<"todos" | "falta_manha" | "falta_tarde" | "sem_resposta" | "pendentes_anteriores">("todos");
  // Admin também é corretor: começa vendo os próprios leads (pode trocar para
  // "Todos os corretores" no seletor).
  const [brokerFilter, setBrokerFilter] = useState<string>(me?.brokerId ?? "all");
  const brokerFilterInit = useRef(false);
  useEffect(() => {
    if (brokerFilterInit.current || !me?.brokerId) return;
    brokerFilterInit.current = true;
    setBrokerFilter(me.brokerId);
  }, [me?.brokerId]);

  // Filtro por mês para visualizar leads de ago/jul/jun de 2026 por corretor.
  const MONTH_OPTIONS = useMemo(
    () => [
      { value: "all", label: "Todos os meses" },
      { value: "2026-08", label: "Agosto/2026" },
      { value: "2026-07", label: "Julho/2026" },
      { value: "2026-06", label: "Junho/2026" },
    ],
    [],
  );
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Reusa corretores já carregados pelo useCloudState em index.tsx — evita
  // uma requisição extra toda vez que a aba Leads é montada.
  const [dbBrokers, setDbBrokers] = useState<Broker[]>([]);
  const brokers = useMemo<Broker[]>(() => {
    const map = new Map<string, Broker>();
    for (const b of state.brokers) {
      map.set(b.id, { id: b.id, name: b.name, color: "#3b82f6", email: b.userId ?? null });
    }
    // Admin (e qualquer usuário) precisa dos nomes de TODOS os corretores para
    // rotular os leads corretamente — o estado local traz só o próprio corretor.
    for (const b of dbBrokers) map.set(b.id, b);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [state.brokers, dbBrokers]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await db.from("brokers").select("id,name,color").order("name");
      if (!alive || r.error) return;
      setDbBrokers(((r.data ?? []) as { id: string; name: string; color: string | null }[]).map((b) => ({
        id: b.id,
        name: b.name,
        color: b.color ?? "#3b82f6",
        email: null,
      })));
    })();
    return () => { alive = false; };
  }, []);

  // Debounce ref for realtime reload
  const reloadTimerRef = useRef<number | null>(null);
  const recoveryTimerRef = useRef<number | null>(null);
  // Cursor da paginação guardado em ref: manter `leads` nas dependências de
  // `load` recriava a função a cada resultado e reiniciava o efeito de
  // carregamento/realtime em loop infinito.
  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  // Quando um reload chega enquanto outro está em andamento, ele era descartado
  // silenciosamente — isso fazia a ação de "atendeu/não atendeu" parecer não
  // registrada. Agora a chamada fica pendente e roda logo após a atual.
  const pendingLoadRef = useRef(false);
  const requestEpochRef = useRef(0);
  // Espelho do tamanho atual da lista: usado no reload (realtime/troca de visão)
  // para não encolher a lista de volta à primeira página e jogar o scroll pro topo.
  const leadsLenRef = useRef(0);
  // Tentativas registradas neste aparelho hoje: sobrevivem a qualquer recarga,
  // então o lead nunca volta para a fila depois do clique.
  const localAttemptsRef = useRef<Attempt[]>([]);
  const localTotalsRef = useRef<Map<string, number>>(new Map());
  const localCoverageRef = useRef<Map<string, CoverageState>>(new Map());

  // Relógio interno: a aba fica aberta o dia todo. Sem isto, quem abriu de
  // manhã continuava com period = "manha" depois das 14h e os leads já
  // ligados de manhã nunca reapareciam para a ligação da tarde.
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setClockTick((n) => n + 1), 60_000);
    const onWake = () => setClockTick((n) => n + 1);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, []);

  const today = useMemo(() => spToday(), [clockTick]);
  const period = useMemo(() => currentPeriod(), [clockTick]);


  // Contador de ligações do dia por corretor (mesma fonte do painel: tabela calls).
  const [callsToday, setCallsToday] = useState<Map<string, number>>(new Map());
  const [metaDaily, setMetaDaily] = useState(50);
  const loadCallCountsRef = useRef<(() => Promise<void>) | null>(null);

  // As contagens do dia vêm dentro do snapshot (uma única chamada). Esta função
  // só é usada como recarga pontual leve.
  const applyCallCounts = useCallback((rows: { broker_id: string | null; total: number }[]) => {
    const m = new Map<string, number>();
    for (const c of rows) m.set(c.broker_id ?? "none", c.total);
    setCallsToday(m);
  }, []);

  const loadCallCounts = useCallback(async () => {
    const startIso = `${today}T03:00:00.000Z`; // 00h em São Paulo (UTC-3)
    const r = await db.from("calls").select("broker_id").gte("created_at", startIso).limit(1000);
    if (r.error) return;
    const m = new Map<string, number>();
    for (const c of (r.data ?? []) as { broker_id: string | null }[]) {
      const k = c.broker_id ?? "none";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    setCallsToday(m);
  }, [today]);
  loadCallCountsRef.current = loadCallCounts;


  useEffect(() => {
    void loadCallCounts();
    void (async () => {
      const r = await db.from("app_settings").select("meta_daily").limit(1);
      const n = (r.data ?? [])[0]?.meta_daily;
      if (typeof n === "number" && n > 0) setMetaDaily(n);
    })();
  }, [loadCallCounts]);

  const loadFnRef = useRef<((statusFilter?: string, append?: boolean) => Promise<void>) | null>(null);


  const load = useCallback(async (statusFilter?: string, append = false) => {
    if (loadingRef.current) {
      pendingLoadRef.current = true;
      return;
    }
    loadingRef.current = true;
    const requestEpoch = ++requestEpochRef.current;
    try {
      const effectiveStatus = statusFilter ?? view;

      // Escopo por corretor. O banco reforça o escopo (corretor só vê o próprio).
      const scopeBroker = isAdmin ? (brokerFilter === "all" ? "all" : brokerFilter) : me?.brokerId ?? null;

      // UMA única chamada traz leads + tentativas + coberturas + totais +
      // ligações do dia. Antes eram até ~120 requisições sequenciais de 500/1000
      // linhas — isso saturava a API e deixava a aba lenta / falhando.
      const snapshotArgs = {
        _status: effectiveStatus,
        _broker: scopeBroker && scopeBroker !== "all" && scopeBroker !== "none" ? scopeBroker : null,
        _all_brokers: scopeBroker === "all",
        _floor: LEADS_FLOOR,
        // "Todos os corretores" é visão panorâmica do admin: teto menor para a
        // resposta não passar de alguns MB (era o que travava a tela).
        _limit: scopeBroker === "all" ? 4000 : 20000,
      };

      // Safari/iPhone pode interromper um fetch ao voltar do discador nativo.
      // Repete a leitura com espera progressiva; os dados atuais ficam na tela.
      let rpc: any = null;
      for (let attempt = 0; attempt <= SNAPSHOT_RETRY_DELAYS.length; attempt += 1) {
        try {
          rpc = await withTimeout(
            db.rpc("crm_leads_snapshot", snapshotArgs),
            12_000,
            "O carregamento dos leads",
          );
        } catch (error) {
          rpc = { data: null, error };
        }
        if (!rpc.error || !isTransientLoadError(rpc.error) || attempt === SNAPSHOT_RETRY_DELAYS.length) break;
        await wait(SNAPSHOT_RETRY_DELAYS[attempt]);
      }
      if (rpc.error) {
        const transient = isTransientLoadError(rpc.error);
        // Nunca apaga uma fila válida por uma falha momentânea. Agenda uma nova
        // tentativa silenciosa; só mostra erro quando nem a carga inicial existe.
        if (transient) {
          if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current);
          recoveryTimerRef.current = window.setTimeout(() => void loadFnRef.current?.(), 10_000);
          if (leadsLenRef.current === 0) toast.warning("Conexão instável. Tentando carregar os leads novamente…");
        } else {
          toast.error(`Falha ao carregar leads: ${errorMessage(rpc.error)}`);
        }
        return;
      }
      if (recoveryTimerRef.current) {
        window.clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
      if (requestEpoch !== requestEpochRef.current) return;
      const snap = (rpc.data ?? {}) as {
        leads?: Lead[];
        attempts?: Attempt[];
        totals?: { lead_id: string; total_attempts: number }[];
        coverage?: ({ lead_id: string } & CoverageState)[];
        calls_today?: { broker_id: string | null; total: number }[];
      };
      const all: Lead[] = snap.leads ?? [];
      const cursor: string | null = all.length > 0 ? all[all.length - 1].received_at : null;
      const attemptsRows: Attempt[] = snap.attempts ?? [];
      const totalsRows = snap.totals ?? [];
      const coverageRows = snap.coverage ?? [];
      applyCallCounts(snap.calls_today ?? []);


      setLeads((prev) => {
        const next = append
          ? [...prev, ...all.filter((l) => !prev.some((p) => p.id === l.id))]
          : all;
        leadsLenRef.current = next.length;
        return next;
      });
      cursorRef.current = cursor;
      setHasMore(false);
      // Mantém as tentativas registradas neste aparelho que ainda não voltaram
      // do servidor — nunca deixa o lead reaparecer por atraso de leitura.
      setAttempts(() => {
        const ids = new Set(attemptsRows.map((a) => a.lead_id + "|" + a.period + "|" + a.attempt_date));
        const localExtras = localAttemptsRef.current.filter(
          (a) => !ids.has(a.lead_id + "|" + a.period + "|" + a.attempt_date),
        );
        return [...attemptsRows, ...localExtras];
      });
      {
        const m = new Map<string, number>();
        for (const t of totalsRows) m.set(t.lead_id, t.total_attempts);
        for (const [id, n] of localTotalsRef.current) m.set(id, Math.max(m.get(id) ?? 0, n));
        setTotalsByLead(m);
      }
      {
        const m = new Map<string, CoverageState>();
        for (const c of coverageRows) {
          const { lead_id, ...rest } = c;
          m.set(lead_id, { ...EMPTY_COVERAGE, ...rest });
        }
        // Coberturas registradas neste aparelho vencem o que ainda não chegou do servidor.
        for (const [id, local] of localCoverageRef.current) {
          const srv = m.get(id);
          const srvSecond = srv?.last_second_called_at ?? "";
          const locSecond = local.last_second_called_at ?? "";
          if (!srv || (local.attempts_done ?? 0) > (srv.attempts_done ?? 0) || locSecond > srvSecond) {
            m.set(id, local);
          }
        }
        setCoverageByLead(m);
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setLoadingMore(false);
      if (pendingLoadRef.current) {
        pendingLoadRef.current = false;
        void loadFnRef.current?.();
      }
    }
  }, [view, isAdmin, brokerFilter, me?.brokerId, applyCallCounts]);


  loadFnRef.current = load;

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const y = window.scrollY;
    void load(view, true).finally(() => {
      requestAnimationFrame(() => {
        if (window.scrollY < y - 50) window.scrollTo({ top: y });
      });
    });
  }, [load, view, loadingMore, hasMore]);


  // Debounced reload triggered by realtime events (referência estável para
  // não recriar o canal realtime quando a visão muda). Janela larga: eventos
  // de todos os corretores chegam no mesmo canal e recargas frequentes faziam
  // os contadores oscilarem na tela.
  const loadRef = useRef(load);
  loadRef.current = load;
  const busyRef = useRef(false);
  const lastLoadRef = useRef(0);
  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = window.setTimeout(() => {
      // Nunca recarrega no meio de um registro de resultado.
      if (busyRef.current || loadingRef.current) {
        pendingLoadRef.current = true;
        return;
      }
      // Piso de 20s entre recargas completas: com vários corretores online os
      // eventos de tempo real chegavam em rajada e derrubavam a API.
      const waitFor = 20_000 - (Date.now() - lastLoadRef.current);
      if (waitFor > 0) {
        reloadTimerRef.current = window.setTimeout(() => {
          reloadTimerRef.current = null;
          if (busyRef.current || loadingRef.current) pendingLoadRef.current = true;
          else {
            lastLoadRef.current = Date.now();
            void loadRef.current();
          }
        }, waitFor);
        return;
      }
      lastLoadRef.current = Date.now();
      void loadRef.current();
    }, 6000);
  }, []);


  // Carga inicial + recarga quando a visão muda (um único efeito evita
  // requisições duplicadas na montagem).
  useEffect(() => {
    setLoading(true);
    setLeads([]);
    leadsLenRef.current = 0;
    cursorRef.current = null;
    lastLoadRef.current = Date.now();
    void load();
  }, [load]);

  // Canal realtime estável por usuário (não recria a cada carga).
  // Escopo por corretor: sem o filtro, cada clique de qualquer corretor da
  // empresa disparava uma recarga completa em todos os aparelhos.
  const rtBroker = isAdmin ? (brokerFilter !== "all" && brokerFilter !== "none" ? brokerFilter : null) : me?.brokerId ?? null;
  useEffect(() => {
    if (!me) return;
    const leadFilter = rtBroker ? { filter: `broker_id=eq.${rtBroker}` } : {};
    const ch = db
      .channel(`crm-leads-${me.userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_leads", ...leadFilter }, () => scheduleReload())
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_lead_attempts", ...leadFilter }, () => scheduleReload())
      .subscribe();
    const onFocus = () => {
      if (document.visibilityState === "visible") scheduleReload();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
      if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current);
      db.removeChannel(ch);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [me, scheduleReload, rtBroker]);




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
    const byMonth = monthFilter === "all" ? byView : byView.filter((l) => spMonth(l.received_at) === monthFilter);
    if (view !== "novo" || focus === "todos") return byMonth;
    return byMonth.filter((l) => {
      const p = progressOf(l.id);
      if (focus === "falta_manha") return p.manha === "pendente";
      if (focus === "falta_tarde") return p.tarde === "pendente";
      if (focus === "sem_resposta") return p.manha === "nao_atendeu" && p.tarde === "nao_atendeu";
      if (focus === "pendentes_anteriores") return p.triedBefore > 0;
      return true;
    });
  }, [leads, view, isAdmin, brokerFilter, focus, progressOf, monthFilter]);

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
    const rows = new Map<string, { id: string; name: string; color: string; manha: number; tarde: number; semResposta: number; total: number }>();
    for (const l of leads) {
      const p = progressOf(l.id);
      if (p.triedToday === 0 && p.manha === "pendente" && p.tarde === "pendente") continue;
      const key = l.broker_id ?? "none";
      const broker = brokers.find((b) => b.id === l.broker_id);
      const cur =
        rows.get(key) ??
        { id: key, name: broker?.name ?? "Sem corretor", color: broker?.color ?? "#71717a", manha: 0, tarde: 0, semResposta: 0, total: 0 };
      cur.total += 1;
      if (p.manha === "atendeu") cur.manha += 1;
      if (p.tarde === "atendeu") cur.tarde += 1;
      if (p.manha === "nao_atendeu" && p.tarde === "nao_atendeu") cur.semResposta += 1;
      rows.set(key, cur);
    }
    return [...rows.values()].sort((a, b) => b.manha + b.tarde - (a.manha + a.tarde) || a.name.localeCompare(b.name));
  }, [leads, brokers, progressOf]);

  /**
   * Ligações que DEIXARAM de ser feitas: leads ainda "novo" sem tentativa
   * registrada no período. A manhã só vira "perdida" depois das 14h e a tarde
   * depois das 22h — antes disso ainda dá tempo de ligar (fica como "restam").
   */
  const missed = useMemo(() => {
    const hour = spHour();
    const rows = new Map<
      string,
      { id: string; name: string; color: string; manhaHoje: number; tardeHoje: number; manhaAnt: number; tardeAnt: number }
    >();
    let meManhaHoje = 0, meTardeHoje = 0, meManhaAnt = 0, meTardeAnt = 0;
    for (const l of leads) {
      if (l.status !== "novo") continue;
      const p = progressOf(l.id);
      const hoje = spDate(l.received_at) === today;
      const perdeuManha = p.manha === "pendente" && (hoje ? hour >= 14 : true);
      const perdeuTarde = p.tarde === "pendente" && (hoje ? hour >= 22 : true);
      if (!perdeuManha && !perdeuTarde) continue;
      const key = l.broker_id ?? "none";
      const broker = brokers.find((b) => b.id === l.broker_id);
      const cur =
        rows.get(key) ??
        { id: key, name: broker?.name ?? "Sem corretor", color: broker?.color ?? "#71717a", manhaHoje: 0, tardeHoje: 0, manhaAnt: 0, tardeAnt: 0 };
      if (perdeuManha) hoje ? (cur.manhaHoje += 1) : (cur.manhaAnt += 1);
      if (perdeuTarde) hoje ? (cur.tardeHoje += 1) : (cur.tardeAnt += 1);
      rows.set(key, cur);
      if (me?.brokerId && l.broker_id === me.brokerId) {
        if (perdeuManha) hoje ? (meManhaHoje += 1) : (meManhaAnt += 1);
        if (perdeuTarde) hoje ? (meTardeHoje += 1) : (meTardeAnt += 1);
      }
    }
    const list = [...rows.values()].sort(
      (a, b) =>
        b.manhaHoje + b.tardeHoje + b.manhaAnt + b.tardeAnt - (a.manhaHoje + a.tardeHoje + a.manhaAnt + a.tardeAnt) ||
        a.name.localeCompare(b.name),
    );
    return {
      list,
      mine: {
        manhaHoje: meManhaHoje,
        tardeHoje: meTardeHoje,
        manhaAnt: meManhaAnt,
        tardeAnt: meTardeAnt,
        total: meManhaHoje + meTardeHoje + meManhaAnt + meTardeAnt,
      },
    };
  }, [leads, brokers, progressOf, today, me]);




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
    busyRef.current = true;
    // A chamada pode travar (oscilação de rede no celular). Sem timeout o
    // estado "ocupado" nunca era liberado e os botões ficavam inclicáveis.
    const callRpc = () =>
      Promise.race([
        db.rpc("crm_register_lead_attempt", {
          _lead_id: lead.id,
          _attended: attended,
          _result: attended ? "atendeu" : "nao_atendeu",
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("tempo esgotado")), 12_000),
        ),
      ]);

    let data: unknown = null;
    let error: { message: string } | null = null;
    try {
      const r = (await callRpc()) as { data: unknown; error: { message: string } | null };
      data = r.data;
      error = r.error;
    } catch (e1) {
      // Uma segunda tentativa cobre a queda momentânea de rede.
      try {
        const r = (await callRpc()) as { data: unknown; error: { message: string } | null };
        data = r.data;
        error = r.error;
      } catch (e2) {
        error = { message: (e2 as Error).message || (e1 as Error).message };
      }
    } finally {
      setBusy(null);
      busyRef.current = false;
    }

    if (error) {
      toast.error(`Não foi possível registrar: ${error.message}`);
      return;
    }


    // Aplica o resultado localmente na hora — o recarregamento do servidor pode
    // demorar (ou ser adiado), e sem isso a ação parecia não ter sido registrada.
    const res = (data ?? {}) as {
      period?: string;
      attempts?: number;
      status?: string;
      counted_call?: boolean;
      coverage_status?: string;
      coverage_first_called_at?: string | null;
      coverage_second_called_at?: string | null;
      coverage_expires_at?: string | null;
    };
    const usedPeriod = res.period === "manha" || res.period === "tarde" ? res.period : period;
    const localAttempt = {
      id: `local-${lead.id}-${Date.now()}`,
      lead_id: lead.id,
      period: usedPeriod,
      result: attended ? "atendeu" : "nao_atendeu",
      attempt_date: today,
      called_at: new Date().toISOString(),
    } as Attempt;
    localAttemptsRef.current = [...localAttemptsRef.current, localAttempt];
    setAttempts((prev) => [...prev, localAttempt]);
    setTotalsByLead((prev) => {
      const m = new Map(prev);
      const total = res.attempts ?? (prev.get(lead.id) ?? 0) + 1;
      m.set(lead.id, total);
      localTotalsRef.current.set(lead.id, total);
      return m;
    });
    // Cobertura de 24h: guarda o estado devolvido pelo banco para a fila não
    // repetir o mesmo lead no mesmo período.
    setCoverageByLead((prev) => {
      const m = new Map(prev);
      const concluded = res.coverage_status === "COBERTURA_CONCLUIDA";
      const next: CoverageState = {
        attempts_done: res.attempts ?? (prev.get(lead.id)?.attempts_done ?? 0),
        open_first_period: concluded ? null : usedPeriod,
        open_first_called_at: concluded ? null : res.coverage_first_called_at ?? localAttempt.called_at,
        open_expires_at: concluded ? null : res.coverage_expires_at ?? null,
        last_first_called_at: concluded
          ? res.coverage_first_called_at ?? prev.get(lead.id)?.last_first_called_at ?? null
          : prev.get(lead.id)?.last_first_called_at ?? null,
        last_second_called_at: concluded
          ? res.coverage_second_called_at ?? localAttempt.called_at
          : prev.get(lead.id)?.last_second_called_at ?? null,
        last_attempt_number: concluded ? res.attempts ?? null : prev.get(lead.id)?.last_attempt_number ?? null,
      };
      m.set(lead.id, next);
      localCoverageRef.current.set(lead.id, next);
      return m;
    });
    if (res.status && res.status !== "novo") {
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status: res.status as string } : l)));
    }
    if (res.counted_call && lead.broker_id) {
      setCallsToday((prev) => {
        const m = new Map(prev);
        m.set(lead.broker_id as string, (m.get(lead.broker_id as string) ?? 0) + 1);
        return m;
      });
    }

    toast.success(
      attended
        ? `${lead.name} atendeu — saiu dos novos`
        : res.coverage_status === "COBERTURA_CONCLUIDA"
          ? `Cobertura concluída — tentativa ${res.attempts ?? "?"} de ${COLD_AFTER_ATTEMPTS}`
          : `Ligação registrada (${usedPeriod === "manha" ? "manhã" : "tarde"}) — falta a 2ª em outro período (24h)`,
    );
    void loadCallCounts();
    // A lista não é recarregada aqui: o estado local já reflete a ação e uma
    // recarga imediata era o que fazia a fila "piscar" e trocar de lead sozinho.
    scheduleReload();
  }


  const hoje = useMemo(() => visible.filter((l) => spDate(l.received_at) === today), [visible, today]);
  const anteriores = useMemo(() => visible.filter((l) => spDate(l.received_at) !== today), [visible, today]);

  const coverageOf = useCallback(
    (id: string): CoverageState => coverageByLead.get(id) ?? EMPTY_COVERAGE,
    [coverageByLead],
  );

  /**
   * Fila do modo discagem (regra de cobertura móvel de 24h):
   * - lead com cobertura aberta iniciada em OUTRO período entra primeiro
   *   (é a 2ª ligação que fecha a tentativa, e ela expira em 24h);
   * - lead com cobertura aberta no MESMO período fica de fora (já ligou agora);
   * - demais leads novos entram para iniciar uma cobertura.
   */
  const dialQueue = useMemo<DialerLead[]>(() => {
    const nowMs = Date.now();
    const rows = novos
      .filter((l) => coverageOf(l.id).attempts_done < COLD_AFTER_ATTEMPTS)
      .filter((l) => {
        const c = coverageOf(l.id);
        const openValid = !!c.open_expires_at && new Date(c.open_expires_at).getTime() > nowMs;
        if (openValid) return c.open_first_period !== period; // mesmo período: aguarda o outro
        // Sem cobertura aberta: só entra se ainda não ligou neste período hoje.
        return progressOf(l.id)[period] === "pendente";
      })
      .map((l) => {
        const p = progressOf(l.id);
        const c = coverageOf(l.id);
        const openValid = !!c.open_expires_at && new Date(c.open_expires_at).getTime() > nowMs;
        return {
          id: l.id,
          name: l.name,
          phone: l.phone,
          source: l.source,
          received_at: l.received_at,
          brokerName: brokers.find((b) => b.id === l.broker_id)?.name ?? null,
          triedBefore: p.triedBefore,
          isToday: spDate(l.received_at) === today,
          manha: p.manha,
          tarde: p.tarde,
          totalAttempts: c.attempts_done,
          coldAfter: COLD_AFTER_ATTEMPTS,
          coverageOpen: openValid,
          coverageFirstPeriod: openValid ? c.open_first_period : null,
          coverageFirstAt: openValid ? c.open_first_called_at : null,
          coverageExpiresAt: openValid ? c.open_expires_at : null,
          lastCoverageFirstAt: c.last_first_called_at,
          lastCoverageSecondAt: c.last_second_called_at,
        } satisfies DialerLead;
      });
    // 1) coberturas abertas mais perto de expirar; 2) leads antigos; 3) do dia.
    return rows.sort((a, b) => {
      if (a.coverageOpen !== b.coverageOpen) return a.coverageOpen ? -1 : 1;
      if (a.coverageOpen && b.coverageOpen) {
        return (a.coverageExpiresAt ?? "").localeCompare(b.coverageExpiresAt ?? "");
      }
      return Number(a.isToday) - Number(b.isToday) || a.received_at.localeCompare(b.received_at);
    });
  }, [novos, progressOf, coverageOf, period, brokers, today]);


  const dialStats = useMemo(() => {
    let atendidos = 0;
    let semResposta = 0;
    for (const l of novos) {
      const p = progressOf(l.id);
      if (p.manha === "atendeu" || p.tarde === "atendeu") atendidos += 1;
      if (p.manha === "nao_atendeu" && p.tarde === "nao_atendeu") semResposta += 1;
    }
    return { atendidos, semResposta, restantes: dialQueue.length, novosHoje: todayNew.length };
  }, [novos, progressOf, dialQueue.length, todayNew.length]);

  if (mode === "dial") {
    return (
      <LeadsDialer
        queue={dialQueue}
        period={period}
        brokerName={me?.brokerName ?? "Corretor"}
        stats={dialStats}
        goal={{ done: callsToday.get(me?.brokerId ?? "") ?? 0, meta: metaDaily }}

        busy={busy !== null}
        loading={loading}
        onOutcome={async (lead, attended) => {
          const full = leads.find((l) => l.id === lead.id);
          if (full) await register(full, attended);
        }}
        onRefresh={() => void load()}
        onOpenList={() => setMode("lista")}
      />
    );
  }



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

          {lead.status === "fria" && (
            <div className="flex items-center gap-2">
              {phoneOk && (
                <a
                  href={telHref(lead.phone)}
                  target="_top"
                  className="flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white"
                  style={{ ...fontDisplay, background: "#3b82f6", boxShadow: "0 6px 16px -8px rgba(59,130,246,0.8)" }}
                >
                  <PhoneCall className="h-4 w-4" /> Ligar
                </a>
              )}
              <button
                disabled={busy === lead.id}
                onClick={async () => {
                  const { error } = await db
                    .from("crm_leads")
                    .update({ status: "novo", cold_at: null })
                    .eq("id", lead.id);
                  if (error) { toast.error(`Não foi possível reativar: ${error.message}`); return; }
                  toast.success(`${lead.name} voltou para a fila`);
                  void load(view);
                }}
                className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold disabled:opacity-50"
                style={{ background: "#fff7ed", color: "#b45309" }}
              >
                Reativar
              </button>
            </div>
          )}

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
            1 ligação na manhã (9h–14h) e 1 na tarde (14h–22h). Sai da lista quando atender.
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
            onClick={() => setMode("dial")}
            className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-white"
            style={{ background: "#3b82f6" }}
          >
            <PhoneCall className="h-4 w-4" /> Modo discagem
          </button>
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

      {/* Meta diária de ligações por corretor (conta 1 por lead após manhã + tarde) */}
      <div className="rounded-2xl bg-white p-4" style={{ border: "1px solid #e8ecf1" }}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold" style={{ ...fontDisplay, color: "#0f172a" }}>
            Meta diária de ligações
          </p>
          <span className="text-xs" style={{ color: "#64748b" }}>
            meta {metaDaily} / dia
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {(isAdmin ? brokers : brokers.filter((b) => b.id === me?.brokerId)).map((b) => {
            const done = callsToday.get(b.id) ?? 0;
            const pct = Math.min(100, Math.round((done / Math.max(1, metaDaily)) * 100));
            return (
              <div key={b.id} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-xs font-medium" style={{ color: "#334155" }}>
                  {b.name}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "#eef1f5" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: done >= metaDaily ? "#16a34a" : "#3b82f6" }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums" style={{ color: "#0f172a" }}>
                  {done}/{metaDaily}
                </span>
              </div>
            );
          })}
        </div>
      </div>


      {!isAdmin && missed.mine.total > 0 && (
        <div className="rounded-2xl p-4" style={{ background: "#fff7ed", border: "1px solid #fed7aa" }}>
          <p className="text-sm font-semibold" style={{ ...fontDisplay, color: "#9a3412" }}>
            Atenção: {missed.mine.total} ligação(ões) que você deixou de fazer
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold" style={fontNumeric}>
            <span className="rounded-full px-2 py-0.5" style={{ background: "#ffedd5", color: "#9a3412" }}>
              Hoje — manhã: {missed.mine.manhaHoje}
            </span>
            <span className="rounded-full px-2 py-0.5" style={{ background: "#ffedd5", color: "#9a3412" }}>
              Hoje — tarde: {missed.mine.tardeHoje}
            </span>
            <span className="rounded-full px-2 py-0.5" style={{ background: "#fee2e2", color: "#b91c1c" }}>
              Dias anteriores — manhã: {missed.mine.manhaAnt}
            </span>
            <span className="rounded-full px-2 py-0.5" style={{ background: "#fee2e2", color: "#b91c1c" }}>
              Dias anteriores — tarde: {missed.mine.tardeAnt}
            </span>
          </div>
          <p className="mt-2 text-xs" style={{ color: "#b45309" }}>
            A manhã conta como perdida após as 14h e a tarde após as 22h.
          </p>
        </div>
      )}



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
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          className="ml-auto h-9 max-w-[180px] rounded-full px-3 text-sm outline-none"
          style={{ background: "#f1f5f9", color: "#334155" }}
        >
          {MONTH_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        {isAdmin && (
          <select
            value={brokerFilter}
            onChange={(e) => setBrokerFilter(e.target.value)}
            className="h-9 max-w-[220px] rounded-full px-3 text-sm outline-none"
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
          {hasMore && (
            <button
              onClick={() => loadMore()}
              disabled={loadingMore}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold disabled:opacity-60"
              style={{ background: "#f1f5f9", color: "#475569" }}
            >
              <ChevronDown className="h-4 w-4" />
              {loadingMore ? "Carregando…" : "Carregar mais leads"}
            </button>
          )}
        </div>
      )}

      {isAdmin && missed.list.length > 0 && (
        <div className="rounded-2xl bg-white p-4" style={{ border: "1px solid #fed7aa" }}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold" style={{ ...fontDisplay, color: "#9a3412" }}>
              Ligações não feitas por corretor
            </p>
            <span className="text-xs" style={{ color: "#94a3b8" }}>manhã após 14h · tarde após 22h</span>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "#94a3b8" }}>
                  <th className="py-2 pr-3 font-semibold">Corretor</th>
                  <th className="py-2 pr-3 font-semibold">Hoje manhã</th>
                  <th className="py-2 pr-3 font-semibold">Hoje tarde</th>
                  <th className="py-2 pr-3 font-semibold">Ant. manhã</th>
                  <th className="py-2 pr-3 font-semibold">Ant. tarde</th>
                  <th className="py-2 font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "#f1f5f9" }}>
                {missed.list.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3" style={{ color: "#334155" }}>
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                        <span className="truncate">{r.name}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-3" style={{ ...fontNumeric, color: "#9a3412" }}>{r.manhaHoje}</td>
                    <td className="py-2 pr-3" style={{ ...fontNumeric, color: "#9a3412" }}>{r.tardeHoje}</td>
                    <td className="py-2 pr-3" style={{ ...fontNumeric, color: "#b91c1c" }}>{r.manhaAnt}</td>
                    <td className="py-2 pr-3" style={{ ...fontNumeric, color: "#b91c1c" }}>{r.tardeAnt}</td>
                    <td className="py-2 font-semibold" style={{ ...fontNumeric, color: "#0f172a" }}>
                      {r.manhaHoje + r.tardeHoje + r.manhaAnt + r.tardeAnt}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
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
          className="h-[70vh] overflow-auto rounded-xl"
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
