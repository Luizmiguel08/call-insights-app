import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/corretores")({
  head: () => ({
    meta: [
      { title: "Corretores — Cadastro" },
      { name: "description", content: "Cadastre e gerencie os corretores da equipe." },
    ],
  }),
  component: BrokersPage,
});

const PALETTE = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#6366f1", "#ec4899", "#14b8a6", "#f97316"];

type Broker = { id: string; name: string; color: string };

function BrokersPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);

  const { data: brokers = [] } = useQuery({
    queryKey: ["brokers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brokers").select("*").order("name");
      if (error) throw error;
      return data as Broker[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Informe o nome");
      const { error } = await supabase.from("brokers").insert({ name: name.trim(), color });
      if (error) throw error;
    },
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["brokers"] });
      toast.success("Corretor adicionado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("brokers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brokers"] });
      toast.success("Removido");
    },
  });

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground">Corretores</h1>
          <p className="text-sm text-muted-foreground">Gerencie a equipe que aparece no discador.</p>
        </div>

        <Card className="p-5">
          <div className="space-y-3">
            <Input
              placeholder="Nome do corretor"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add.mutate()}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Cor:</span>
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? "var(--foreground)" : "transparent",
                  }}
                  aria-label={`Cor ${c}`}
                />
              ))}
            </div>
            <Button onClick={() => add.mutate()} disabled={add.isPending} className="bg-gradient-primary">
              <Plus className="mr-2 h-4 w-4" />
              Adicionar corretor
            </Button>
          </div>
        </Card>

        <div className="space-y-2">
          {brokers.map((b) => (
            <Card key={b.id} className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: `${b.color}22` }}>
                <User className="h-4 w-4" style={{ color: b.color }} />
              </div>
              <p className="flex-1 font-semibold text-foreground">{b.name}</p>
              <Button size="icon" variant="ghost" onClick={() => remove.mutate(b.id)}
                className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
