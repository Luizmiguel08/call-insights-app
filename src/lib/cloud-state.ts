import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Broker = { id: string; name: string };
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
export type State = { brokers: Broker[]; calls: Call[]; contacts: Contact[]; metaDaily: number };

const DEFAULT_BROKERS: Broker[] = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Miguel" },
  { id: "00000000-0000-4000-8000-000000000002", name: "Carlos" },
  { id: "00000000-0000-4000-8000-000000000003", name: "Ana" },
  { id: "00000000-0000-4000-8000-000000000004", name: "Fernanda" },
];

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

async function loadAll(): Promise<State> {
  const [brokersR, callsR, contactsR, settingsR] = await Promise.all([
    supabase.from("brokers").select("*").order("created_at"),
    supabase.from("calls").select("*").order("created_at", { ascending: false }).limit(2000),
    supabase.from("contacts_queue").select("*").order("created_at", { ascending: false }).limit(2000),
    supabase.from("app_settings").select("*").eq("id", "global").maybeSingle(),
  ]);
  if (brokersR.error) throw brokersR.error;
  if (callsR.error) throw callsR.error;
  if (contactsR.error) throw contactsR.error;

  let brokers: Broker[] = (brokersR.data ?? []).map((b) => ({ id: b.id, name: b.name }));
  if (brokers.length === 0) {
    const ins = await supabase.from("brokers").insert(DEFAULT_BROKERS).select("*");
    if (!ins.error && ins.data) brokers = ins.data.map((b) => ({ id: b.id, name: b.name }));
  }
  const calls: Call[] = (callsR.data ?? []).map((c) => ({
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

async function syncTo(prev: State, next: State) {
  // brokers
  const bd = diff(prev.brokers, next.brokers);
  if (bd.added.length) await supabase.from("brokers").insert(bd.added.map((b) => ({ id: b.id, name: b.name })));
  for (const b of bd.changed) await supabase.from("brokers").update({ name: b.name }).eq("id", b.id);
  if (bd.removed.length) await supabase.from("brokers").delete().in("id", bd.removed.map((b) => b.id));

  // contacts
  const cd = diff(prev.contacts, next.contacts);
  if (cd.added.length) {
    await supabase.from("contacts_queue").insert(
      cd.added.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        broker_id: c.brokerId,
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
        broker_id: c.brokerId,
        status: statusLocalToDb[c.status],
        call_attempts: c.attempts,
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
        broker_id: c.brokerId,
        client_name: c.client,
        phone: c.phone ?? null,
        attended: c.attended,
        scheduled: c.scheduled,
        notes: c.note || null,
        contact_id: c.contactId ?? null,
      })),
    );
  }
  if (kd.removed.length) await supabase.from("calls").delete().in("id", kd.removed.map((c) => c.id));

  // meta
  if (prev.metaDaily !== next.metaDaily) {
    await supabase.from("app_settings").upsert({ id: "global", meta_daily: next.metaDaily });
  }
}

export function useCloudState() {
  const [state, setStateRaw] = useState<State>(() => defaultState());
  const [hydrated, setHydrated] = useState(false);
  const lastSyncedRef = useRef<State>(defaultState());
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    const s = await loadAll();
    lastSyncedRef.current = s;
    setStateRaw(s);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await loadAll();
        if (!alive) return;
        lastSyncedRef.current = s;
        setStateRaw(s);
        setHydrated(true);
      } catch (e) {
        console.error("Falha ao carregar dados", e);
      }
    })();

    const channel = supabase
      .channel("ligactrl-sync")
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
    if (!hydrated) return;
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    const prev = lastSyncedRef.current;
    pendingTimer.current = setTimeout(() => {
      const next = state;
      lastSyncedRef.current = next;
      void syncTo(prev, next).catch((e) => console.error("Falha ao salvar na nuvem", e));
    }, 350);
    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
  }, [state, hydrated]);

  return { state, setState: setStateRaw, hydrated };
}

export function newId() {
  return crypto.randomUUID();
}
