import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Plus, Trash2, Upload, User2, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/fila")({
  head: () => ({
    meta: [
      { title: "Fila de contatos — Discador" },
      { name: "description", content: "Importe e gerencie contatos a discar." },
    ],
  }),
  component: QueuePage,
});

type Broker = { id: string; name: string; color: string };
type QueueItem = {
  id: string;
  name: string;
  phone: string;
  broker_id: string | null;
  status: string;
  priority: number;
  notes: string | null;
  call_attempts: number;
  last_called_at: string | null;
  created_at: string;
};

const db = supabase as any;

function parseList(raw: string): { name: string; phone: string }[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,;\t]|\s{2,}/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        // assume "name, phone" OR "phone, name"
        const phoneIdx = parts.findIndex((p) => /\d{6,}/.test(p));
        const phone = phoneIdx >= 0 ? parts[phoneIdx] : parts[parts.length - 1];
        const name = parts.filter((_, i) => i !== (phoneIdx >= 0 ? phoneIdx : parts.length - 1)).join(" ") || "Sem nome";
        return { name, phone };
      }
      return { name: "Sem nome", phone: parts[0] };
    })
    .filter((x) => /\d/.test(x.phone));
}

function QueuePage() {
  const qc = useQueryClient();
  const [raw, setRaw] = useState("");
  const [assignTo, setAssignTo] = useState<string>("none");
  const [filterBroker, setFilterBroker] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("pending");
  const [importProgress, setImportProgress] = useState<string>("");

  // Quem está logado? (admin pode atribuir a qualquer um; corretor força a si mesmo)
  const { data: me } = useQuery({
    queryKey: ["me-fila"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) return { isAdmin: false, brokerId: null as string | null };
      const [rolesR, brokerR] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase.from("brokers").select("id").eq("user_id", uid).maybeSingle(),
      ]);
      const isAdmin = (rolesR.data ?? []).some((r) => r.role === "admin");
      return { isAdmin, brokerId: brokerR.data?.id ?? null };
    },
  });

  const { data: brokers = [] } = useQuery({
    queryKey: ["brokers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brokers").select("*").order("name");
      if (error) throw error;
      return data as Broker[];
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["queue", filterBroker, filterStatus],
    queryFn: async () => {
      let q = db.from("contacts_queue").select("*")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(2000);
      if (filterStatus !== "all") q = q.eq("status", filterStatus);
      if (filterBroker === "unassigned") q = q.is("broker_id", null);
      else if (filterBroker !== "all") q = q.eq("broker_id", filterBroker);
      const { data, error } = await q;
      if (error) throw error;
      return data as QueueItem[];
    },
  });

  const previewList = useMemo(() => parseList(raw), [raw]);

  const importContacts = useMutation({
    mutationFn: async () => {
      if (previewList.length === 0) throw new Error("Cole pelo menos um contato válido");

      // Corretor só pode importar para si mesmo (RLS exige broker_id = current_broker_id())
      let targetBroker: string | null;
      if (me?.isAdmin) {
        targetBroker = assignTo === "none" ? null : assignTo;
      } else {
        if (!me?.brokerId) throw new Error("Seu cadastro de corretor ainda não foi aprovado.");
        targetBroker = me.brokerId;
      }

      // Deduplica por telefone (apenas dígitos) dentro do lote
      const seen = new Set<string>();
      const unique = previewList.filter((c) => {
        const k = (c.phone || "").replace(/\D+/g, "");
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      // Importa em lotes de 500 para evitar timeouts / limites
      const BATCH = 500;
      let inserted = 0;
      const errors: string[] = [];
      for (let i = 0; i < unique.length; i += BATCH) {
        const chunk = unique.slice(i, i + BATCH).map((c) => ({
          name: c.name,
          phone: c.phone,
          broker_id: targetBroker,
        }));
        setImportProgress(`Importando ${Math.min(i + BATCH, unique.length)}/${unique.length}...`);
        const { error } = await db.from("contacts_queue").insert(chunk);
        if (error) {
          errors.push(error.message);
        } else {
          inserted += chunk.length;
        }
      }
      setImportProgress("");
      if (inserted === 0) throw new Error(errors[0] ?? "Falha ao importar contatos");
      return { inserted, skipped: previewList.length - unique.length, errors };
    },
    onSuccess: (res) => {
      const extras: string[] = [];
      if (res.skipped > 0) extras.push(`${res.skipped} duplicado(s) ignorado(s)`);
      if (res.errors.length) extras.push(`${res.errors.length} lote(s) com erro`);
      toast.success(
        `${res.inserted} contato(s) importado(s)` + (extras.length ? ` (${extras.join(", ")})` : ""),
      );
      setRaw("");
      qc.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (e: Error) => {
      setImportProgress("");
      toast.error(e.message);
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("contacts_queue").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });

  const bump = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("contacts_queue").update({ priority: 10 }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });

  const reassign = useMutation({
    mutationFn: async (args: { id: string; broker_id: string | null }) => {
      const { error } = await db.from("contacts_queue")
        .update({ broker_id: args.broker_id }).eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });

  const onFile = async (file: File) => {
    try {
      const name = file.name.toLowerCase();
      const isExcel = /\.(xlsx|xls|xlsm|xlsb|ods)$/.test(name);
      let text = "";
      if (isExcel) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const lines: string[] = [];
        for (const sheetName of wb.SheetNames) {
          const sheet = wb.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: "" });
          for (const row of rows) {
            if (!Array.isArray(row)) continue;
            const cells = row.map((c) => (c == null ? "" : String(c).trim())).filter(Boolean);
            if (cells.length) lines.push(cells.join(", "));
          }
        }
        text = lines.join("\n");
      } else {
        text = await file.text();
      }
      setRaw((prev) => (prev ? prev + "\n" : "") + text);
      toast.success(`Arquivo "${file.name}" carregado`);
    } catch (e: any) {
      toast.error(`Falha ao ler arquivo: ${e?.message ?? "formato inválido"}`);
    }
  };

  const counts = useMemo(() => {
    const c = { total: items.length, pending: 0, done: 0, skipped: 0 };
    for (const i of items) {
      if (i.status === "pending") c.pending++;
      else if (i.status === "done") c.done++;
      else if (i.status === "skipped") c.skipped++;
    }
    return c;
  }, [items]);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground">Fila de contatos</h1>
          <p className="text-sm text-muted-foreground">
            Importe contatos para discar. O discador vai puxar automaticamente o próximo da fila.
          </p>
        </div>

        <Card className="overflow-hidden border-0 shadow-elegant">
          <div className="bg-gradient-primary p-5 text-primary-foreground">
            <div className="flex items-center gap-3">
              <Upload className="h-5 w-5" />
              <div>
                <p className="font-display text-lg font-bold">Importar contatos</p>
                <p className="text-xs opacity-90">Cole uma lista ou envie um CSV (um por linha: <b>Nome, Telefone</b>)</p>
              </div>
            </div>
          </div>
          <div className="space-y-4 p-5">
            <Textarea
              rows={6}
              placeholder={`João Silva, 11999990000\nMaria Souza; 11988887777\nCarlos, (11) 97777-6666`}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              className="font-mono text-sm"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm hover:bg-accent">
                <Upload className="h-4 w-4" />
                Enviar CSV
                <input
                  type="file" accept=".csv,.txt,.xlsx,.xls,.xlsm,.xlsb,.ods" className="hidden"
                  onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
                />
              </label>
              {me?.isAdmin && (
                <div className="min-w-[200px]">
                  <Select value={assignTo} onValueChange={setAssignTo}>
                    <SelectTrigger><SelectValue placeholder="Atribuir a..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Fila geral (sem corretor)</SelectItem>
                      {brokers.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="ml-auto flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {importProgress || `${previewList.length} contato(s) prontos`}
                </span>
                <Button
                  onClick={() => importContacts.mutate()}
                  disabled={importContacts.isPending || previewList.length === 0}
                  className="bg-gradient-primary"
                >
                  <Plus className="mr-2 h-4 w-4" /> Importar
                </Button>
              </div>
            </div>
          </div>
        </Card>


        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Total" value={counts.total} />
          <MiniStat label="Pendentes" value={counts.pending} tone="primary" />
          <MiniStat label="Concluídos" value={counts.done} tone="success" />
          <MiniStat label="Pulados" value={counts.skipped} tone="muted" />
        </div>

        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-primary" />
              <h2 className="font-display text-lg font-bold">Contatos</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pendentes</SelectItem>
                  <SelectItem value="done">Concluídos</SelectItem>
                  <SelectItem value="skipped">Pulados</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterBroker} onValueChange={setFilterBroker}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos corretores</SelectItem>
                  <SelectItem value="unassigned">Fila geral</SelectItem>
                  {brokers.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhum contato nessa visualização.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {items.map((i) => {
                const broker = brokers.find((b) => b.id === i.broker_id);
                return (
                  <div key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold text-foreground">{i.name}</p>
                        {i.priority > 0 && (
                          <Badge className="bg-warning/20 text-warning-foreground hover:bg-warning/20">Prioridade</Badge>
                        )}
                        {i.call_attempts > 0 && (
                          <Badge variant="outline">{i.call_attempts}x tentativas</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{i.phone}</span>
                        {broker && (
                          <span className="flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: broker.color }} />
                            {broker.name}
                          </span>
                        )}
                        {!broker && <span className="italic">Fila geral</span>}
                      </div>
                    </div>
                    <Select
                      value={i.broker_id ?? "none"}
                      onValueChange={(v) => reassign.mutate({ id: i.id, broker_id: v === "none" ? null : v })}
                    >
                      <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Fila geral</SelectItem>
                        {brokers.map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="icon" variant="ghost" onClick={() => bump.mutate(i.id)}
                      title="Marcar como prioridade">
                      <ArrowUp className="h-4 w-4 text-warning" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove.mutate(i.id)}
                      className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}

function MiniStat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "primary" | "success" | "muted" }) {
  const tones = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    muted: "text-muted-foreground",
  };
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("font-display text-2xl font-bold", tones[tone])}>{value}</p>
    </Card>
  );
}
