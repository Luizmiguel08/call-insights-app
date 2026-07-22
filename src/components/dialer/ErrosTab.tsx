import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fontDisplay, fontNumeric } from "@/lib/dialer-shared";

type DialerErrorRow = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  broker_id: string | null;
  broker_name: string | null;
  list_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  action: string | null;
  error_message: string;
  details: any;
  created_at: string;
};

export default function ErrosTab() {
  const [rows, setRows] = useState<DialerErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc("recent_dialer_errors", { _limit: 200 });
    if (error) {
      setError(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as DialerErrorRow[]);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  function fmt(d: string) {
    try {
      return new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    } catch { return d; }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold uppercase tracking-wider text-[#c9a84c]" style={fontDisplay}>
            Erros do Discador
          </h2>
          <p className="text-sm text-zinc-500 mt-1">Últimas 200 falhas registradas no sistema.</p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-xs font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800"
          style={fontDisplay}
        >
          <RefreshCw className="h-4 w-4" /> Atualizar
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 bg-[#13151e] overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-sm text-zinc-500">Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-zinc-500">Nenhum erro registrado. 🎉</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-[10px] uppercase tracking-[0.18em] text-zinc-500" style={fontDisplay}>
                <tr>
                  <th className="px-3 py-2 text-left">Quando</th>
                  <th className="px-3 py-2 text-left">Usuário</th>
                  <th className="px-3 py-2 text-left">Corretor</th>
                  <th className="px-3 py-2 text-left">Lista</th>
                  <th className="px-3 py-2 text-left">Contato</th>
                  <th className="px-3 py-2 text-left">Ação</th>
                  <th className="px-3 py-2 text-left">Erro</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-zinc-800/80 align-top">
                    <td className="px-3 py-2 text-zinc-300 whitespace-nowrap" style={fontNumeric}>{fmt(r.created_at)}</td>
                    <td className="px-3 py-2 text-zinc-300">{r.user_email || "—"}</td>
                    <td className="px-3 py-2 text-zinc-300">{r.broker_name || "—"}</td>
                    <td className="px-3 py-2 text-zinc-300">{r.list_name || "—"}</td>
                    <td className="px-3 py-2 text-zinc-300">{r.contact_name || "—"}</td>
                    <td className="px-3 py-2 text-zinc-400">{r.action || "—"}</td>
                    <td className="px-3 py-2 text-red-300">{r.error_message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
