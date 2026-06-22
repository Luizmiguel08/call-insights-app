import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Broker = { id: string; name: string; userId?: string | null; approved?: boolean };
export type Call = {
  id: string;
  date: string;
  brokerId: string;
  client: string;
  phone?: string;
  attended: boolean;
  scheduled: boolean;
  note: string;
  createdAt: number;
  contactId?: string;
};
export type Contact = {
  id: string;
  name: string;
  phone: string;
  brokerId: string | null;
  status: "pendente" | "feito" | "pulado";
  createdAt: number;
  attempts: number;
  listName: string;
};
export type Me = {
  userId: string;
  email: string;
  isAdmin: boolean;
  brokerId: string | null;
  brokerName: string | null;
  approved: boolean;
};
export type State = { brokers: Broker[]; calls: Call[]; contacts: Contact[]; metaDaily: number };

function defaultState(): State {
  return { brokers: [], calls: [], contacts: [], metaDaily: 50 };
}

const statusLocalToDb = { pendente: "pending", feito: "done", pulado: "skipped" } as const;
const statusDbToLocal: Record<string, Contact["status"]> = { pending: "pendente", done: "feito", skipped: "pulado" };

function toLocalDate(iso: string) {
  const d = new Date(iso);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

async function loadMe(): Promise<Me | null> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  const [rolesR, brokerR] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase.from("brokers").select("id,name,approved").eq("user_id", user.id).maybeSingle(),
  ]);

  const isAdmin = (rolesR.data ?? []).some((r) => r.role === "admin");
  const hasCorretorRole = (rolesR.data ?? []).some((r) => r.role === "corretor");
  if (!isAdmin && !hasCorretorRole) {
    // Self-insert no longer allowed by RLS. Server-side function grants the
    // 'corretor' role only when an admin has already linked a broker row to
    // this user, preventing privilege escalation.
    await (supabase as any).rpc("claim_corretor_role_if_eligible");
  }

  let broker = brokerR.data;
  if (!broker && !isAdmin) {
    const metaName =
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined) ??
      user.email ??
      "Sem nome";
    const ins = await supabase
      .from("brokers")
      .insert({ name: metaName, user_id: user.id, email: user.email, approved: false })
      .select("id,name,approved")
      .single();
    if (!ins.error && ins.data) broker = ins.data;
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    isAdmin,
    brokerId: broker?.id ?? null,
    brokerName: broker?.name ?? null,
    approved: broker?.approved ?? false,
  };
}

async function loadAll(): Promise<State> {
  // Paginate contacts_queue to load ALL contacts (Supabase caps at 1000/req by default).
  async function loadAllContacts() {
    const pageSize = 1000;
    let from = 0;
    const all: any[] = [];
    // hard safety cap to avoid infinite loops
    while (from < 100000) {
      const r = await supabase
        .from("contacts_queue")
        .select("*")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (r.error) throw r.error;
      const rows = r.data ?? [];
      all.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return all;
  }

  async function loadAllCalls() {
    const pageSize = 1000;
    let from = 0;
    const all: any[] = [];
    while (from < 100000) {
      const r = await supabase
        .from("calls")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (r.error) throw r.error;
      const rows = r.data ?? [];
      all.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
    return all;
  }

  const [brokersR, callsR, contactsRows, settingsR] = await Promise.all([
    supabase.from("brokers").select("*").order("created_at"),
    loadAllCalls(),
    loadAllContacts(),
    supabase.from("app_settings").select("*").eq("id", "global").maybeSingle(),
  ]);
  const contactsR = { data: contactsRows, error: null as null };
  const callsResult = { data: callsR, error: null as null };
  if (brokersR.error) throw brokersR.error;
  if (callsResult.error) throw callsResult.error;
  if (contactsR.error) throw contactsR.error;

  const brokers: Broker[] = (brokersR.data ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    userId: b.user_id ?? null,
    approved: b.approved ?? true,
  }));
  const calls: Call[] = (callsResult.data ?? []).map((c) => ({
    id: c.id,
    date: toLocalDate(c.created_at),
    brokerId: c.broker_id,
    client: c.client_name,
    phone: c.phone ?? undefined,
    attended: c.attended,
    scheduled: c.scheduled,
    note: c.notes ?? "",
    createdAt: new Date(c.created_at).getTime(),
    contactId: c.contact_id ?? undefined,
  }));
  const contacts: Contact[] = (contactsR.data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    brokerId: c.broker_id ?? null,
    status: statusDbToLocal[c.status] ?? "pendente",
    createdAt: new Date(c.created_at).getTime(),
    attempts: c.call_attempts,
    listName: c.list_name ?? "Geral",
  }));
  return { brokers, calls, contacts, metaDaily: settingsR.data?.meta_daily ?? 50 };
}

/* ---------------- Incremental delta loaders ----------------
 * Refetch incremental usando `updated_at` como cursor:
 * em vez de baixar ~10k contatos + ~16k ligações a cada poll, buscamos
 * apenas o que mudou desde a última sincronização (`updated_at > cursor`)
 * e mesclamos no estado local por id. Reduz drasticamente o tráfego
 * (e a latência percebida) tanto no celular quanto no desktop.
 */
async function loadDeltaContactsSince(sinceIso: string | null): Promise<any[]> {
  const pageSize = 1000;
  let from = 0;
  const all: any[] = [];
  while (from < 100000) {
    let q: any = (supabase.from("contacts_queue") as any)
      .select("*")
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (sinceIso) q = q.gt("updated_at", sinceIso);
    const r = await q;
    if (r.error) throw r.error;
    const rows = (r.data ?? []) as any[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function loadDeltaCallsSince(sinceIso: string | null): Promise<any[]> {
  const pageSize = 1000;
  let from = 0;
  const all: any[] = [];
  while (from < 100000) {
    let q: any = (supabase.from("calls") as any)
      .select("*")
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (sinceIso) q = q.gt("updated_at", sinceIso);
    const r = await q;
    if (r.error) throw r.error;
    const rows = (r.data ?? []) as any[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function maxUpdatedAt(rows: any[]): string | null {
  let m: string | null = null;
  for (const r of rows) {
    const u = r?.updated_at ?? r?.created_at;
    if (u && (m === null || u > m)) m = u;
  }
  return m;
}

function diff<T extends { id: string }>(prev: T[], next: T[]) {
  const pMap = new Map(prev.map((x) => [x.id, x]));
  const nMap = new Map(next.map((x) => [x.id, x]));
  const added = next.filter((x) => !pMap.has(x.id));
  const removed = prev.filter((x) => !nMap.has(x.id));
  const changed = next.filter((x) => {
    const p = pMap.get(x.id);
    return p && JSON.stringify(p) !== JSON.stringify(x);
  });
  return { added, removed, changed };
}

async function insertInChunks(table: "contacts_queue" | "calls", rows: any[], chunkSize = 300) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await (supabase.from(table) as any).insert(chunk);
    if (error) throw error;
  }
}

async function syncTo(prev: State, next: State, me: Me) {
  // brokers — apenas admin pode mexer (RLS bloqueia os demais; ainda assim filtramos client-side)
  if (me.isAdmin) {
    const bd = diff(prev.brokers, next.brokers);
    if (bd.added.length)
      await supabase.from("brokers").insert(
        bd.added.map((b) => ({ id: b.id, name: b.name, approved: b.approved ?? true })),
      );
    for (const b of bd.changed)
      await supabase.from("brokers").update({ name: b.name, approved: b.approved ?? true }).eq("id", b.id);
    if (bd.removed.length)
      await supabase.from("brokers").delete().in("id", bd.removed.map((b) => b.id));
  } else {
    // corretor: só pode renomear o próprio (raramente usado pela UI)
    for (const b of diff(prev.brokers, next.brokers).changed) {
      if (b.userId === me.userId) await supabase.from("brokers").update({ name: b.name }).eq("id", b.id);
    }
  }

  // contacts — corretor força broker_id = seu próprio
  const cd = diff(prev.contacts, next.contacts);
  if (cd.added.length) {
    await insertInChunks(
      "contacts_queue",
      cd.added.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        broker_id: me.isAdmin ? c.brokerId : me.brokerId,
        status: statusLocalToDb[c.status],
        call_attempts: c.attempts,
        list_name: c.listName || "Geral",
      })),
    );
  }
  for (const c of cd.changed) {
    await supabase
      .from("contacts_queue")
      .update({
        name: c.name,
        phone: c.phone,
        broker_id: me.isAdmin ? c.brokerId : me.brokerId,
        status: statusLocalToDb[c.status],
        call_attempts: c.attempts,
        created_at: new Date(c.createdAt).toISOString(),
        list_name: c.listName || "Geral",
      })
      .eq("id", c.id);
  }
  if (cd.removed.length) await supabase.from("contacts_queue").delete().in("id", cd.removed.map((c) => c.id));

  // calls
  const kd = diff(prev.calls, next.calls);
  if (kd.added.length) {
    await insertInChunks(
      "calls",
      kd.added.map((c) => ({
        id: c.id,
        broker_id: me.isAdmin ? c.brokerId : (me.brokerId ?? c.brokerId),
        client_name: c.client,
        phone: c.phone ?? null,
        attended: c.attended,
        scheduled: c.scheduled,
        notes: c.note || null,
        contact_id: c.contactId ?? null,
      })),
    );
  }
  for (const c of kd.changed) {
    await supabase
      .from("calls")
      .update({
        client_name: c.client,
        phone: c.phone ?? null,
        attended: c.attended,
        scheduled: c.scheduled,
        notes: c.note || null,
      })
      .eq("id", c.id);
  }
  if (kd.removed.length) await supabase.from("calls").delete().in("id", kd.removed.map((c) => c.id));

  // meta — só admin
  if (me.isAdmin && prev.metaDaily !== next.metaDaily) {
    await supabase.from("app_settings").upsert({ id: "global", meta_daily: next.metaDaily });
  }
}

export function useCloudState() {
  const [state, setStateRaw] = useState<State>(() => defaultState());
  const [me, setMe] = useState<Me | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const lastSyncedRef = useRef<State>(defaultState());
  const meRef = useRef<Me | null>(null);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncSeqRef = useRef(0);
  const muteUntilRef = useRef(0);
  const dirtyRef = useRef(false);
  const refetchInFlightRef = useRef(false);
  const queuedRefetchRef = useRef(false);

  const setState = useCallback<React.Dispatch<React.SetStateAction<State>>>((value) => {
    dirtyRef.current = true;
    setStateRaw(value);
  }, []);

  const refetch = useCallback(async () => {
    // Ignora ecos do realtime logo após uma escrita local pra evitar "piscar"
    // o estado antigo sobre a atualização otimista.
    if (Date.now() < muteUntilRef.current) return;
    if (pendingTimer.current) return;
    if (dirtyRef.current) return;
    if (refetchInFlightRef.current) {
      queuedRefetchRef.current = true;
      return;
    }
    refetchInFlightRef.current = true;
    try {
      const s = await loadAll();
      lastSyncedRef.current = s;
      dirtyRef.current = false;
      setStateRaw(s);
    } finally {
      refetchInFlightRef.current = false;
      if (queuedRefetchRef.current) {
        queuedRefetchRef.current = false;
        void refetch();
      }
    }
  }, []);

  const scheduleRefetch = useCallback(() => {
    if (Date.now() < muteUntilRef.current) return;
    if (pendingTimer.current || dirtyRef.current) return;
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      refetchTimerRef.current = null;
      void refetch();
    }, 80);
  }, [refetch]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await loadMe();
        if (!alive) return;
        meRef.current = m;
        setMe(m);
        const s = await loadAll();
        if (!alive) return;
        lastSyncedRef.current = s;
        setStateRaw(s);
        setHydrated(true);
      } catch (e) {
        console.error("Falha ao carregar dados", e);
        setHydrated(true);
      }
    })();

    function rowToContact(c: any): Contact {
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        brokerId: c.broker_id ?? null,
        status: statusDbToLocal[c.status] ?? "pendente",
        createdAt: new Date(c.created_at).getTime(),
        attempts: c.call_attempts ?? 0,
        listName: c.list_name ?? "Geral",
      };
    }
    function rowToCall(c: any): Call {
      return {
        id: c.id,
        date: toLocalDate(c.created_at),
        brokerId: c.broker_id,
        client: c.client_name,
        phone: c.phone ?? undefined,
        attended: c.attended,
        scheduled: c.scheduled,
        note: c.notes ?? "",
        createdAt: new Date(c.created_at).getTime(),
        contactId: c.contact_id ?? undefined,
      };
    }
    function patchState(updater: (s: State) => State) {
      setStateRaw((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        lastSyncedRef.current = next;
        return next;
      });
    }
    function onContactChange(payload: any) {
      if (Date.now() < muteUntilRef.current) { scheduleRefetch(); return; }
      const evt = payload.eventType;
      if (evt === "DELETE") {
        const oldId = payload.old?.id;
        if (!oldId) return;
        patchState((s) => ({ ...s, contacts: s.contacts.filter((c) => c.id !== oldId) }));
        return;
      }
      const row = payload.new;
      if (!row?.id) return;
      const mapped = rowToContact(row);
      patchState((s) => {
        const idx = s.contacts.findIndex((c) => c.id === mapped.id);
        if (idx === -1) return { ...s, contacts: [...s.contacts, mapped] };
        const cur = s.contacts[idx];
        if (
          cur.status === mapped.status &&
          cur.attempts === mapped.attempts &&
          cur.brokerId === mapped.brokerId &&
          cur.name === mapped.name &&
          cur.phone === mapped.phone &&
          cur.listName === mapped.listName
        ) return s;
        const arr = s.contacts.slice();
        arr[idx] = { ...cur, ...mapped };
        return { ...s, contacts: arr };
      });
    }
    function onCallChange(payload: any) {
      if (Date.now() < muteUntilRef.current) { scheduleRefetch(); return; }
      const evt = payload.eventType;
      if (evt === "DELETE") {
        const oldId = payload.old?.id;
        if (!oldId) return;
        patchState((s) => ({ ...s, calls: s.calls.filter((c) => c.id !== oldId) }));
        return;
      }
      const row = payload.new;
      if (!row?.id) return;
      const mapped = rowToCall(row);
      patchState((s) => {
        const idx = s.calls.findIndex((c) => c.id === mapped.id);
        if (idx === -1) return { ...s, calls: [mapped, ...s.calls] };
        const arr = s.calls.slice();
        arr[idx] = { ...arr[idx], ...mapped };
        return { ...s, calls: arr };
      });
    }

    let currentChannel: ReturnType<typeof supabase.channel> | null = null;
    function subscribeRealtime() {
      const ch = supabase
        .channel(`ligactrl-sync-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "brokers" }, scheduleRefetch)
        .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, onCallChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "contacts_queue" }, onContactChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, scheduleRefetch)
        .subscribe();
      currentChannel = ch;
      return ch;
    }
    subscribeRealtime();

    // Refetch imediato (ignora mute) usado em foco/visibilidade/online — mobile
    // costuma perder o WebSocket quando a tela apaga; reentrar precisa de
    // sincronia rápida sem esperar o backoff de 80ms.
    async function forceRefetchNow() {
      if (refetchInFlightRef.current) { queuedRefetchRef.current = true; return; }
      if (pendingTimer.current || dirtyRef.current) return;
      refetchInFlightRef.current = true;
      try {
        const s = await loadAll();
        lastSyncedRef.current = s;
        dirtyRef.current = false;
        setStateRaw(s);
      } catch (e) {
        console.warn("forceRefetchNow falhou", e);
      } finally {
        refetchInFlightRef.current = false;
        if (queuedRefetchRef.current) { queuedRefetchRef.current = false; void refetch(); }
      }
    }

    function resyncAfterWake() {
      // Recria o canal pra forçar reconexão do WebSocket após sleep do mobile.
      if (currentChannel) { void supabase.removeChannel(currentChannel); currentChannel = null; }
      subscribeRealtime();
      void forceRefetchNow();
    }

    const onFocus = () => resyncAfterWake();
    const onVisibility = () => { if (document.visibilityState === "visible") resyncAfterWake(); };
    const onOnline = () => resyncAfterWake();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);

    return () => {
      alive = false;
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      if (currentChannel) void supabase.removeChannel(currentChannel);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);

    };
  }, [scheduleRefetch]);

  useEffect(() => {
    if (!hydrated || !meRef.current) return;
    if (!dirtyRef.current) return;
    // Silencia ecos do realtime brevemente ao alterar estado local
    // pra evitar piscadas, mas curto o suficiente pra não atrasar
    // a sincronização com ações do servidor (ex: triggers de RPC).
    muteUntilRef.current = Date.now() + 120;
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    const prev = lastSyncedRef.current;
    pendingTimer.current = setTimeout(() => {
      const next = state;
      const syncSeq = ++syncSeqRef.current;
      lastSyncedRef.current = next;
      dirtyRef.current = false;
      pendingTimer.current = null;
      // Re-arma o mute pra cobrir a janela de gravação + eco do servidor.
      muteUntilRef.current = Date.now() + 120;
      void syncTo(prev, next, meRef.current!)
        .then(() => {
          if (syncSeq !== syncSeqRef.current) return;
        })
        .catch((e) => {
          console.error("Falha ao salvar na nuvem", e);
          void scheduleRefetch();
        });
    }, 30);
    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
  }, [state, hydrated, scheduleRefetch]);



  // Visão filtrada: corretor só vê o próprio broker, contatos e ligações.
  // Admin vê tudo, mas seletores escondem pendentes (CorretoresTab usa fullState).
  // Admins listados aqui agem como corretor no discador (veem apenas
  // a própria fila/ligações), mas mantêm os poderes de admin nas demais abas.
  const SCOPED_ADMIN_USER_IDS = new Set<string>([
    "b83e1206-282b-4317-9c88-f1c9cf891408", // Alyson Inacio
    "f27737e1-eeb9-465f-beb7-2e0fee7f9bf8", // Nickolas
  ]);

  const view: State = (() => {
    if (!me) return state;
    if (me.isAdmin) {
      const myBrokerId = me.brokerId;
      if (myBrokerId && SCOPED_ADMIN_USER_IDS.has(me.userId)) {
        const myBroker = state.brokers.find((b) => b.id === myBrokerId);
        return {
          ...state,
          brokers: myBroker ? [myBroker] : [],
          contacts: state.contacts.filter((c) => c.brokerId === myBrokerId),
          calls: state.calls.filter((c) => c.brokerId === myBrokerId),
        };
      }
      return { ...state, brokers: state.brokers.filter((b) => b.approved !== false) };
    }
    const myBrokerId = me.brokerId;
    const myBroker = state.brokers.find((b) => b.id === myBrokerId);
    return {
      ...state,
      brokers: myBroker ? [myBroker] : [],
      contacts: state.contacts.filter((c) => c.brokerId === myBrokerId),
      calls: state.calls.filter((c) => c.brokerId === myBrokerId),
    };
  })();

  return { state: view, fullState: state, setState, hydrated, me, refetch };
}

export function newId() {
  return crypto.randomUUID();
}
