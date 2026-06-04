import { useMemo, useState, useRef } from "react";
import { toast } from "sonner";
import { Trash2, Pencil, Save, X } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type State, type Call,
  Field, Kpi, Badge,
  fontDisplay, fontNumeric, inputCls,
  uniqueContactCount,
} from "@/lib/dialer-shared";
import type { Me } from "@/lib/cloud-state";

export default function HistoricoTab({ state, setState, me, isAdmin }: { state: State; setState: React.Dispatch<React.SetStateAction<State>>; me: Me | null; isAdmin: boolean }) {
  const [date, setDate] = useState("");
  const [brokerId, setBrokerId] = useState(isAdmin ? "" : (me?.brokerId ?? ""));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ client: string; phone: string; attended: boolean; scheduled: boolean; note: string }>({ client: "", phone: "", attended: false, scheduled: false, note: "" });

  const effectiveBrokerId = isAdmin ? brokerId : (me?.brokerId ?? "");

  const filtered = useMemo(() => state.calls
    .filter((c) => (date ? c.date === date : true))
    .filter((c) => (effectiveBrokerId ? c.brokerId === effectiveBrokerId : true)),
    [state.calls, date, effectiveBrokerId]);

  function startEdit(c: Call) {
    setEditingId(c.id);
    setEditDraft({ client: c.client, phone: c.phone ?? "", attended: c.attended, scheduled: c.scheduled, note: c.note ?? "" });
  }
  function cancelEdit() { setEditingId(null); }
  function saveEdit() {
    if (!editingId) return;
    const id = editingId;
    const d = editDraft;
    setState((s) => ({
      ...s,
      calls: s.calls.map((c) => c.id === id ? { ...c, client: d.client.trim() || c.client, phone: d.phone.trim() || undefined, attended: d.attended, scheduled: d.scheduled, note: d.note } : c),
    }));
    setEditingId(null);
    toast.success("Ligação atualizada");
  }
  function remove(id: string) {
    if (!confirm("Excluir esta ligação?")) return;
    setState((s) => ({ ...s, calls: s.calls.filter((c) => c.id !== id) }));
    toast.success("Ligação excluída");
  }
  function clearHistory() {
    if (!isAdmin) return;
    const ids = new Set(filtered.map((c) => c.id));
    if (ids.size === 0) { toast.error("Nada para excluir"); return; }
    const scopeLabel = effectiveBrokerId
      ? `de ${state.brokers.find((b) => b.id === effectiveBrokerId)?.name ?? ""}`
      : "de todos os corretores";
    const dateLabel = date ? `do dia ${new Date(date + "T00:00").toLocaleDateString("pt-BR")}` : "de todos os dias";
    if (!confirm(`Excluir TODO o histórico ${scopeLabel} ${dateLabel}? Esta ação não pode ser desfeita.\n\n${ids.size} ligação(ões) serão removidas.`)) return;
    if (!confirm("Tem certeza absoluta? Confirme novamente para apagar permanentemente.")) return;
    setState((s) => ({ ...s, calls: s.calls.filter((c) => !ids.has(c.id)) }));
    toast.success(`${ids.size} ligação(ões) excluída(s)`);
  }

  const analytics = useMemo(() => {
    const hourBuckets = Array.from({ length: 24 }, () => 0);
    for (const c of filtered) {
      const h = new Date(c.createdAt).getHours();
      hourBuckets[h] += 1;
    }
    const maxHour = Math.max(...hourBuckets);
    const peakHour = maxHour > 0 ? hourBuckets.indexOf(maxHour) : -1;
    const activeHours = hourBuckets.filter((v) => v > 0).length;
    const idleHours = 24 - activeHours;
    const contactMap = new Map<string, { client: string; phone?: string; total: number; attended: number; scheduled: number }>();
    for (const c of filtered) {
      const key = (c.phone || "") + "|" + c.client;
      const cur = contactMap.get(key) ?? { client: c.client, phone: c.phone, total: 0, attended: 0, scheduled: 0 };
      cur.total += 1;
      if (c.attended) cur.attended += 1;
      if (c.scheduled) cur.scheduled += 1;
      contactMap.set(key, cur);
    }
    const topContacts = Array.from(contactMap.values()).sort((a, b) => b.total - a.total).slice(0, 8);
    const byDay = new Map<string, number[]>();
    for (const c of filtered) {
      const arr = byDay.get(c.date) ?? [];
      arr.push(c.createdAt);
      byDay.set(c.date, arr);
    }
    let longestGapMin = 0;
    for (const arr of byDay.values()) {
      arr.sort((a, b) => a - b);
      for (let i = 1; i < arr.length; i++) {
        const gap = (arr[i] - arr[i - 1]) / 60000;
        if (gap > longestGapMin) longestGapMin = gap;
      }
    }
    return { hourBuckets, maxHour, peakHour, activeHours, idleHours, topContacts, longestGapMin };
  }, [filtered]);

  const showCharts = !!effectiveBrokerId && filtered.length > 0;
  const selectedBroker = state.brokers.find((b) => b.id === effectiveBrokerId);

  // Map brokers for fast lookup in the virtualized list
  const brokersById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of state.brokers) m.set(b.id, b.name);
    return m;
  }, [state.brokers]);

  // Virtualization
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 12,
  });

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-4 flex flex-wrap gap-3 items-end">
        <Field label="Data" className="min-w-[180px]">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
        {isAdmin && (
          <Field label="Corretor" className="min-w-[200px]">
            <select value={brokerId} onChange={(e) => setBrokerId(e.target.value)} className={inputCls + " appearance-none"}>
              <option value="" className="bg-[#171a23]">Todos</option>
              {state.brokers.map((b) => (
                <option key={b.id} value={b.id} className="bg-[#171a23]">{b.name}</option>
              ))}
            </select>
          </Field>
        )}
        <button
          onClick={() => { setDate(""); if (isAdmin) setBrokerId(""); }}
          className="h-10 rounded-md border border-zinc-700 px-4 text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
          style={fontDisplay}
        >
          Limpar filtros
        </button>
        {isAdmin && (
          <button
            onClick={clearHistory}
            disabled={filtered.length === 0}
            className="h-10 flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-4 text-xs font-bold uppercase tracking-wider text-red-400 hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            style={fontDisplay}
            title="Excluir todo o histórico filtrado"
          >
            <Trash2 className="h-3.5 w-3.5" /> Excluir histórico
          </button>
        )}
        <div className="ml-auto text-xs uppercase tracking-widest text-zinc-500" style={fontDisplay}>
          {filtered.length} registro{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      {showCharts && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Ligações" value={uniqueContactCount(filtered)} color="#c9a24c" />
            <Kpi label="Horas ativas" value={analytics.activeHours} color="#22c55e" />
            <Kpi label="Horas ociosas" value={analytics.idleHours} color="#ef4444" />
            <Kpi
              label="Maior ócio"
              value={analytics.longestGapMin >= 60 ? `${Math.floor(analytics.longestGapMin / 60)}h${Math.round(analytics.longestGapMin % 60).toString().padStart(2, "0")}` : `${Math.round(analytics.longestGapMin)}m`}
              color="#eab308"
            />
          </div>

          <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-5">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h3 className="text-lg font-bold uppercase tracking-wider text-[#c9a24c]" style={fontDisplay}>Pico de ligações por hora</h3>
                <p className="text-xs text-zinc-500 mt-1">
                  {selectedBroker?.name ?? "Corretor"}{date ? ` · ${new Date(date + "T00:00").toLocaleDateString("pt-BR")}` : " · todos os dias"}
                </p>
              </div>
              {analytics.peakHour >= 0 && (
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500" style={fontDisplay}>Pico</div>
                  <div className="text-2xl font-bold text-[#c9a24c]" style={fontNumeric}>
                    {analytics.peakHour.toString().padStart(2, "0")}h · {analytics.maxHour}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-end gap-1 h-40">
              {analytics.hourBuckets.map((v, h) => {
                const pct = analytics.maxHour ? (v / analytics.maxHour) * 100 : 0;
                const isPeak = v > 0 && v === analytics.maxHour;
                return (
                  <div key={h} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className={`w-full rounded-t transition-all ${isPeak ? "bg-[#c9a24c]" : v > 0 ? "bg-emerald-600/70" : "bg-zinc-800"}`}
                        style={{ height: `${Math.max(pct, v > 0 ? 6 : 2)}%` }}
                        title={`${h.toString().padStart(2, "0")}h — ${v} ligaç${v === 1 ? "ão" : "ões"}`}
                      />
                    </div>
                    <div className={`text-[9px] tabular-nums ${isPeak ? "text-[#c9a24c] font-bold" : "text-zinc-600"}`}>
                      {h.toString().padStart(2, "0")}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex gap-4 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#c9a24c]" /> Hora de pico</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-600/70" /> Ativa</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-zinc-800" /> Ociosa</span>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-[#171a23] p-5">
            <h3 className="mb-4 text-lg font-bold uppercase tracking-wider text-[#c9a24c]" style={fontDisplay}>Contatos mais ligados</h3>
            {analytics.topContacts.length === 0 ? (
              <p className="text-sm text-zinc-500">Sem dados.</p>
            ) : (
              <div className="space-y-2">
                {analytics.topContacts.map((c, i) => {
                  const max = analytics.topContacts[0].total;
                  const pct = (c.total / max) * 100;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <div className="truncate">
                          <span className="font-semibold text-zinc-100">{c.client}</span>
                          {c.phone && <span className="text-zinc-500 ml-2 text-xs">{c.phone}</span>}
                        </div>
                        <div className="text-xs text-zinc-400 shrink-0 ml-3">
                          <span className="text-zinc-100 font-bold" style={fontNumeric}>{c.total}</span> tentativas
                          {c.attended > 0 && <span className="text-emerald-400 ml-2">{c.attended} atend.</span>}
                          {c.scheduled > 0 && <span className="text-yellow-400 ml-2">{c.scheduled} agend.</span>}
                        </div>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                        <div className="h-full rounded-full bg-[#c9a24c]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {!showCharts && isAdmin && !effectiveBrokerId && filtered.length > 0 && (
        <div className="rounded-lg border border-zinc-800/60 bg-[#171a23]/50 p-4 text-xs text-zinc-500">
          Selecione um corretor para visualizar gráfico de pico, horas ativas/ociosas e contatos mais ligados.
        </div>
      )}

      {/* Virtualized list — mobile-friendly cards, no horizontal scroll */}
      <div className="rounded-lg border border-zinc-800 bg-[#171a23]">
        <div className="grid grid-cols-12 gap-2 border-b border-zinc-800 bg-[#0f1117] px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500" style={fontDisplay}>
          <div className="col-span-3 sm:col-span-2">Data / Hora</div>
          <div className="col-span-4 sm:col-span-3">Cliente</div>
          <div className="hidden sm:block sm:col-span-2">Corretor</div>
          <div className="hidden sm:block sm:col-span-2">Telefone</div>
          <div className="col-span-3 sm:col-span-2 text-center">Status</div>
          <div className="col-span-2 sm:col-span-1 text-right">Ações</div>
        </div>

        {filtered.length === 0 ? (
          <div className="py-10 text-center text-zinc-500">Nenhuma ligação registrada.</div>
        ) : (
          <div
            ref={scrollRef}
            className="overflow-auto"
            style={{ maxHeight: "min(70vh, 720px)" }}
          >
            <div
              style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}
            >
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const c = filtered[vi.index];
                const isEditing = editingId === c.id;
                const brokerName = brokersById.get(c.brokerId) ?? "—";
                return (
                  <div
                    key={c.id}
                    ref={rowVirtualizer.measureElement}
                    data-index={vi.index}
                    className="absolute left-0 right-0 border-t border-zinc-800/80 px-3 py-2 text-sm hover:bg-zinc-900/40"
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    {isEditing ? (
                      <div className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-3 sm:col-span-2 text-xs text-zinc-400 tabular-nums">
                          {new Date(c.date + "T00:00").toLocaleDateString("pt-BR")}<br />
                          <span className="text-zinc-500">{new Date(c.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <div className="col-span-9 sm:col-span-3">
                          <input value={editDraft.client} onChange={(e) => setEditDraft({ ...editDraft, client: e.target.value })} className={inputCls + " h-8 text-sm"} />
                          <input value={editDraft.note} onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })} className={inputCls + " h-7 text-xs mt-1"} placeholder="Observação" />
                        </div>
                        <div className="hidden sm:block sm:col-span-2 truncate font-semibold text-zinc-100">{brokerName}</div>
                        <div className="hidden sm:block sm:col-span-2">
                          <input value={editDraft.phone} onChange={(e) => setEditDraft({ ...editDraft, phone: e.target.value })} className={inputCls + " h-8 text-sm tabular-nums"} placeholder="(00) 00000-0000" />
                        </div>
                        <div className="col-span-2 sm:col-span-2 flex gap-1 justify-center">
                          <button onClick={() => setEditDraft({ ...editDraft, attended: !editDraft.attended })} className={`rounded px-2 py-1 text-xs font-bold ${editDraft.attended ? "bg-emerald-500/20 text-emerald-400" : "bg-zinc-800 text-zinc-500"}`}>A</button>
                          <button onClick={() => setEditDraft({ ...editDraft, scheduled: !editDraft.scheduled })} className={`rounded px-2 py-1 text-xs font-bold ${editDraft.scheduled ? "bg-yellow-500/20 text-yellow-400" : "bg-zinc-800 text-zinc-500"}`}>G</button>
                        </div>
                        <div className="col-span-1 flex gap-1 justify-end">
                          <button onClick={saveEdit} className="rounded p-1.5 text-emerald-400 hover:bg-emerald-500/10" title="Salvar"><Save className="h-4 w-4" /></button>
                          <button onClick={cancelEdit} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800" title="Cancelar"><X className="h-4 w-4" /></button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-3 sm:col-span-2 text-xs text-zinc-400 tabular-nums leading-tight">
                          {new Date(c.date + "T00:00").toLocaleDateString("pt-BR")}<br />
                          <span className="text-zinc-500">{new Date(c.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <div className="col-span-4 sm:col-span-3 min-w-0">
                          <div className="truncate text-zinc-100">{c.client}</div>
                          {c.note && <div className="truncate text-xs text-zinc-500" title={c.note}>{c.note}</div>}
                          <div className="sm:hidden truncate text-[11px] text-zinc-500">{brokerName}{c.phone ? ` · ${c.phone}` : ""}</div>
                        </div>
                        <div className="hidden sm:block sm:col-span-2 truncate font-semibold text-zinc-100">{brokerName}</div>
                        <div className="hidden sm:block sm:col-span-2 truncate tabular-nums text-zinc-300">{c.phone || "—"}</div>
                        <div className="col-span-3 sm:col-span-2 flex justify-center gap-1">
                          <Badge ok={c.attended} />
                          {c.scheduled && (
                            <span className="inline-flex items-center rounded-md border border-yellow-500/40 bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-400" style={fontDisplay}>Ag</span>
                          )}
                        </div>
                        <div className="col-span-2 sm:col-span-1 flex gap-0.5 justify-end">
                          <button onClick={() => startEdit(c)} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-[#c9a24c]" title="Editar">
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button onClick={() => remove(c.id)} className="rounded p-1.5 text-zinc-500 hover:bg-red-500/10 hover:text-red-400" title="Excluir">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
