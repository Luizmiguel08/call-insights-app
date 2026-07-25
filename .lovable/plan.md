## Promover o redesign para a página principal

Vou tornar o design "Soft Bento Minimal / Fortal" o discador oficial, substituindo a tela atual em `/` (rota `_authenticated/index.tsx`), preservando toda a lógica de negócio que já funciona.

### O que muda

1. **Substituir o conteúdo de `src/routes/_authenticated/index.tsx`**
   - Mover a UI completa de `src/routes/_authenticated/redesign.tsx` para dentro de `index.tsx`.
   - Manter o `head()` atual (título/meta) do index — não copiar o do redesign.
   - Preservar todos os hooks já integrados no redesign: `useCloudState`, `useContactBuffer`, `useReminderNotifier`, `record_call_outcome`, timer de ligação, template switcher WhatsApp, histórico da 1ª tentativa, etc.

2. **Remover a rota `/redesign`**
   - Apagar `src/routes/_authenticated/redesign.tsx` (não faz mais sentido manter duplicado).
   - Remover qualquer link de navegação apontando para `/redesign` (verificar navbar/menu).

3. **Verificar dependências compartilhadas**
   - Confirmar que fontes Sora + Manrope continuam carregadas no `__root.tsx` (já estão).
   - Confirmar que tokens de cor Fortal (navy + gold) usados no redesign existem em `src/styles.css` — se estiverem inline no arquivo do redesign, promovê-los para tokens globais para manter consistência com as outras abas (Dashboard, Lembretes, Rápido).

4. **Sanidade das abas irmãs**
   - `DashboardTab`, `LembretesTab`, `RapidoTab` continuam sendo renderizadas pelo index — validar que a nova moldura (header/tabs) do redesign as acomoda corretamente e que nada quebrou visualmente.

### O que NÃO muda

- Schema do banco, RPCs, RLS, migrações — nada.
- Lógica de fila, contagem de tentativas, deferimento, realtime, cache local.
- Rotas de convite, auth, admin.

### Riscos e mitigação

- **Estado/hook duplicado**: garantir que só existe uma instância de `useCloudState`/`useContactBuffer` na árvore após a fusão.
- **Divergências sutis**: o index atual pode ter correções recentes (ex.: `forcedCurrentContactId`, fallback de myQueue, badges de lembrete) que o redesign não tem. Vou reconciliar essas ao migrar, não simplesmente sobrescrever.
- **Tokens hardcoded**: se o redesign usa cores literais, movê-las para `styles.css` antes de promover.

### Entregável

- `/` renderiza o novo design como discador principal.
- `/redesign` deixa de existir (404 ou redirect para `/`).
- Todas as funcionalidades atuais continuam operando sem regressão.
