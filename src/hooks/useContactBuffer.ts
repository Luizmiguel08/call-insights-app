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

  const load = useCallback(
    async (replace: boolean) => {
      if (!brokerId) return;
      if (inflightRef.current) return;
      inflightRef.current = true;
      if (replace) setLoading(true);
      try {
        let query: any = supabase
          .from("contacts_queue")
          .select("id,name,phone,list_name,broker_id,call_attempts,priority,created_at,last_called_at")
          .eq("status", "pending")
          .lt("call_attempts", 2)
          .or(`broker_id.eq.${brokerId},broker_id.is.null`)
          .order("broker_id", { ascending: false, nullsFirst: false })
          .order("call_attempts", { ascending: true })
          .order("priority", { ascending: false })
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(BUFFER_SIZE);
        if (listName) query = query.eq("list_name", listName);
        const { data, error: queryError } = await query;
        if (queryError) throw queryError;
        const rows = ((data ?? []) as any[]).map((row) => ({
          id: row.id,
          name: row.name,
          phone: row.phone,
          list_name: row.list_name ?? "Geral",
          broker_id: row.broker_id ?? null,
          attempt_count: row.call_attempts ?? 0,
          priority: row.priority ?? 0,
          created_at: row.created_at,
          last_attempt_result: null,
          last_attempt_at: row.last_called_at ?? null,
        })) as BufferedContact[];
        setBuffer((prev) => {
          if (replace) return rows;
          const seen = new Set(prev.map((c) => c.id));
          const merged = [...prev, ...rows.filter((r) => !seen.has(r.id))];
          return merged.slice(0, BUFFER_SIZE);
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

  const advance = useCallback(() => {
    setBuffer((prev) => prev.slice(1));
  }, []);

  const remove = useCallback((contactId: string) => {
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
