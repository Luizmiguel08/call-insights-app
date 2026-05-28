export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

export type OutcomeKey =
  | "attended" | "no_answer" | "voicemail" | "wrong_number"
  | "callback" | "not_interested" | "scheduled";

export const OUTCOME_LABELS: Record<OutcomeKey, string> = {
  attended: "Atendeu",
  scheduled: "Agendou",
  no_answer: "Não atendeu",
  voicemail: "Caixa postal",
  wrong_number: "Nº errado",
  callback: "Retornar",
  not_interested: "Sem interesse",
};

export const OUTCOME_TONES: Record<OutcomeKey, string> = {
  attended: "bg-success/15 text-success border-success/30",
  scheduled: "bg-warning/20 text-warning-foreground border-warning/40",
  no_answer: "bg-muted text-muted-foreground border-border",
  voicemail: "bg-muted text-muted-foreground border-border",
  wrong_number: "bg-destructive/10 text-destructive border-destructive/30",
  callback: "bg-primary/10 text-primary border-primary/30",
  not_interested: "bg-destructive/10 text-destructive border-destructive/30",
};

export const PAUSE_REASONS = ["Almoço", "Banheiro", "Reunião", "Café", "Outro"] as const;
