import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Presença ao vivo do discador.
 *
 * Fonte da verdade: tabela `active_calls` (1 linha por corretor), publicada em
 * Realtime. Quem está ligando faz upsert via RPC `dialer_presence_set` e limpa
 * com `dialer_presence_clear`. Um heartbeat mantém `updated_at` fresco para que
 * outros aparelhos saibam que a ligação ainda está acontecendo.
 */

export type PresenceRow = {
  broker_id: string;
  contact_id: string | null;
  contact_name: string;
  phone: string | null;
  device_label: string;
  started_at: string;
  updated_at: string;
};

/** Presença é considerada morta se não houver heartbeat nesse intervalo. */
export const PRESENCE_STALE_MS = 90_000;
const HEARTBEAT_MS = 20_000;

function deviceLabel(): string {
  if (typeof navigator === "undefined") return "Dispositivo";
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "Celular" : "Computador";
}

/** Lê a presença de toda a equipe em tempo real. */
export function useTeamPresence() {
  const [rows, setRows] = useState<Record<string, PresenceRow>>({});
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("active_calls" as any).select("*");
    if (error || !data) return;
    const map: Record<string, PresenceRow> = {};
    for (const r of data as unknown as PresenceRow[]) map[r.broker_id] = r;
    setRows(map);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel(`presence-team-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "active_calls" }, (payload: any) => {
        setRows((prev) => {
          const next = { ...prev };
          if (payload.eventType === "DELETE") {
            const id = payload.old?.broker_id;
            if (id) delete next[id];
            return next;
          }
          const row = payload.new as PresenceRow | undefined;
          if (row?.broker_id) next[row.broker_id] = row;
          return next;
        });
      })
      .subscribe();

    // Reavalia "stale" a cada 15s e faz um resync leve ao voltar o foco.
    const interval = window.setInterval(() => setTick((t) => t + 1), 15_000);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    return () => {
      void supabase.removeChannel(channel);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [load]);

  const isLive = useCallback(
    (brokerId: string | null | undefined) => {
      if (!brokerId) return false;
      const r = rows[brokerId];
      if (!r) return false;
      return Date.now() - new Date(r.updated_at).getTime() < PRESENCE_STALE_MS;
    },
    // tick força reavaliação periódica
    [rows, tick],
  );

  const get = useCallback(
    (brokerId: string | null | undefined): PresenceRow | null => {
      if (!brokerId) return null;
      const r = rows[brokerId];
      if (!r) return null;
      return Date.now() - new Date(r.updated_at).getTime() < PRESENCE_STALE_MS ? r : null;
    },
    [rows, tick],
  );

  return { rows, isLive, get, refresh: load };
}

/** Publica a presença deste aparelho ("estou ligando para X agora"). */
export function usePresencePublisher() {
  const activeRef = useRef<{ id: string | null; name: string; phone: string | null } | null>(null);

  const publish = useCallback(async (contact: { id: string | null; name: string; phone: string | null }) => {
    activeRef.current = contact;
    await (supabase as any).rpc("dialer_presence_set", {
      _contact_id: contact.id,
      _contact_name: contact.name,
      _phone: contact.phone,
      _device_label: deviceLabel(),
    });
  }, []);

  const clear = useCallback(async () => {
    activeRef.current = null;
    await (supabase as any).rpc("dialer_presence_clear");
  }, []);

  // Heartbeat enquanto houver ligação em andamento
  useEffect(() => {
    const id = window.setInterval(() => {
      const c = activeRef.current;
      if (!c) return;
      void (supabase as any).rpc("dialer_presence_set", {
        _contact_id: c.id,
        _contact_name: c.name,
        _phone: c.phone,
        _device_label: deviceLabel(),
      });
    }, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, []);

  // Libera a presença ao fechar/atualizar a aba
  useEffect(() => {
    const onUnload = () => {
      if (activeRef.current) void (supabase as any).rpc("dialer_presence_clear");
    };
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      if (activeRef.current) void (supabase as any).rpc("dialer_presence_clear");
    };
  }, []);

  return { publish, clear, deviceLabel: deviceLabel() };
}
