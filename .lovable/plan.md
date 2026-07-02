
## Diagnóstico (o que descobri)

Rodei análise de queries lentas no banco. **Uma única causa** responde por praticamente toda a lentidão, travamento e "carregamento infinito" que você sente — especialmente no celular:

Todo cliente que abre o app (cada corretor, cada aba, cada refresh) está baixando **a tabela `calls` inteira (25.958 linhas) + a tabela `contacts_queue` inteira (20.626 linhas)** — quase 46 mil linhas — em páginas de 1000. Isso acontece em `src/lib/cloud-state.ts` nas funções `loadAllCalls` / `loadAllContacts`, e continua acontecendo em delta polls.

Números reais do banco (última janela):
- `SELECT * FROM contacts_queue` sem filtro: **217 mil execuções**, média **896ms**, total 194 segundos de banco
- `SELECT * FROM calls` sem filtro: **243 mil execuções**, média **736ms**, total 179 segundos de banco
- No 3G/4G isso vira 30–60 segundos de "tela branca" no celular, além de estourar memória do navegador

Isso também explica os "números diferentes": cada aba está calculando métricas de um snapshot local de 46k linhas que pode estar parcialmente sincronizado.

## O plano

Trocar o modelo "baixa tudo, calcula no cliente" por "servidor calcula, cliente pede só o que precisa". Sem mudar visual nem features — só a fonte dos dados.

### 1. Dashboard vira servidor-agregado (grande ganho)

Criar RPCs no banco que retornam **já agregado**:
- `dashboard_daily_summary(_date)` → total ligações, atendidas, agendadas, únicas, por corretor no dia
- `dashboard_broker_duration(_date)` → duração por corretor (fantasma/curta/média/longa), já contando contatos únicos
- `dashboard_ranking(_date)` → ranking do dia

Cada RPC retorna ~10-30 linhas em vez de 25 mil. `DashboardTab` passa a chamar essas RPCs.

### 2. Discador só usa o buffer (já existe)

`dialer_prefetch_queue` já traz 10 contatos por vez. Remover qualquer leitura da lista completa de `contacts_queue` do fluxo do discador. O `RapidoTab` idem.

### 3. Histórico paginado sob demanda

Aba Histórico passa a buscar com filtro (`.gte('created_at', hoje).eq('broker_id', X).limit(200)`) em vez de usar o cache global de 25k calls.

### 4. Cortar o `cloud-state` global para dados leves

Manter só `brokers`, `app_settings`, e talvez os últimos 500 registros de calls/contacts do próprio corretor para telas que dependem de estado local. Zerar os loops de "baixa tudo".

### 5. Índices que faltam para as novas RPCs

```
CREATE INDEX ON public.calls (broker_id, created_at DESC);
CREATE INDEX ON public.calls (contact_id, created_at DESC);
CREATE INDEX ON public.contacts_queue (broker_id, status) WHERE status = 'pending';
```

### 6. Silenciar erros barulhentos

O toast "Falha ao sincronizar" hoje dispara em qualquer timeout de rede móvel. Com o novo modelo (queries pequenas) isso praticamente some, mas também vou reduzir retries em cascata.

## Impacto esperado

- Tempo até dashboard usável: **~30s → ~1s** no celular
- Trânsito por sessão: **~15 MB → ~50 KB**
- Fim da tela branca no login em 3G/4G
- Números do dashboard passam a bater sempre (fonte única = servidor)

## Escopo desta entrega

Faço em uma leva:
1. Migration com as 3 RPCs + índices
2. Refactor de `DashboardTab.tsx` para chamar as RPCs
3. Cortar `loadAllCalls`/`loadAllContacts` em `cloud-state.ts`, deixando só o essencial
4. `RapidoTab` e discador puxando só do buffer/queries filtradas

Não mexo em: visual, autenticação, permissões, RLS, features novas.

## Alternativa (se preferir mais rápido)

Se quiser um alívio imediato **hoje**, posso só limitar `loadAllCalls`/`loadAllContacts` aos últimos 7 dias e ao próprio corretor — corta ~90% do problema em 1 edição, sem criar RPCs. Depois faço o refactor completo.

Me diz se aprova o plano completo ou prefere o alívio imediato primeiro.
