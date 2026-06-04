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
    await supabase.from("user_roles").insert({ user_id: user.id, role: "corretor" });
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
  const contacts: Contact[] = (contactsR.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    brokerId: c.broker_id ?? null,
    status: statusDbToLocal[c.status] ?? "pendente",
    createdAt: new Date(c.created_at).getTime(),
    attempts: c.call_attempts,
  }));
  return { brokers, calls, contacts, metaDaily: settingsR.data?.meta_daily ?? 50 };
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
    await supabase.from("contacts_queue").insert(
      cd.added.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        broker_id: me.isAdmin ? c.brokerId : me.brokerId,
        status: statusLocalToDb[c.status],
        call_attempts: c.attempts,
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
      })
      .eq("id", c.id);
  }
  if (cd.removed.length) await supabase.from("contacts_queue").delete().in("id", cd.removed.map((c) => c.id));

  // calls
  const kd = diff(prev.calls, next.calls);
  if (kd.added.length) {
    await supabase.from("calls").insert(
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

  const refetch = useCallback(async () => {
    // Ignora ecos do realtime logo após uma escrita local pra evitar "piscar"
    // o estado antigo sobre a atualização otimista.
    if (Date.now() < muteUntilRef.current) return;
    const s = await loadAll();
    lastSyncedRef.current = s;
    setStateRaw(s);
  }, []);

  const muteUntilRef = useRef(0);

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

    const channel = supabase
      .channel(`ligactrl-sync-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "brokers" }, () => void refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => void refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts_queue" }, () => void refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => void refetch())
      .subscribe();

    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [refetch]);

  useEffect(() => {
    if (!hydrated || !meRef.current) return;
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    const prev = lastSyncedRef.current;
    pendingTimer.current = setTimeout(() => {
      const next = state;
      lastSyncedRef.current = next;
      // Silencia ecos do realtime por um curto período após escrever.
      muteUntilRef.current = Date.now() + 1500;
      void syncTo(prev, next, meRef.current!)
        .catch((e) => console.error("Falha ao salvar na nuvem", e));
    }, 80);
    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
  }, [state, hydrated]);


  // Visão filtrada: corretor só vê o próprio broker, contatos e ligações.
  // Admin vê tudo, mas seletores escondem pendentes (CorretoresTab usa fullState).
  const view: State = (() => {
    if (!me) return state;
    if (me.isAdmin) {
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

  return { state: view, fullState: state, setState: setStateRaw, hydrated, me };
}

export function newId() {
  return crypto.randomUUID();
}
