import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Flame, Link2, PhoneCall, RefreshCw, Snowflake, Sun, Sunset, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Me } from "@/lib/cloud-state";
import { fontDisplay, fontNumeric, inputCls, telHref, normalizePhone } from "@/lib/dialer-shared";

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

export default function LeadsTab({ me, isAdmin }: { me: Me | null; isAdmin: boolean }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [view, setView] = useState<"novo" | "atendido" | "fria">("novo");
  const [brokerFilter, setBrokerFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const today = spToday();
  const period = currentPeriod();

  const load = useCallback(async () => {
    const [leadsR, attemptsR, brokersR] = await Promise.all([
      db.from("crm_leads").select("*").order("received_at", { ascending: false }).limit(1000),
      db.from("crm_lead_attempts").select("*").eq("attempt_date", today),
      db.from("brokers").select("id,name,color,email").order("name"),
    ]);
    if (leadsR.error) toast.error(`Falha ao carregar leads: ${leadsR.error.message}`);
    setLeads((leadsR.data ?? []) as Lead[]);
    setAttempts((attemptsR.data ?? []) as Attempt[]);
    setBrokers((brokersR.data ?? []) as Broker[]);
    setLoading(false);
  }, [today]);

  useEffect(() => {
    void load();
    const ch = db
      .channel(`crm-leads-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_leads" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_lead_attempts" }, () => void load())
      .subscribe();
    const onFocus = () => void load();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      db.removeChannel(ch);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);

  const attemptsByLead = useMemo(() => {
    const map = new Map<string, { manha: number; tarde: number }>();
    for (const a of attempts) {
      const cur = map.get(a.lead_id) ?? { manha: 0, tarde: 0 };
      if (a.period === "manha") cur.manha += 1;
      else cur.tarde += 1;
      map.set(a.lead_id, cur);
    }
    return map;
  }, [attempts]);

  const visible = useMemo(() => {
    return leads.filter((l) => {
      if (l.status !== view) return false;
      if (isAdmin && brokerFilter !== "all") {
        if (brokerFilter === "none") return !l.broker_id;
        return l.broker_id === brokerFilter;
      }
      return true;
    });
  }, [leads, view, isAdmin, brokerFilter]);

  const todayNew = useMemo(
    () => leads.filter((l) => l.status === "novo" && spDate(l.received_at) === today),
    [leads, today],
  );
  const pendingPeriod = useMemo(
    () => visible.filter((l) => (attemptsByLead.get(l.id)?.[period] ?? 0) === 0).length,
    [visible, attemptsByLead, period],
  );

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

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-zinc-800 bg-[#13151e] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold uppercase tracking-wider text-[#c9a84c]" style={fontDisplay}>
              Leads C2S
            </h2>
            <p className="text-xs text-zinc-500">
              Cada lead novo precisa de 1 ligação na manhã (9h–12h) e 1 na tarde (14h–19h). Sai daqui só quando atender; após 7 dias vai para Fria.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                onClick={() => void syncNow()}
                disabled={syncing}
                className="flex h-9 items-center gap-2 rounded-md bg-[#c9a84c] px-3 text-xs font-bold uppercase tracking-wider text-[#0c0e14] disabled:opacity-60"
                style={fontDisplay}
              >
                <Link2 className="h-3.5 w-3.5" /> {syncing ? "Sincronizando…" : "Sincronizar C2S"}
              </button>
            )}
            <button
              onClick={() => void load()}
              className="flex h-9 items-center gap-2 rounded-md border border-zinc-700 px-3 text-xs font-bold uppercase tracking-wider text-zinc-300 hover:border-[#c9a84c]/60 hover:text-[#c9a84c]"
              style={fontDisplay}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Atualizar
            </button>
          </div>

        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Novos hoje" value={todayNew.length} icon={Flame} />
          <Stat
            label={period === "manha" ? "Faltam na manhã" : "Faltam na tarde"}
            value={pendingPeriod}
            icon={period === "manha" ? Sun : Sunset}
          />
          <Stat label="Atendidos" value={leads.filter((l) => l.status === "atendido").length} icon={Check} />
          <Stat label="Frias" value={leads.filter((l) => l.status === "fria").length} icon={Snowflake} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(["novo", "atendido", "fria"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`h-9 rounded-md px-3 text-xs font-bold uppercase tracking-wider ${
                view === v ? "bg-[#c9a84c] text-[#0c0e14]" : "border border-zinc-700 text-zinc-400 hover:text-zinc-200"
              }`}
              style={fontDisplay}
            >
              {v === "novo" ? "Novos" : v === "atendido" ? "Atendidos" : "Fria"}
            </button>
          ))}
          {isAdmin && (
            <select value={brokerFilter} onChange={(e) => setBrokerFilter(e.target.value)} className={`${inputCls} ml-auto max-w-[220px]`}>
              <option value="all" className="bg-[#13151e]">Todos os corretores</option>
              <option value="none" className="bg-[#13151e]">Sem corretor vinculado</option>
              {brokers.map((b) => (
                <option key={b.id} value={b.id} className="bg-[#13151e]">{b.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-zinc-500">Carregando leads…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-[#13151e] py-12 text-center text-sm text-zinc-500">
          Nenhum lead nessa visualização.
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((lead) => {
            const a = attemptsByLead.get(lead.id) ?? { manha: 0, tarde: 0 };
            const broker = brokers.find((b) => b.id === lead.broker_id);
            const age = daysSince(lead.received_at);
            const phoneOk = normalizePhone(lead.phone).length >= 10;
            return (
              <div key={lead.id} className="rounded-2xl border border-zinc-800 bg-[#13151e] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-semibold text-zinc-100">{lead.name}</p>
                      {lead.source && (
                        <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-400">
                          {lead.source}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                      <span style={fontNumeric}>{lead.phone || "sem telefone"}</span>
                      {lead.email && <span>{lead.email}</span>}
                      {broker ? (
                        <span className="flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: broker.color }} />
                          {broker.name}
                        </span>
                      ) : (
                        <span className="italic text-amber-400">
                          sem corretor {lead.c2s_broker_alias ? `(C2S: ${lead.c2s_broker_alias})` : ""}
                        </span>
                      )}
                      <span>{age === 0 ? "recebido hoje" : `há ${age} dia(s)`}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <PeriodPill label="Manhã" done={a.manha > 0} icon={Sun} active={period === "manha"} />
                      <PeriodPill label="Tarde" done={a.tarde > 0} icon={Sunset} active={period === "tarde"} />
                    </div>
                  </div>

                  {lead.status === "novo" && (
                    <div className="flex flex-wrap items-center gap-2">
                      {phoneOk ? (
                        <a
                          href={telHref(lead.phone)}
                          target="_top"
                          className="flex h-10 items-center gap-2 rounded-md bg-[#c9a84c] px-4 text-xs font-bold uppercase tracking-wider text-[#0c0e14]"
                          style={fontDisplay}
                        >
                          <PhoneCall className="h-4 w-4" /> Ligar
                        </a>
                      ) : (
                        <span className="text-xs text-red-400">telefone inválido</span>
                      )}
                      <button
                        disabled={busy === lead.id}
                        onClick={() => void register(lead, true)}
                        className="flex h-10 items-center gap-2 rounded-md border border-emerald-600/60 px-3 text-xs font-bold uppercase tracking-wider text-emerald-400 hover:bg-emerald-600/10 disabled:opacity-50"
                        style={fontDisplay}
                      >
                        <Check className="h-4 w-4" /> Atendeu
                      </button>
                      <button
                        disabled={busy === lead.id}
                        onClick={() => void register(lead, false)}
                        className="flex h-10 items-center gap-2 rounded-md border border-zinc-700 px-3 text-xs font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                        style={fontDisplay}
                      >
                        <X className="h-4 w-4" /> Não atendeu
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isAdmin && <AliasManager brokers={brokers} leads={leads} onChange={load} />}
    </div>
  );
}

function spDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SP_TZ }).format(new Date(iso));
}

function Stat({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Flame }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-[#0f1119] p-3">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-zinc-100" style={fontNumeric}>{value}</div>
    </div>
  );
}

function PeriodPill({ label, done, active, icon: Icon }: { label: string; done: boolean; active: boolean; icon: typeof Sun }) {
  return (
    <span
      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
        done
          ? "border-emerald-600/50 text-emerald-400"
          : active
            ? "border-[#c9a84c]/60 text-[#c9a84c]"
            : "border-zinc-700 text-zinc-500"
      }`}
    >
      <Icon className="h-3 w-3" /> {label} {done ? "✓" : "—"}
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
    <div className="rounded-2xl border border-zinc-800 bg-[#13151e] p-4 sm:p-5">
      <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-[#c9a84c]" style={fontDisplay}>
        <Link2 className="h-4 w-4" /> Apelidos do C2S → corretores
      </h3>
      <p className="mt-1 text-xs text-zinc-500">
        O vínculo é automático pelo e-mail do corretor. Use esta tabela apenas quando o e-mail do C2S for diferente do cadastrado aqui.
      </p>

      {unmapped.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-600/40 bg-amber-500/5 p-3 text-xs text-amber-300">
          Sem vínculo: {unmapped.map(([, label]) => label).join(", ")}
        </div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Apelido no C2S" className={inputCls} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail no C2S" className={inputCls} />
        <select value={brokerId} onChange={(e) => setBrokerId(e.target.value)} className={inputCls}>
          <option value="" className="bg-[#13151e]">Corretor daqui…</option>
          {brokers.map((b) => (
            <option key={b.id} value={b.id} className="bg-[#13151e]">{b.name}</option>
          ))}
        </select>
        <button onClick={() => void save()} className="h-10 rounded-md bg-[#c9a84c] text-xs font-bold uppercase tracking-wider text-[#0c0e14]" style={fontDisplay}>
          Vincular
        </button>
      </div>

      {rows.length > 0 && (
        <div className="mt-3 divide-y divide-zinc-800 text-xs">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 py-2">
              <span className="text-zinc-300">
                {r.c2s_alias ?? r.c2s_email} → {brokers.find((b) => b.id === r.broker_id)?.name ?? "—"}
              </span>
              <button onClick={() => void remove(r.id)} className="text-zinc-500 hover:text-red-400">remover</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
