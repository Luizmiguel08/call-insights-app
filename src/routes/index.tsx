import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Phone, History, BarChart3, Users, Trash2, Plus, Check, X, Calendar, UserCircle2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LIGACTRL — Controle de Ligações" },
      { name: "description", content: "Sistema de controle de ligações para corretores imobiliários." },
    ],
  }),
  component: LigaCtrlApp,
});

type Broker = { id: string; name: string };
type Call = {
  id: string;
  date: string; // YYYY-MM-DD
  brokerId: string;
  client: string;
  attended: boolean;
  scheduled: boolean;
  note: string;
  createdAt: number;
};

const STORAGE_KEY = "ligactrl:v1";
const DEFAULT_BROKERS: Broker[] = [
  { id: "b-miguel", name: "Miguel" },
  { id: "b-carlos", name: "Carlos" },
  { id: "b-ana", name: "Ana" },
  { id: "b-fernanda", name: "Fernanda" },
];

type State = { brokers: Broker[]; calls: Call[] };

function loadState(): State {
  if (typeof window === "undefined") return { brokers: DEFAULT_BROKERS, calls: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { brokers: DEFAULT_BROKERS, calls: [] };
    const parsed = JSON.parse(raw) as State;
    if (!parsed.brokers?.length) parsed.brokers = DEFAULT_BROKERS;
    return parsed;
  } catch {
    return { brokers: DEFAULT_BROKERS, calls: [] };
  }
}

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

type Tab = "registrar" | "historico" | "dashboard" | "corretores";

function LigaCtrlApp() {
  const [state, setState] = useState<State>(() => ({ brokers: DEFAULT_BROKERS, calls: [] }));
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<Tab>("registrar");

  useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  const tabs: { id: Tab; label: string; icon: typeof Phone }[] = [
    { id: "registrar", label: "Registrar", icon: Phone },
    { id: "historico", label: "Histórico", icon: History },
    { id: "dashboard", label: "Dashboard", icon: BarChart3 },
    { id: "corretores", label: "Corretores", icon: Users },
  ];

  return (
    <div className="min-h-screen bg-[#0f1117] text-zinc-100" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <header className="border-b border-zinc-800/80 bg-[#0b0d13]/80 backdrop-blur sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#f97316] shadow-[0_0_24px_-6px_#f97316]">
              <Phone className="h-5 w-5 text-black" strokeWidth={2.5} />
            </div>
            <div className="leading-none">
              <div className="font-bold tracking-[0.18em] text-xl" style={fontDisplay}>LIGACTRL</div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500 mt-1">Controle de Ligações</div>
            </div>
          </div>
          <div className="text-right text-xs uppercase tracking-widest text-zinc-500">
            <div>{new Date().toLocaleDateString("pt-BR", { weekday: "long" })}</div>
            <div className="text-zinc-300 font-semibold">{new Date().toLocaleDateString("pt-BR")}</div>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-2 sm:px-4">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold uppercase tracking-wider border-b-2 transition-colors ${
                  active
                    ? "border-[#f97316] text-[#f97316]"
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

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {tab === "registrar" && <RegistrarTab state={state} setState={setState} />}
        {tab === "historico" && <HistoricoTab state={state} setState={setState} />}
        {tab === "dashboard" && <DashboardTab state={state} />}
        {tab === "corretores" && <CorretoresTab state={state} setState={setState} />}
      </main>
    </div>
  );
}

const fontDisplay = { fontFamily: "'Barlow Condensed', 'Space Grotesk', sans-serif" } as const;

/* ---------------- REGISTRAR ---------------- */

function RegistrarTab({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const [date, setDate] = useState(todayISO());
  const [brokerId, setBrokerId] = useState(state.brokers[0]?.id ?? "");
  const [client, setClient] = useState("");
  const [attended, setAttended] = useState<boolean | null>(null);
  const [scheduled, setScheduled] = useState<boolean | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!brokerId && state.brokers[0]) setBrokerId(state.brokers[0].id);
  }, [state.brokers, brokerId]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!brokerId) return toast.error("Selecione um corretor");
    if (!client.trim()) return toast.error("Informe o nome do cliente");
    if (attended === null) return toast.error("Marque se atendeu");
    if (scheduled === null) return toast.error("Marque se agendou");

    const call: Call = {
      id: uid(),
      date,
      brokerId,
      client: client.trim(),
      attended,
      scheduled,
      note: note.trim(),
      createdAt: Date.now(),
    };
    setState((s) => ({ ...s, calls: [call, ...s.calls] }));
    toast.success("Ligação registrada", { description: `${client.trim()} · ${state.brokers.find(b => b.id === brokerId)?.name}` });
    setClient("");
    setAttended(null);
    setScheduled(null);
    setNote("");
  }

  const dayCalls = state.calls.filter((c) => c.brokerId === brokerId && c.date === date);
  const k = {
    total: dayCalls.length,
    attended: dayCalls.filter((c) => c.attended).length,
    notAttended: dayCalls.filter((c) => !c.attended).length,
    scheduled: dayCalls.filter((c) => c.scheduled).length,
  };
  const brokerName = state.brokers.find((b) => b.id === brokerId)?.name ?? "—";

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="rounded-lg border border-zinc-800 bg-[#171a23] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
        <h2 className="mb-5 text-2xl font-bold uppercase tracking-wider" style={fontDisplay}>Nova Ligação</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Data">
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={inputCls + " pl-9"}
              />
            </div>
          </Field>

          <Field label="Corretor">
            <div className="relative">
              <UserCircle2 className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <select value={brokerId} onChange={(e) => setBrokerId(e.target.value)} className={inputCls + " pl-9 appearance-none"}>
                {state.brokers.map((b) => (
                  <option key={b.id} value={b.id} className="bg-[#171a23]">{b.name}</option>
                ))}
              </select>
            </div>
          </Field>

          <Field label="Cliente" className="sm:col-span-2">
            <input
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="Nome do cliente"
              className={inputCls}
            />
          </Field>

          <Field label="Atendeu?">
            <YesNo value={attended} onChange={setAttended} />
          </Field>

          <Field label="Agendou?">
            <YesNo value={scheduled} onChange={setScheduled} />
          </Field>

          <Field label="Observação (opcional)" className="sm:col-span-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Detalhes da ligação..."
              className={inputCls + " resize-none"}
            />
          </Field>
        </div>

        <button
          type="submit"
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-[#f97316] py-3 text-sm font-bold uppercase tracking-[0.2em] text-black shadow-[0_0_24px_-6px_#f97316] transition hover:bg-[#fb8a3d] active:scale-[0.99]"
          style={fontDisplay}
        >
          <Phone className="h-4 w-4" strokeWidth={2.5} />
          Registrar Ligação
        </button>
      </form>

      <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-6">
        <div className="mb-4 flex items-end justify-between flex-wrap gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-zinc-500">Resumo do dia</div>
            <h3 className="text-xl font-bold uppercase tracking-wider text-zinc-100" style={fontDisplay}>
              {brokerName} · {new Date(date + "T00:00").toLocaleDateString("pt-BR")}
            </h3>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Ligações" value={k.total} color="#f97316" />
          <Kpi label="Atendidas" value={k.attended} color="#22c55e" />
          <Kpi label="Não atend." value={k.notAttended} color="#ef4444" />
          <Kpi label="Agendadas" value={k.scheduled} color="#eab308" />
        </div>
      </div>
    </div>
  );
}

/* ---------------- HISTÓRICO ---------------- */

function HistoricoTab({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const [date, setDate] = useState("");
  const [brokerId, setBrokerId] = useState("");

  const filtered = state.calls
    .filter((c) => (date ? c.date === date : true))
    .filter((c) => (brokerId ? c.brokerId === brokerId : true));

  function remove(id: string) {
    if (!confirm("Excluir esta ligação?")) return;
    setState((s) => ({ ...s, calls: s.calls.filter((c) => c.id !== id) }));
    toast.success("Ligação excluída");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-4 flex flex-wrap gap-3 items-end">
        <Field label="Data" className="min-w-[180px]">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Corretor" className="min-w-[200px]">
          <select value={brokerId} onChange={(e) => setBrokerId(e.target.value)} className={inputCls + " appearance-none"}>
            <option value="" className="bg-[#171a23]">Todos</option>
            {state.brokers.map((b) => (
              <option key={b.id} value={b.id} className="bg-[#171a23]">{b.name}</option>
            ))}
          </select>
        </Field>
        <button
          onClick={() => { setDate(""); setBrokerId(""); }}
          className="h-10 rounded-md border border-zinc-700 px-4 text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
          style={fontDisplay}
        >
          Limpar
        </button>
        <div className="ml-auto text-xs uppercase tracking-widest text-zinc-500" style={fontDisplay}>
          {filtered.length} registro{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-[#171a23]">
        <table className="w-full text-sm">
          <thead className="bg-[#0f1117] text-[11px] uppercase tracking-[0.18em] text-zinc-500" style={fontDisplay}>
            <tr>
              <Th>Data</Th><Th>Corretor</Th><Th>Cliente</Th>
              <Th>Atendeu</Th><Th>Agendou</Th><Th>Observação</Th><Th className="w-10"></Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="py-10 text-center text-zinc-500">Nenhuma ligação registrada.</td></tr>
            )}
            {filtered.map((c) => {
              const b = state.brokers.find((x) => x.id === c.brokerId);
              return (
                <tr key={c.id} className="border-t border-zinc-800/80 hover:bg-zinc-900/40">
                  <Td className="tabular-nums">{new Date(c.date + "T00:00").toLocaleDateString("pt-BR")}</Td>
                  <Td className="font-semibold text-zinc-100">{b?.name ?? "—"}</Td>
                  <Td>{c.client}</Td>
                  <Td><Badge ok={c.attended} /></Td>
                  <Td><Badge ok={c.scheduled} /></Td>
                  <Td className="max-w-[280px] truncate text-zinc-400" title={c.note}>{c.note || "—"}</Td>
                  <Td>
                    <button onClick={() => remove(c.id)} className="rounded p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
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

  const k = {
    total: calls.length,
    attended: calls.filter((c) => c.attended).length,
    notAttended: calls.filter((c) => !c.attended).length,
    scheduled: calls.filter((c) => c.scheduled).length,
  };
  const rate = k.total ? Math.round((k.scheduled / k.total) * 100) : 0;

  const ranking = state.brokers.map((b) => {
    const own = calls.filter((c) => c.brokerId === b.id);
    const att = own.filter((c) => c.attended).length;
    const sch = own.filter((c) => c.scheduled).length;
    return {
      broker: b,
      total: own.length,
      attended: att,
      scheduled: sch,
      rate: own.length ? Math.round((sch / own.length) * 100) : 0,
    };
  }).sort((a, b) => b.total - a.total);

  const max = Math.max(1, ...ranking.map((r) => r.total));

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
        <Kpi label="Ligações" value={k.total} color="#f97316" />
        <Kpi label="Atendidas" value={k.attended} color="#22c55e" />
        <Kpi label="Não atend." value={k.notAttended} color="#ef4444" />
        <Kpi label="Agendamentos" value={k.scheduled} color="#eab308" />
        <Kpi label="Taxa Agend." value={`${rate}%`} color="#f97316" />
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
                        i === 0 ? "bg-[#f97316] text-black" : i === 1 ? "bg-zinc-700 text-zinc-100" : i === 2 ? "bg-zinc-800 text-zinc-300" : "bg-zinc-900 text-zinc-500"
                      }`}
                      style={fontDisplay}
                    >{i + 1}</span>
                  </Td>
                  <Td className="font-semibold text-zinc-100">{r.broker.name}</Td>
                  <Td className="text-right tabular-nums text-2xl font-bold" style={fontDisplay}>{r.total}</Td>
                  <Td>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-[#f97316] transition-all" style={{ width: `${(r.total / max) * 100}%` }} />
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums text-emerald-400">{r.attended}</Td>
                  <Td className="text-right tabular-nums text-yellow-400">{r.scheduled}</Td>
                  <Td className="text-right tabular-nums font-semibold text-[#f97316]">{r.rate}%</Td>
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

/* ---------------- CORRETORES ---------------- */

function CorretoresTab({ state, setState }: { state: State; setState: React.Dispatch<React.SetStateAction<State>> }) {
  const [name, setName] = useState("");

  function add(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (state.brokers.some((b) => b.name.toLowerCase() === n.toLowerCase())) {
      return toast.error("Corretor já existe");
    }
    setState((s) => ({ ...s, brokers: [...s.brokers, { id: uid(), name: n }] }));
    toast.success("Corretor adicionado");
    setName("");
  }

  function remove(id: string) {
    const broker = state.brokers.find((b) => b.id === id);
    const count = state.calls.filter((c) => c.brokerId === id).length;
    const msg = count ? `Remover ${broker?.name}? ${count} ligação(ões) também serão excluídas.` : `Remover ${broker?.name}?`;
    if (!confirm(msg)) return;
    setState((s) => ({
      ...s,
      brokers: s.brokers.filter((b) => b.id !== id),
      calls: s.calls.filter((c) => c.brokerId !== id),
    }));
    toast.success("Corretor removido");
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="rounded-lg border border-zinc-800 bg-[#171a23] p-4 flex gap-3 items-end flex-wrap">
        <Field label="Novo corretor" className="flex-1 min-w-[240px]">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do corretor" className={inputCls} />
        </Field>
        <button
          type="submit"
          className="flex h-10 items-center gap-2 rounded-md bg-[#f97316] px-5 text-sm font-bold uppercase tracking-wider text-black hover:bg-[#fb8a3d]"
          style={fontDisplay}
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} /> Adicionar
        </button>
      </form>

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
            {state.brokers.map((b) => {
              const own = state.calls.filter((c) => c.brokerId === b.id);
              const sch = own.filter((c) => c.scheduled).length;
              return (
                <tr key={b.id} className="border-t border-zinc-800/80 hover:bg-zinc-900/40">
                  <Td className="font-semibold text-zinc-100">{b.name}</Td>
                  <Td className="text-right tabular-nums text-xl font-bold" style={fontDisplay}>{own.length}</Td>
                  <Td className="text-right tabular-nums text-xl font-bold text-yellow-400" style={fontDisplay}>{sch}</Td>
                  <Td>
                    <button onClick={() => remove(b.id)} className="rounded p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Td>
                </tr>
              );
            })}
            {state.brokers.length === 0 && (
              <tr><td colSpan={4} className="py-10 text-center text-zinc-500">Nenhum corretor cadastrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Atoms ---------------- */

const inputCls =
  "h-10 w-full rounded-md border border-zinc-700 bg-[#0f1117] px-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#f97316]/30";

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
    <div className="rounded-lg border border-zinc-800 bg-[#0f1117] p-4">
      <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500" style={fontDisplay}>{label}</div>
      <div className="mt-1 text-4xl font-extrabold tabular-nums leading-none" style={{ ...fontDisplay, color }}>{value}</div>
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
