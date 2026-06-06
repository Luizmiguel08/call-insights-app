## Refatoração do Discador — Performance, Espelhamento e UX

Escopo: reescrever a tela `/` (src/routes/_authenticated/index.tsx) e componentes auxiliares para entregar todos os requisitos. Backend já tem `next_contact_for_broker` e `record_call_outcome`; nada de migrações novas, exceto habilitar Realtime em `active_calls` se ainda não estiver, para espelhar estado por dispositivo.

### 1. Performance & fila local
- Manter buffer em memória com os próximos **5 contatos** via nova RPC paginada client-side: já existe `contacts_queue` carregado no `state.contacts`; derivar `prefetchQueue` (slice 5) e usar como fonte de "Próximo" instantâneo.
- "Pular" / "Próximo" consomem do buffer local primeiro; chamada ao backend acontece em background (fire-and-forget) e o buffer se reabastece.
- Background sync a cada **60s** via `setInterval` que chama `loadCloudState()` sem bloquear UI; toast sutil "Sincronizado agora" + timestamp + bolinha verde pulsante no header.
- Contatos atualizados na última sync ganham marca `recentlyUpdatedIds` (Set) → indicador sutil (ponto âmbar) na lista.

### 2. Animação de troca de contato
- Componente `<ContactCard>` isolado com `key={contactId}` e classes `animate-[slide-in_150ms]`. Ao trocar, wrapper aplica slide-out → swap → slide-in (CSS puro, sem re-render do pai).
- Adicionar keyframes `slide-in-x` / `slide-out-x` em `src/styles.css`.

### 3. Debounce & anti-bug nos botões
- Hook `useDebouncedAction(fn, 300)` aplicado em Atendeu / Não atendeu / Agendou.
- Botões desabilitados enquanto `callStatus !== "ended"` (estados: `idle | calling | answered | ended`).
- Ao registrar resultado: limpar `notes` e `callStatus` ANTES do fetch do próximo.
- Try/catch: em falha, mostrar banner com botão "Tentar novamente" (não trava UI).

### 4. Estado local imediato da ligação
- `useState<"idle"|"calling"|"answered"|"ended">` controlado por cliques, não por API.
- Botão "Ligar agora" → vira "Encerrar ligação" com cronômetro (mm:ss) + indicador de onda animado (3 barras CSS).

### 5. Espelhamento mobile ↔ desktop (Realtime)
- Canal `dialer:{userId}` via `supabase.channel(...).on("broadcast", ...)`.
- Broadcast dos eventos: `contact_changed`, `call_status`, `notes_typed` (throttle 250ms), `outcome_recorded`.
- Receiver aplica patch local; ao receber `outcome_recorded` de outro device, avança automaticamente para o próximo do buffer.
- Sem polling — apenas o sync de 60s para o snapshot da fila.

### 6. Layout (mudanças visuais)
- **Header**: barra de progresso da meta diária (Progress component) sempre visível.
- **Card do contato**: animação de slide; rodapé fixo com "Próximo: {nome}".
- **Chips de resposta rápida** abaixo do textarea: Não atendeu / Caixa postal / Número errado / Sem interesse → preenchem `notes`.
- **Botões de resultado**: `py-3.5` (14px), `gap-2.5` (10px), cores:
  - Não Atendeu: `bg-red-900 hover:bg-red-800 text-red-50`
  - Atendeu: `bg-emerald-900 hover:bg-emerald-800 text-emerald-50`
  - Agendou: `bg-amber-700 hover:bg-amber-600 text-amber-50`
- **Barra de stats** fixa no bottom: Ligações / Atendidas / Não atendeu / Agendadas (hoje).

### 7. Arquivos a alterar
- `src/routes/_authenticated/index.tsx` — orquestração principal.
- `src/components/dialer/ContactCard.tsx` *(novo)* — card animado isolado.
- `src/components/dialer/CallControls.tsx` *(novo)* — botão ligar/encerrar + timer + onda.
- `src/components/dialer/OutcomeButtons.tsx` *(novo)* — botões grandes com debounce.
- `src/components/dialer/QuickChips.tsx` *(novo)* — chips de resposta rápida.
- `src/components/dialer/DailyProgress.tsx` *(novo)* — barra meta + stats bottom.
- `src/components/dialer/SyncIndicator.tsx` *(novo)* — bolinha + timestamp.
- `src/hooks/useDebouncedAction.ts` *(novo)*.
- `src/hooks/useDialerRealtime.ts` *(novo)* — canal broadcast.
- `src/styles.css` — keyframes slide-x e classe wave.

### 8. Fora de escopo
- Migrações de banco (uso apenas das RPCs/tabelas existentes).
- Mudanças no fluxo de autenticação ou outras rotas.
- VoIP / WebRTC (continua `tel:`).

### Diagrama de fluxo

```text
clique "Não Atendeu"
  → debounce 300ms
  → limpa notes + callStatus
  → optimistic: avança para buffer[0] (slide animation)
  → background: record_call_outcome RPC
  → broadcast outcome_recorded no canal dialer:{userId}
  → background: refill buffer (próximos 5)
```
