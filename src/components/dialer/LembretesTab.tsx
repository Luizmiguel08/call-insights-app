import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bell, Check, Clock, Phone, Trash2, Plus, MessageCircle, X, Calendar as CalendarIcon, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fontDisplay, fontNumeric, inputCls, telHref, normalizePhone, waHrefFromMessage } from "@/lib/dialer-shared";
import type { Me } from "@/lib/cloud-state";

export type CallReminder = {
  id: string;
  broker_id: string;
  user_id: string;
  contact_id: string | null;
  contact_name: string;
  contact_phone: string;
  scheduled_for: string; // ISO
  note: string | null;
  status: "pending" | "done" | "snoozed" | "dismissed";
  notified_at: string | null;
  created_at: string;
};

type Props = {
  me: Me | null;
  isAdmin: boolean;
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtRelative(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(mins / 60);
  const days = Math.round(hours / 24);
  const future = diff > 0;
  let txt = "";
  if (mins < 60) txt = `${mins} min`;
  else if (hours < 24) txt = `${hours}h`;
  else txt = `${days}d`;
  return future ? `em ${txt}` : `há ${txt}`;
}

export default function LembretesTab({ me, isAdmin }: Props) {
  const [items, setItems] = useState<CallReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "done" | "all">("pending");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CallReminder | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const q = (supabase as any).from("call_reminders").select("*").order("scheduled_for", { ascending: true });
    const r = await q;
    if (r.error) {
      toast.error("Falha ao carregar lembretes");
      console.error(r.error);
    } else {
      setItems((r.data ?? []) as CallReminder[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = (supabase as any)
      .channel(`call-reminders-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "call_reminders" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "pending") return items.filter((i) => i.status === "pending" || i.status === "snoozed");
    return items.filter((i) => i.status === "done");
  }, [items, filter]);

  async function updateStatus(id: string, status: CallReminder["status"]) {
    const r = await (supabase as any).from("call_reminders").update({ status }).eq("id", id);
    if (r.error) toast.error("Falha ao atualizar"); else toast.success(status === "done" ? "Marcado como feito" : "Atualizado");
    void load();
  }

  async function snooze(id: string, minutes: number) {
    const newTime = new Date(Date.now() + minutes * 60000).toISOString();
    const r = await (supabase as any).from("call_reminders").update({ scheduled_for: newTime, status: "pending", notified_at: null }).eq("id", id);
    if (r.error) toast.error("Falha ao adiar"); else toast.success(`Adiado ${minutes} min`);
    void load();
  }

  async function remove(id: string) {
    if (!confirm("Excluir este lembrete?")) return;
    const r = await (supabase as any).from("call_reminders").delete().eq("id", id);
    if (r.error) toast.error("Falha ao excluir"); else toast.success("Excluído");
    void load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold uppercase tracking-wider text-[#f0d78c]" style={fontDisplay}>
            <Bell className="inline h-5 w-5 mr-2 mb-1" /> Lembretes
          </h2>
          <p className="text-xs text-zinc-500 mt-1">Clientes que pediram para você retornar a ligação.</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#c9a24c] to-[#f0d78c] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-black hover:scale-[1.02] transition-transform"
          style={fontDisplay}
        >
          <Plus className="h-4 w-4" /> Novo lembrete
        </button>
      </div>

      <div className="flex gap-1 rounded-xl border border-zinc-800 bg-[#0d0d0d] p-1 w-fit">
        {(["pending", "done", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition ${filter === f ? "bg-[#c9a24c] text-black" : "text-zinc-400 hover:text-white"}`}
            style={fontDisplay}
          >
            {f === "pending" ? "Pendentes" : f === "done" ? "Feitos" : "Todos"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-500">Carregando…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-[#1a1a1a]/95 p-10 text-center">
          <Bell className="mx-auto h-8 w-8 text-zinc-700" />
          <p className="mt-3 text-sm text-zinc-500">Nenhum lembrete {filter === "pending" ? "pendente" : filter === "done" ? "concluído" : ""}.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const overdue = r.status === "pending" && new Date(r.scheduled_for).getTime() < Date.now();
            return (
              <div key={r.id} className={`rounded-2xl border p-4 backdrop-blur transition ${overdue ? "border-red-500/50 bg-red-500/5" : r.status === "done" ? "border-zinc-800 bg-[#1a1a1a]/60 opacity-60" : "border-[#c9a24c]/20 bg-[#1a1a1a]/95"}`}>
                <div className="flex flex-wrap items-start gap-3 justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-base font-bold text-white">{r.contact_name}</span>
                      {overdue && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 border border-red-500/40 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-300" style={fontDisplay}>
                          <Clock className="h-3 w-3" /> Atrasado
                        </span>
                      )}
                      {r.status === "done" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300" style={fontDisplay}>
                          <Check className="h-3 w-3" /> Feito
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-zinc-400 tabular-nums" style={fontNumeric}>{r.contact_phone}</div>
                    <div className="mt-1.5 flex items-center gap-2 text-xs">
                      <CalendarIcon className="h-3.5 w-3.5 text-[#c9a24c]" />
                      <span className="text-zinc-300">{fmtDate(r.scheduled_for)}</span>
                      <span className="text-zinc-500">· {fmtRelative(r.scheduled_for)}</span>
                    </div>
                    {r.note && <div className="mt-2 text-sm text-zinc-400 italic">"{r.note}"</div>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {r.contact_phone && (
                      <>
                        <a href={telHref(r.contact_phone)} className="inline-flex items-center gap-1 rounded-lg border border-[#c9a24c]/40 bg-[#c9a24c]/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#f0d78c] hover:bg-[#c9a24c]/20" style={fontDisplay}>
                          <Phone className="h-3.5 w-3.5" /> Ligar
                        </a>
                        <a href={waHrefFromMessage(r.contact_phone, `Olá ${r.contact_name}, tudo bem?`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-300 hover:bg-emerald-600/20" style={fontDisplay}>
                          <MessageCircle className="h-3.5 w-3.5" />
                        </a>
                      </>
                    )}
                    {r.status !== "done" && (
                      <>
                        <button onClick={() => updateStatus(r.id, "done")} title="Marcar como feito" className="inline-flex items-center justify-center rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-2.5 py-2 text-emerald-300 hover:bg-emerald-600/20">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => snooze(r.id, 15)} title="Adiar 15 min" className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-[#0d0d0d] px-2.5 py-2 text-xs text-zinc-400 hover:text-white" style={fontDisplay}>
                          +15m
                        </button>
                        <button onClick={() => snooze(r.id, 60)} title="Adiar 1 h" className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-[#0d0d0d] px-2.5 py-2 text-xs text-zinc-400 hover:text-white" style={fontDisplay}>
                          +1h
                        </button>
                      </>
                    )}
                    <button onClick={() => { setEditing(r); setShowForm(true); }} title="Editar" className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-[#0d0d0d] px-2.5 py-2 text-zinc-400 hover:text-white">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => remove(r.id)} title="Excluir" className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-[#0d0d0d] px-2.5 py-2 text-zinc-400 hover:text-red-400">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && me && (
        <ReminderForm
          me={me}
          existing={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); void load(); }}
        />
      )}
    </div>
  );
}

export function ReminderForm({ me, existing, onClose, onSaved, prefill }: {
  me: Me;
  existing?: CallReminder | null;
  onClose: () => void;
  onSaved: () => void;
  prefill?: { contact_id?: string | null; contact_name?: string; contact_phone?: string };
}) {
  const [name, setName] = useState(existing?.contact_name ?? prefill?.contact_name ?? "");
  const [phone, setPhone] = useState(existing?.contact_phone ?? prefill?.contact_phone ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const initDate = existing ? new Date(existing.scheduled_for) : new Date(Date.now() + 60 * 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const initLocal = `${initDate.getFullYear()}-${pad(initDate.getMonth() + 1)}-${pad(initDate.getDate())}T${pad(initDate.getHours())}:${pad(initDate.getMinutes())}`;
  const [when, setWhen] = useState(initLocal);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) { toast.error("Nome obrigatório"); return; }
    if (!when) { toast.error("Data/hora obrigatória"); return; }
    if (!me.brokerId) { toast.error("Corretor não identificado"); return; }
    setSaving(true);
    const payload = {
      broker_id: me.brokerId,
      user_id: me.userId,
      contact_id: existing?.contact_id ?? prefill?.contact_id ?? null,
      contact_name: name.trim(),
      contact_phone: phone.trim() ? normalizePhone(phone) : "",
      scheduled_for: new Date(when).toISOString(),
      note: note.trim() || null,
    };
    const r = existing
      ? await (supabase as any).from("call_reminders").update({ ...payload, status: "pending", notified_at: null }).eq("id", existing.id)
      : await (supabase as any).from("call_reminders").insert(payload);
    setSaving(false);
    if (r.error) { toast.error("Falha ao salvar"); console.error(r.error); return; }
    toast.success(existing ? "Lembrete atualizado" : "Lembrete agendado");
    onSaved();
  }

  function quickSet(minutes: number) {
    const d = new Date(Date.now() + minutes * 60000);
    setWhen(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[#c9a24c]/30 bg-[#1a1a1a] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold uppercase tracking-wider text-[#f0d78c]" style={fontDisplay}>
            <Bell className="inline h-4 w-4 mr-2 mb-0.5" /> {existing ? "Editar lembrete" : "Novo lembrete"}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500" style={fontDisplay}>Nome do cliente</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls + " mt-1"} placeholder="Ex: João da Silva" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500" style={fontDisplay}>Telefone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls + " mt-1"} placeholder="(11) 98765-4321" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500" style={fontDisplay}>Quando retornar</label>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={inputCls + " mt-1"} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                { l: "+15 min", m: 15 },
                { l: "+1 h", m: 60 },
                { l: "+3 h", m: 180 },
                { l: "Amanhã 9h", m: -1 },
              ].map((q) => (
                <button
                  key={q.l}
                  type="button"
                  onClick={() => {
                    if (q.m === -1) {
                      const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
                      setWhen(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
                    } else quickSet(q.m);
                  }}
                  className="rounded-md border border-zinc-700 bg-[#0d0d0d] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400 hover:text-[#c9a24c] hover:border-[#c9a24c]/40"
                  style={fontDisplay}
                >
                  {q.l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500" style={fontDisplay}>Observação (opcional)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className={inputCls + " mt-1 resize-none py-2"} placeholder="Ex: cliente pediu para retornar após o almoço" />
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-zinc-700 bg-[#0d0d0d] py-3 text-xs font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800" style={fontDisplay}>
            Cancelar
          </button>
          <button onClick={save} disabled={saving} className="flex-1 rounded-xl bg-gradient-to-r from-[#c9a24c] to-[#f0d78c] py-3 text-xs font-bold uppercase tracking-wider text-black hover:scale-[1.01] disabled:opacity-50" style={fontDisplay}>
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Polls for due reminders and re-alerts every REPEAT_MINUTES while the
 * reminder is still pending and overdue. `notified_at` is used as
 * "last alerted at" (not a one-shot flag). Also fires a native browser
 * notification (when permission granted) so it works with the tab in background.
 */
const REPEAT_MINUTES = 5;

export function useReminderNotifier(me: Me | null, onOpenTab: () => void) {
  // Pede permissão de notificação nativa uma vez
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      try { void Notification.requestPermission(); } catch { /* noop */ }
    }
  }, []);

  useEffect(() => {
    if (!me) return;
    let alive = true;

    function fireNative(title: string, body: string, onClick: () => void) {
      if (typeof window === "undefined") return;
      if (!("Notification" in window)) return;
      if (Notification.permission !== "granted") return;
      try {
        const n = new Notification(title, { body, tag: "call-reminder", renotify: true } as NotificationOptions);
        n.onclick = () => { window.focus(); onClick(); n.close(); };
      } catch { /* noop */ }
    }

    async function check() {
      if (!alive) return;
      const nowIso = new Date().toISOString();
      const cutoffIso = new Date(Date.now() - REPEAT_MINUTES * 60000).toISOString();
      const r = await (supabase as any)
        .from("call_reminders")
        .select("*")
        .eq("status", "pending")
        .lte("scheduled_for", nowIso)
        .or(`notified_at.is.null,notified_at.lte.${cutoffIso}`);
      if (r.error || !r.data?.length) return;
      for (const rem of r.data as CallReminder[]) {
        const title = `🔔 Lembrete: ligar para ${rem.contact_name}`;
        const desc = rem.note || rem.contact_phone;
        toast(title, {
          description: desc,
          duration: 15000,
          action: { label: "Ver", onClick: () => onOpenTab() },
        });
        fireNative(title, desc, onOpenTab);
        await (supabase as any).from("call_reminders").update({ notified_at: new Date().toISOString() }).eq("id", rem.id);
      }
    }
    void check();
    const i = setInterval(check, 30000);
    return () => { alive = false; clearInterval(i); };
  }, [me, onOpenTab]);
}
