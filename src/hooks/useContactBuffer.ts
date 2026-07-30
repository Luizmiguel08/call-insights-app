import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type BufferedContact = {
  id: string;
  name: string;
  phone: string;
  list_name: string;
  broker_id: string | null;
  attempt_count: number;
  priority: number;
  created_at: string;
  last_attempt_result: string | null;
  last_attempt_at: string | null;
};

const BUFFER_SIZE = 10;
const REFILL_THRESHOLD = 3;
const PIN_KEY = "dialer:pinned_contact_id";

function readStoredPin(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PIN_KEY);
  } catch {
    return null;
  }
}

function writeStoredPin(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(PIN_KEY, id);
    else window.localStorage.removeItem(PIN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Local prefetch buffer of upcoming contacts.
 * Loads N at a time via dialer_prefetch_queue RPC. Refills silently in the
 * background once below threshold. Never fetched in click handlers.
 */
export function useContactBuffer(brokerId: string | null | undefined, listName: string | null) {
  const [buffer, setBuffer] = useState<BufferedContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflightRef = useRef(false);
  // Contato "travado" na frente da fila: o corretor está no meio da ligação
  // (ou entre a 1ª e a 2ª tentativa). Nenhum recarregamento pode trocá-lo.
  // Persiste no aparelho: sair para o discador nativo do iPhone pode
  // descarregar o app inteiro, e ao voltar o mesmo cliente precisa estar lá.
  const pinnedRef = useRef<string | null>(readStoredPin());

  const load = useCallback(
    async (replace: boolean) => {
      if (!brokerId) return;
      if (inflightRef.current) return;
      inflightRef.current = true;
      if (replace) setLoading(true);
      try {
        // A função do backend aplica a identidade autenticada, a organização,
        // prioridade e limite de tentativas de forma consistente entre devices.
        const { data, error: rpcError } = await (supabase as any).rpc("dialer_prefetch_queue", {
          _limit: BUFFER_SIZE,
          _list_name: listName,
        });
        if (rpcError) throw rpcError;
        const rows = (data ?? []) as BufferedContact[];

        // O contato travado é soberano: se a nova leva não o trouxe (ele cai
        // no fim da ordenação depois da 1ª tentativa), buscamos pelo id para
        // ele nunca sumir da tela no meio da ligação.
        const pinnedId = pinnedRef.current;
        let pinnedRow: BufferedContact | null = null;
        if (pinnedId && !rows.some((r) => r.id === pinnedId)) {
          const { data: pinData } = await supabase
            .from("contacts_queue")
            .select("id, name, phone, list_name, broker_id, call_attempts, priority, created_at, status")
            .eq("id", pinnedId)
            .maybeSingle();
          const p: any = pinData;
          if (p && p.status === "pending" && (p.call_attempts ?? 0) < 2) {
            pinnedRow = {
              id: p.id,
              name: p.name,
              phone: p.phone,
              list_name: p.list_name,
              broker_id: p.broker_id,
              attempt_count: p.call_attempts ?? 0,
              priority: p.priority ?? 0,
              created_at: p.created_at,
              last_attempt_result: null,
              last_attempt_at: null,
            };
          } else if (p) {
            // Já concluído em outro aparelho: solta a trava.
            pinnedRef.current = null;
            writeStoredPin(null);
          }
        }

        setBuffer((prev) => {
          const pid = pinnedRef.current;
          const pinnedFromPrev = pid ? prev.find((c) => c.id === pid) ?? null : null;
          const reorder = (list: BufferedContact[]) => {
            if (!pid) return list;
            const idx = list.findIndex((c) => c.id === pid);
            if (idx > 0) {
              const copy = list.slice();
              const [p] = copy.splice(idx, 1);
              return [p, ...copy];
            }
            if (idx === 0) return list;
            const recovered = pinnedRow ?? pinnedFromPrev;
            return recovered ? [recovered, ...list] : list;
          };
          if (replace) return reorder(rows).slice(0, BUFFER_SIZE);
          const seen = new Set(prev.map((c) => c.id));
          const merged = [...prev, ...rows.filter((r) => !seen.has(r.id))];
          return reorder(merged).slice(0, BUFFER_SIZE);
        });
        setError(null);
      } catch (e: any) {
        setError(e?.message ?? "Falha ao carregar fila");
      } finally {
        inflightRef.current = false;
        if (replace) setLoading(false);
      }
    },
    [brokerId, listName],
  );


  useEffect(() => {
    void load(true);
  }, [load]);


  // background refill
  useEffect(() => {
    if (buffer.length > REFILL_THRESHOLD) return;
    if (!brokerId) return;
    void load(false);
  }, [buffer.length, brokerId, load]);

  // ── Sincronização em tempo real entre dispositivos ────────────────────────
  // Se o mesmo corretor (ou um admin) mexe na fila em outro aparelho, o buffer
  // local precisa refletir na hora: contato resolvido some, contato novo entra.
  useEffect(() => {
    if (!brokerId) return;
    let refillTimer: number | null = null;
    const scheduleRefill = () => {
      if (refillTimer) window.clearTimeout(refillTimer);
      refillTimer = window.setTimeout(() => { void load(false); }, 400);
    };

    const applyQueueRow = (row: any) => {
      if (!row?.id) return;
      const resolved = row.status !== "pending" || (row.call_attempts ?? 0) >= 2;
      const mine = row.broker_id === brokerId || row.broker_id === null;
      // O contato travado só sai da tela por ação do corretor (registrar
      // resultado ou pular). Eventos de tempo real não podem removê-lo.
      const isPinned = pinnedRef.current === row.id;
      setBuffer((prev) => {
        const idx = prev.findIndex((c) => c.id === row.id);
        if (idx === -1) {
          if (!resolved && mine) scheduleRefill();
          return prev;
        }
        if ((resolved || !mine) && !isPinned) return prev.filter((c) => c.id !== row.id);
        const arr = prev.slice();
        arr[idx] = { ...arr[idx], attempt_count: row.call_attempts ?? arr[idx].attempt_count, name: row.name ?? arr[idx].name, phone: row.phone ?? arr[idx].phone };
        return arr;
      });
    };

    const channel = supabase
      .channel(`dialer-queue-sync-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contacts_queue" }, (payload: any) => {
        if (payload.eventType === "DELETE") {
          const id = payload.old?.id;
          if (id && pinnedRef.current !== id) setBuffer((prev) => prev.filter((c) => c.id !== id));
          return;
        }
        if (payload.eventType === "INSERT") { scheduleRefill(); return; }
        applyQueueRow(payload.new);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "calls" }, (payload: any) => {
        const contactId = payload.new?.contact_id;
        if (!contactId) return;
        setBuffer((prev) =>
          prev.map((c) => (c.id === contactId ? { ...c, attempt_count: Math.max(c.attempt_count, 1) } : c)),
        );
      })
      .subscribe();


    // Mobile derruba o WebSocket em segundo plano: revalida ao voltar.
    const onWake = () => {
      if (document.visibilityState !== "visible") return;
      void load(true);
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);

    return () => {
      if (refillTimer) window.clearTimeout(refillTimer);
      void supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
  }, [brokerId, load]);


  const pin = useCallback((contactId: string) => {
    pinnedRef.current = contactId;
    writeStoredPin(contactId);
  }, []);

  const unpin = useCallback(() => {
    pinnedRef.current = null;
    writeStoredPin(null);
  }, []);

  const advance = useCallback(() => {
    pinnedRef.current = null;
    writeStoredPin(null);
    setBuffer((prev) => prev.slice(1));
  }, []);

  const remove = useCallback((contactId: string) => {
    if (pinnedRef.current === contactId) {
      pinnedRef.current = null;
      writeStoredPin(null);
    }
    setBuffer((prev) => prev.filter((contact) => contact.id !== contactId));
  }, []);


  const incrementAttempt = useCallback((contactId: string) => {
    setBuffer((prev) =>
      prev.map((c) => (c.id === contactId ? { ...c, attempt_count: c.attempt_count + 1 } : c)),
    );
  }, []);

  return {
    current: buffer[0] ?? null,
    peekNext: (n: number) => buffer.slice(1, 1 + n),
    buffer,
    loading,
    error,
    advance,
    remove,
    incrementAttempt,
    pin,
    unpin,
    retry: () => load(true),
    refresh: () => load(true),

  };
}

/** Record one attempt in contact_attempts (fire-and-forget, parallel to record_call_outcome). */
export async function recordContactAttempt(input: {
  contactId: string;
  userId: string;
  brokerId: string | null;
  result: "no_answer" | "answered" | "scheduled" | "skipped" | "return_later";
  attemptNumber: number;
  observation?: string | null;
}) {
  const { error } = await supabase.from("contact_attempts" as any).insert({
    contact_id: input.contactId,
    user_id: input.userId,
    broker_id: input.brokerId,
    result: input.result,
    attempt_number: input.attemptNumber,
    observation: input.observation ?? null,
  });
  if (error) console.warn("[contact_attempts] insert failed", error);
}
