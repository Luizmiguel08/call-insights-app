import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type DialerCallStatus = "idle" | "calling" | "answered" | "ended";
export type DialerSession = {
  id: string;
  user_id: string;
  current_contact_id: string | null;
  call_status: DialerCallStatus;
  call_started_at: string | null;
  observation: string;
  device_origin: "mobile" | "desktop" | null;
  device_id: string | null;
  updated_at: string;
};

export type ConnectionState = "connected" | "reconnecting" | "offline";

const deviceOrigin: "mobile" | "desktop" =
  typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? "mobile"
    : "desktop";

const DEVICE_ID_KEY = "dialer:device_id";

function getDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let id = window.localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      const generated: string =
        (crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(DEVICE_ID_KEY, generated);
      id = generated;
    }
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

const deviceId = getDeviceId();

/**
 * Single source of truth for the live dialer state.
 * - Loads (or creates) the user's dialer_sessions row once.
 * - Subscribes to Realtime UPDATEs on that row for cross-device mirroring.
 * - updateSession() applies the patch locally first (optimistic), then UPDATEs
 *   the row in Supabase in parallel. On error: rollback + toast.
 * Never polls.
 */
export function useDialerSession(userId: string | null | undefined) {
  const [session, setSession] = useState<DialerSession | null>(null);
  const [isConnected, setIsConnected] = useState<ConnectionState>("offline");
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const sessionRef = useRef<DialerSession | null>(null);
  sessionRef.current = session;

  // Tracks the latest updated_at we wrote ourselves, so we can ignore the echo.
  const localEchoRef = useRef<string | null>(null);

  // ---- initial load / upsert ----
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("dialer_sessions" as any)
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn("[dialer_sessions] load failed", error);
        return;
      }
      if (data) {
        setSession(data as unknown as DialerSession);
        setLastSyncAt(Date.now());
        return;
      }
      // bootstrap row
      const { data: inserted, error: insErr } = await supabase
        .from("dialer_sessions" as any)
        .insert({ user_id: userId, device_origin: deviceOrigin })
        .select("*")
        .maybeSingle();
      if (cancelled) return;
      if (insErr) {
        console.warn("[dialer_sessions] bootstrap failed", insErr);
        return;
      }
      if (inserted) {
        setSession(inserted as unknown as DialerSession);
        setLastSyncAt(Date.now());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // ---- single Realtime subscriber ----
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`dialer_session:${userId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "dialer_sessions", filter: `user_id=eq.${userId}` },
        (payload: any) => {
          const next = payload.new as DialerSession | undefined;
          if (!next) return;
          // ignore the echo of our own write
          if (localEchoRef.current && next.updated_at === localEchoRef.current) {
            localEchoRef.current = null;
            setLastSyncAt(Date.now());
            return;
          }
          setSession(next);
          setLastSyncAt(Date.now());
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setIsConnected("connected");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setIsConnected("reconnecting");
        else if (status === "CLOSED") setIsConnected("offline");
      });

    const onOnline = () => setIsConnected("reconnecting");
    const onOffline = () => setIsConnected("offline");
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      if (!navigator.onLine) setIsConnected("offline");
    }

    return () => {
      supabase.removeChannel(channel);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      }
    };
  }, [userId]);

  // ---- optimistic update ----
  const updateSession = useCallback(
    async (patch: Partial<Omit<DialerSession, "id" | "user_id" | "updated_at">>) => {
      if (!userId) return;
      const prev = sessionRef.current;
      if (!prev) return;
      // local-first
      const optimistic: DialerSession = {
        ...prev,
        ...patch,
        device_origin: deviceOrigin,
        updated_at: new Date().toISOString(),
      };
      setSession(optimistic);

      const { data, error } = await supabase
        .from("dialer_sessions" as any)
        .update({ ...patch, device_origin: deviceOrigin })
        .eq("user_id", userId)
        .select("*")
        .maybeSingle();
      if (error) {
        // rollback
        setSession(prev);
        toast.error("Falha ao sincronizar discador");
        return;
      }
      if (data) {
        localEchoRef.current = (data as any).updated_at;
        setSession(data as unknown as DialerSession);
        setLastSyncAt(Date.now());
      }
    },
    [userId],
  );

  return { session, updateSession, isConnected, lastSyncAt, deviceOrigin };
}
