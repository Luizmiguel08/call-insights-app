## Diagnóstico

As duas URLs lentas (`.../calls?...&offset=6000&limit=1000` e `.../contacts_queue?status=eq.pending&...&offset=6000&limit=1000`) vêm de 4 causas:

1. **OFFSET pagination**: `offset=6000` força o Postgres a ordenar e descartar 6000 linhas por página — cada página fica mais lenta que a anterior.
2. **Cliente ainda baixa datasets inteiros**: `loadAllContacts()` traz todos os pendentes (~10k linhas); `loadAllCalls()` traz 30 dias (~milhares). Discador só precisa dos próximos 10 contatos (já tem `dialer_prefetch_queue`); dashboard precisa de agregados.
3. **Índices duplicados** em `calls` e `contacts_queue` (encaram custo de escrita sem ganho de leitura).
4. **Delta refetch sem cursor** vira full scan paginado por offset na primeira sessão.

## Escopo

Trocar "baixa tudo, calcula no cliente" por "servidor calcula, cliente pede só o que precisa". Sem mudar visual, autenticação, permissões ou features.

## Passos

### 1. Migration única

- **Dropar índices redundantes** (mantém sempre o mais completo):
  - `idx_calls_created` (dup de `idx_calls_created_at`)
  - `idx_calls_updated` (dup de `calls_updated_at_idx`)
  - `idx_contacts_queue_updated` (dup de `contacts_queue_updated_at_idx`)
  - `idx_contacts_queue_status` (subconjunto de `idx_contacts_queue_broker_status`)
- **Novas RPCs** (SECURITY DEFINER, `search_path=public`, escopadas por `has_role`/`current_broker_id`):
  - `dashboard_daily_summary(_date date, _broker uuid default null)` → totais, atendidas, agendadas, únicos por corretor.
  - `dashboard_broker_duration(_date date)` → fantasma/curta/média/longa por corretor.
  - `dashboard_ranking(_date date)`.
  - `recent_calls_for_broker(_broker uuid, _limit int default 200)` → histórico do próprio corretor.
- **RPC opcional `contacts_queue_page`** com keyset pagination (`WHERE (priority, created_at, id) < (...)`), caso alguma tela precise listar além do buffer.

### 2. `src/lib/cloud-state.ts` — bootstrap enxuto

- Remover `loadAllContacts` e `loadAllCalls` do primeiro load.
- Novo bootstrap: `brokers` + `app_settings` + últimas 200 calls do próprio corretor via `recent_calls_for_broker`.
- Manter estrutura de cache, mas guardar dataset mínimo.
- Delta sync: quando cursor for `null`, apenas setar cursor = `now()` — não paginar histórico antigo.

### 3. `src/components/dialer/DashboardTab.tsx`

- Substituir cálculos locais sobre `state.calls` pelas 3 RPCs agregadas.
- Cada painel busca ~10–30 linhas em vez de milhares.

### 4. `src/components/dialer/HistoricoTab.tsx`

- Buscar sob demanda via `recent_calls_for_broker` + filtros (data, corretor), com limit explícito. Sem depender do cache global.

### 5. Discador (`src/routes/_authenticated/index.tsx`)

- Continua usando `useContactBuffer` (já pega 10 via `dialer_prefetch_queue`). Remover qualquer leitura residual do `state.contacts` global do fluxo do discador — passar a derivar o "A SEGUIR" apenas do buffer.

## Detalhes técnicos

- **Keyset vs OFFSET**: com índice `(priority DESC, created_at, id)` já existente, keyset é O(limit) qualquer que seja a página. OFFSET era O(offset+limit).
- **SECURITY DEFINER + `search_path=public`**: as novas RPCs seguem o padrão dos RPCs existentes (`broker_daily_counts`, `dialer_prefetch_queue`) e re-verificam autorização via `has_role(auth.uid(),'admin')` ou `current_broker_id()`.
- **RLS**: nada muda em `calls`/`contacts_queue`.
- **Grants**: `GRANT EXECUTE ... TO authenticated` em cada nova RPC.
- **Realtime**: patches por linha continuam alimentando `mergeCallsRows`/`mergeContactsRows`. Fluxo já suporta chegar sem o dataset completo.

## Impacto esperado

| Métrica | Antes | Depois |
|---|---|---|
| Tempo até discador usável | 15–40s | <1s |
| Bytes no bootstrap | ~10–15 MB | ~50 KB |
| Requisições com `offset≥1000` | ~10/sessão | 0 |
| Custo de escrita em `calls`/`contacts_queue` | baseline | ~20% menor |

## Fora de escopo

Visual, auth, RLS, features do discador (buffer, timer, resultados, WhatsApp, lembretes).
