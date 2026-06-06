# Refatoração do Discador — Estado Único + Realtime + Espelhamento

Esta é uma reescrita arquitetural significativa do discador. Vou trabalhar em duas fases: **banco primeiro** (migração precisa de aprovação antes do código), depois **frontend completo**.

---

## Fase 1 — Banco de dados (migração)

### Tabela `dialer_sessions`
Estado vivo da sessão por usuário (1 linha por usuário, upsert).
- `user_id` (unique) — única fonte de verdade da sessão
- `current_contact_id`, `call_status` (idle|calling|answered|ended), `call_started_at`, `observation`, `device_origin` (mobile|desktop), `updated_at`

RLS: usuário só lê/escreve sua própria linha. Realtime habilitado via `ALTER PUBLICATION supabase_realtime ADD TABLE dialer_sessions`.

### Tabela `contact_attempts`
Histórico imutável de tentativas.
- `contact_id`, `user_id`, `result` (no_answer|answered|scheduled|skipped|return_later), `attempt_number`, `observation`, `called_at`

RLS: usuário só lê/insere as próprias.

### RPC `dialer_prefetch_queue(_limit int)`
Retorna próximos N contatos pendentes do corretor JÁ com `attempt_count` agregado de `contact_attempts` — uma única round-trip para hidratar o buffer.

GRANTs explícitos em ambas tabelas para `authenticated` + `service_role` (não `anon`).

---

## Fase 2 — Frontend

### Novo hook `src/hooks/useDialerSession.ts`
- Carrega a linha de `dialer_sessions` (upsert se não existir) uma vez ao montar.
- Subscribe em canal Realtime único `dialer_session:{userId}` escutando `postgres_changes` UPDATE filtrado por `user_id`.
- Retorna `{ session, updateSession, isConnected, lastSyncAt }`.
- `updateSession(patch)` é **otimista**: aplica em `useState` local imediatamente, dispara UPDATE no Supabase em paralelo. Em erro: rollback + toast.
- `isConnected` reflete status real do canal (`SUBSCRIBED` → verde, `CHANNEL_ERROR`/`TIMED_OUT` → âmbar, offline → vermelho).
- Eco do próprio device é detectado via `device_origin` + `updated_at` para evitar flicker.

### Novo hook `src/hooks/useContactBuffer.ts`
- Buffer local: `useRef<Contact[]>` com até 10 contatos.
- Carga inicial via RPC `dialer_prefetch_queue(10)`.
- Quando `buffer.length <= 3`, faz refill silencioso em background (fire-and-forget).
- Expõe: `current`, `peekNext(n)`, `advance()` (shift), `registerAttempt(contactId, result)` (incrementa attempt_count local + insert em background).
- Estado de erro com retry quando buffer vazio + falha de rede.

### Refator de `src/routes/_authenticated/index.tsx`
Substitui a lógica atual de estado por:
- `useDialerSession(userId)` para sessão/realtime.
- `useContactBuffer()` para fila.
- Handlers de outcome: (1) inicia slide-out via classe CSS, (2) **em paralelo**: `INSERT contact_attempts` + `updateSession({ current_contact_id: next.id, call_status: 'idle', observation: '' })` + `buffer.advance()`, (3) slide-in do próximo. Tudo sem await sequencial.
- Botão "Pular" segue mesmo fluxo com `result: 'skipped'`.
- Debounce 300ms já existente nos botões mantido.
- Card mostra "Xª tentativa" lendo `attempt_count` do buffer (já vem do RPC).
- Header: bolinha de conexão (verde/âmbar/vermelho) + timestamp última sync.
- Sem `setTimeout` para race conditions, sem `invalidateQueries` na fila, sem reload.

### Arquivos
- `src/hooks/useDialerSession.ts` (novo)
- `src/hooks/useContactBuffer.ts` (novo)
- `src/components/dialer/ConnectionIndicator.tsx` (novo)
- `src/routes/_authenticated/index.tsx` (refator do bloco do discador)
- `src/styles.css` (keyframes slide-in/out já existem, reaproveitar)

### Fora de escopo
- Não mexer em layout visual aprovado anteriormente (duas colunas desktop, botões circulares, etc.).
- Não tocar em outras rotas/abas (Histórico, Dashboard, Corretores, Erros).
- Não mexer em `record_call_outcome` / `next_contact_for_broker` existentes — `contact_attempts` é registro complementar para a UI; o RPC legado continua sendo chamado em paralelo para manter `calls`/`contacts_queue` em sincronia com o resto do app (Histórico, Dashboard).

---

## Diagrama do fluxo de clique em "Não Atendeu"

```text
clique
  ├─ 0ms: classe slide-out no card (CSS puro, 150ms)
  ├─ paralelo:
  │   ├─ buffer.advance() → próximo já em memória
  │   ├─ updateSession({ current_contact_id: next.id, ... }) → otimista + UPDATE Supabase
  │   ├─ INSERT contact_attempts (result: 'no_answer', attempt_number: n+1)
  │   └─ RPC record_call_outcome (mantém legado em dia)
  ├─ 150ms: slide-in do próximo
  └─ se buffer.length <= 3: refill silencioso
```

Outros devices recebem o UPDATE de `dialer_sessions` via Realtime em <200ms e fazem a mesma transição visual.
