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
        const { data, error: rpcErr } = await (supabase as any).rpc("dialer_prefetch_queue", {
          _limit: BUFFER_SIZE,
          _list_name: listName,
        });
        if (rpcErr) throw rpcErr;
        const rows = (data ?? []) as BufferedContact[];
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
    incrementAttempt,
    retry: () => load(true),
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
