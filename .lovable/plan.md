
## Diagnóstico — o que está acontecendo agora

Analisei os logs de rede da tela do discador (25 segundos, 1 usuário logado). Nesse período o app fez **~40 requisições**, todas repetidas em loop:

| Requisição | Origem | Frequência hoje | Aparece nos logs |
|---|---|---|---|
| `rpc/next_contact_for_broker` | `_authenticated/index.tsx:1079` `setInterval(1200ms)` | **~1x por segundo** | 19 chamadas em 25s |
| `active_calls?...` | `_authenticated/index.tsx:789` `setInterval(2000ms)` | ~1x a cada 2s | 11 chamadas |
| `contacts_queue` (delta) | `cloud-state.ts:840` `setInterval(5000ms)` | 1x a cada 5s | 4 chamadas |
| `calls` (delta) | mesmo | 1x a cada 5s | 4 chamadas |
| `brokers` (full) | mesmo | 1x a cada 5s | 4 chamadas |
| `app_settings` (full) | mesmo | 1x a cada 5s | 4 chamadas |
| `call_reminders` | poller do LembretesTab | 1x a cada 5s | 4 chamadas |

**Todas** as tabelas acima já têm subscription Realtime ativa. O polling existe só como "fallback caso o WebSocket caia" — mas ele roda o tempo todo, mesmo com WS conectado.

**Impacto real:**
- Com 17 corretores online = **~27 req/segundo** batendo constantemente no Postgres + PostgREST, mesmo sem ninguém clicando em nada.
- `next_contact_for_broker` faz `ORDER BY` em `contacts_queue` (34k linhas) toda vez. É a query mais cara sendo executada 1x/segundo × 17 usuários = ~60x/minuto por corretor.
- No mobile isso ainda esgota bateria e satura o rádio (cada request abre keep-alive HTTPS).
- O tempo real "para trocar de contato" não melhora com esse poll — o Realtime já entrega o evento em ~200ms. O poll de 1.2s na verdade **atrasa** a UI porque enfileira refetches em cima do evento realtime.

## Estratégia — Realtime-first, poll apenas como watchdog

Princípio: **se o Realtime está conectado, não fazer poll**. Se cair (evento `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`, ou `navigator.onLine === false`), aí sim ligar um poll curto até reconectar.

Nenhuma dessas mudanças afeta usabilidade — todo o UX de "próximo contato aparece na hora" continua funcionando via Realtime, que já está lá e funcionando.

### 1. `next_contact_for_broker` — de 1x/seg para on-event

Hoje: `setInterval(scheduleHeadRefresh, 1200ms)` (`_authenticated/index.tsx:1079`).

Novo comportamento:
- Chama 1x no mount (já faz).
- Chama quando chega evento realtime de `contacts_queue` ou `calls` do broker (já faz).
- Chama depois que o usuário registra outcome (já faz implicitamente).
- **Remove o setInterval de 1.2s.**
- Adiciona watchdog: se o canal Realtime reportar `CHANNEL_ERROR`/`CLOSED`, liga poll de 5s até voltar `SUBSCRIBED`.

Resultado: de ~50 chamadas/min → tipicamente 1–3 chamadas/min por corretor (só quando algo muda de verdade).

### 2. `active_calls` — remove poll fixo, mantém só watchdog

Hoje: `setInterval(load, 2000ms)` (`_authenticated/index.tsx:789`) + Realtime na mesma tabela.

Novo:
- Load inicial (1x).
- Subscription Realtime (já existe) empurra qualquer mudança.
- Poll só se `channel.state !== "joined"`.

De 30 chamadas/min → ~1 chamada por sessão + eventos.

### 3. `refetchCloud` (bootstrap 5s) — reduz e condiciona ao WS

Hoje: `setInterval(refetchCloud, 5000ms)` em `_authenticated/index.tsx:840` — dispara 4 queries (`brokers`, `app_settings`, `contacts_queue` delta, `calls` delta) a cada 5s.

Novo:
- `brokers` e `app_settings` mudam raramente → carregam 1x no bootstrap; Realtime nas duas tabelas (`cloud-state.ts:767,770`) já dispara refetch quando muda. Remove do intervalo.
- `contacts_queue` e `calls` delta: mantém, mas troca de **5s → 30s** como watchdog. Como o Realtime granular já está patchando o estado local (`mergeContactsRows`/`mergeCallsRows`, `cloud-state.ts:483-522`), o delta a cada 30s serve só pra pegar coisa que escapou (raro).
- Se o WS cair, retomar delta 5s até reconectar.

De 48 requests/min → ~4 requests/min por corretor em regime normal.

### 4. `call_reminders` — alinha ao intervalo real

Hoje: aparece 1x a cada 5s nos logs, mas o `LembretesTab.tsx:414` está com `setInterval(check, 30000)`. Ou seja, tem **outro poller** de lembretes rodando em paralelo (provavelmente o `useReminderNotifier` global montado no root). Vou identificar o segundo poller e:
- Consolidar: 1 único poller de lembretes a cada 60s (é notificação, latência de 1 min é aceitável).
- Substituir por Realtime + `scheduled_for` como cursor: subscrever INSERT/UPDATE em `call_reminders` e disparar timers locais baseados em `scheduled_for`. Zero polling em regime normal.

De 12 req/min → ~1 req/min.

### 5. Pausar tudo quando a aba não está visível

Adiciona listener global de `document.visibilitychange`: quando `hidden`, cancela intervalos; quando volta a `visible`, faz 1 refetch imediato e religa. No mobile isso é o maior ganho de bateria e evita a "fila de requests" que dispara junto quando o usuário volta pro app.

### 6. Watchdog centralizado de conexão

Um único hook (`useConnectionWatchdog`) que:
- Observa status dos canais Realtime principais.
- Observa `navigator.onLine`.
- Expõe um `mode: "live" | "degraded"`.
- Todos os polls consomem esse hook: se `live`, poll desligado; se `degraded`, poll curto.

Isso substitui a lógica atual de "polling defensivo sempre ligado".

## Impacto esperado

Em regime normal (Realtime funcionando, que é 99% do tempo):

| Métrica | Hoje | Depois | Redução |
|---|---|---|---|
| Requests/min por corretor (ocioso) | ~96 | ~4 | **–96%** |
| Chamadas `next_contact_for_broker`/min | ~50 | ~1 | **–98%** |
| Chamadas `active_calls`/min | ~30 | ~0 | **–100%** |
| Carga DB total (17 corretores) | ~27 req/s | ~1 req/s | **–96%** |
| Latência percebida ao clicar outcome | ~1200ms (fila de polls) | ~200ms (evento realtime) | **~6x** |
| Bateria mobile em uso contínuo | referência | notável melhora | — |

Sem impacto em UX: a fila continua avançando na mesma velocidade (na verdade mais rápido, porque o Realtime já era mais rápido que o poll de 1.2s — o poll estava atrapalhando).

## Escopo desta entrega

Uma única leva:

1. Criar `src/hooks/useConnectionWatchdog.ts` — observa status Realtime + `navigator.onLine`, expõe `mode`.
2. Editar `src/routes/_authenticated/index.tsx`:
   - Remover `setInterval(1200ms)` do head-poll (linha 1079); passar a depender do Realtime + watchdog.
   - Remover `setInterval(2000ms)` do `active_calls` load (linha 789); poll só se watchdog em `degraded`.
   - Adicionar `visibilitychange` gate em todos os intervalos remanescentes.
3. Editar `src/lib/cloud-state.ts`:
   - `setInterval(5000ms)` de refetch (linha ~840, hoje em index.tsx): passa a rodar 30s em `live`, 5s em `degraded`.
   - Tira `brokers` e `app_settings` do intervalo (já cobertos por Realtime).
4. Editar `LembretesTab.tsx` + notifier global: unificar em 1 poller de 60s, com Realtime empurrando eventos.

**Não mexo em:** visual, autenticação, RLS, RPCs do banco, schema, `useContactBuffer`, layout, botões, cores.

## Alternativa mais conservadora (se preferir só o mais crítico agora)

Se quiser um alívio imediato sem tocar em `cloud-state.ts` nem lembretes:
- **Só remover o poll de 1.2s de `next_contact_for_broker`** e o poll de 2s de `active_calls`.
- Isso sozinho já corta ~80% das requisições e é uma edição em 1 arquivo (`_authenticated/index.tsx`).
- Posso fazer isso em 5 minutos e o resto fica pra depois.

Me diz se aprova o plano completo (as 4 mudanças) ou prefere só o alívio imediato primeiro.
