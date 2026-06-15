import { Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/* ---------------- Types ---------------- */

export type Broker = { id: string; name: string; userId?: string | null; approved?: boolean };
export type Call = {
  id: string;
  date: string; // YYYY-MM-DD
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
export type State = { brokers: Broker[]; calls: Call[]; contacts: Contact[]; metaDaily: number };
export type Tab = "discador" | "fila" | "rapido" | "historico" | "dashboard" | "corretores" | "erros" | "lembretes";

export function attemptLabel(attempts: number | undefined | null) {
  const used = attempts ?? 0;
  if (used === 0) return "1ª tentativa";
  if (used === 1) return "2ª e última tentativa";
  return null;
}

/* ---------------- Utils ---------------- */

export function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function normalizedContactKey(input: { name?: string; client?: string; phone?: string; contactId?: string }) {
  // If we have a hard link to a queue contact, it's the strongest identity.
  if (input.contactId) return `id:${input.contactId}`;
  const rawName = (input.name ?? input.client ?? "").trim().toLowerCase();
  const digits = (input.phone ?? "").replace(/\D/g, "");
  // Combine phone + name so that 30 quick-log entries with the same generic
  // phone but different client names don't collapse into a single "contact".
  if (digits && rawName) return `pn:${digits}|${rawName}`;
  if (digits) return `p:${digits}`;
  if (rawName) return `n:${rawName}`;
  return "unknown";
}
export function callContactKey(c: Call) {
  return normalizedContactKey({ client: c.client, phone: c.phone, contactId: c.contactId });
}
export function uniqueContactCount(calls: Call[]) {
  return new Set(calls.map(callContactKey)).size;
}
export function uniqueContactCountWhere(calls: Call[], pred: (c: Call) => boolean) {
  const set = new Set<string>();
  for (const c of calls) if (pred(c)) set.add(callContactKey(c));
  return set.size;
}

export function normalizePhone(s: string) {
  if (!s) return "";
  const trimmed = s.trim();
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  if (!hasPlus && digits.startsWith("00")) {
    digits = digits.slice(2);
    return "+" + digits;
  }
  if (hasPlus) return "+" + digits;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return "+" + digits;
  }
  if (digits.length === 10 || digits.length === 11) {
    return "+55" + digits;
  }
  return "+" + digits;
}

export function telHref(phone: string) {
  const p = normalizePhone(phone);
  return p ? `tel:${p}` : "#";
}

export const DEFAULT_WA_TEMPLATE =
  "Olá, {nome}! Aqui é da FORTAL, acabei de te ligar — segue por aqui pra gente conversar.";

export function renderWaMessage(template: string, clientName?: string) {
  const firstName = (clientName ?? "").trim().split(/\s+/)[0] || "";
  return (template || DEFAULT_WA_TEMPLATE)
    .replaceAll("{nome}", firstName)
    .replaceAll("{name}", firstName);
}

export function waHrefFromMessage(phone: string, message: string) {
  const p = normalizePhone(phone);
  if (!p) return "#";
  const digits = p.replace(/\D/g, "");
  const safe = (message || "").slice(0, 1000);
  return `https://wa.me/${digits}?text=${encodeURIComponent(safe)}`;
}

export async function logDialerError(params: {
  action: string;
  error: unknown;
  listName?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  details?: Record<string, unknown> | null;
}) {
  try {
    const err: any = params.error;
    const message =
      (typeof err === "string" && err) ||
      err?.message ||
      err?.error_description ||
      "Erro desconhecido";
    await supabase.rpc("log_dialer_error", {
      _action: params.action,
      _error_message: String(message).slice(0, 1000),
      _list_name: params.listName ?? undefined,
      _contact_id: params.contactId ?? undefined,
      _contact_name: params.contactName ?? undefined,
      _details: (params.details ?? undefined) as any,
    });
  } catch (e) {
    console.error("Falha ao registrar log de erro", e);
  }
}

/* ---------------- Styles ---------------- */

export const fontDisplay = { fontFamily: "'Fraunces', 'Playfair Display', Georgia, serif", fontOpticalSizing: "auto" } as const;
export const fontNumeric = { fontFamily: "'Fraunces', Georgia, serif", fontVariantNumeric: "tabular-nums lining-nums", fontFeatureSettings: "'ss01'" } as const;
export const inputCls =
  "h-10 w-full rounded-md border border-zinc-700 bg-[#0f1117] px-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-[#c9a24c] focus:ring-2 focus:ring-[#c9a24c]/30";

/* ---------------- Atoms ---------------- */

export function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500" style={fontDisplay}>{label}</span>
      {children}
    </label>
  );
}

export function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
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

export function Kpi({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-gradient-to-b from-[#13161f] to-[#0f1117] p-4 sm:p-5">
      <div className="text-[10px] font-medium uppercase tracking-[0.28em] text-zinc-500">{label}</div>
      <div
        className="mt-2 text-[44px] sm:text-[56px] font-semibold leading-[0.95] tracking-[-0.04em]"
        style={{ ...fontNumeric, color }}
      >
        {value}
      </div>
    </div>
  );
}

export function Badge({ ok }: { ok: boolean }) {
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

export function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2.5 text-left font-semibold ${className}`}>{children}</th>;
}
export function Td({ children, className = "", title, style }: { children?: React.ReactNode; className?: string; title?: string; style?: React.CSSProperties }) {
  return <td className={`px-3 py-2.5 ${className}`} title={title} style={style}>{children}</td>;
}
