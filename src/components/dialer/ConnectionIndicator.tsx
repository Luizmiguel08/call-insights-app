import type { ConnectionState } from "@/hooks/useDialerSession";

export function ConnectionIndicator({
  state,
  lastSyncAt,
}: {
  state: ConnectionState;
  lastSyncAt: number | null;
}) {
  const color =
    state === "connected"
      ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.7)] animate-pulse"
      : state === "reconnecting"
      ? "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.6)] animate-pulse"
      : "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]";
  const label =
    state === "connected" ? "Sincronizado" : state === "reconnecting" ? "Reconectando" : "Offline";

  const ago = (() => {
    if (!lastSyncAt) return "agora";
    const s = Math.max(0, Math.round((Date.now() - lastSyncAt) / 1000));
    if (s < 5) return "agora";
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m`;
  })();

  return (
    <div
      className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-zinc-400"
      title={`Realtime: ${label} · última sync ${ago} atrás`}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-600">·</span>
      <span className="tabular-nums text-zinc-500">{ago}</span>
    </div>
  );
}
