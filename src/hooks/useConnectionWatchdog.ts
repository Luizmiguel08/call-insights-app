import { useEffect, useState } from "react";

/**
 * Watchdog central de conexão. Observa `navigator.onLine` +
 * `document.visibilityState`. Componentes usam `mode` pra decidir se
 * ligam polling agressivo (degraded) ou confiam só no Realtime (live).
 *
 * - `live`     — online e aba visível (regime normal).
 * - `degraded` — offline OU aba escondida (bateria/rádio → pausa polls).
 *
 * NB: mesmo com aba escondida usamos `degraded` (não `live`) porque não
 * queremos que polls disparem em background — o browser pausa
 * setInterval em segundo plano de qualquer jeito, e ao voltar pra
 * frente o `visibilitychange` faz cada consumidor decidir se refetch.
 */
export type ConnectionMode = "live" | "degraded";

export function useConnectionWatchdog(): {
  mode: ConnectionMode;
  online: boolean;
  visible: boolean;
} {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [visible, setVisible] = useState<boolean>(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onVis = () => setVisible(document.visibilityState === "visible");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const mode: ConnectionMode = online && visible ? "live" : "degraded";
  return { mode, online, visible };
}
