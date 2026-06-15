## Objetivo
Introduzir multi-tenancy (`organizations`) e fluxo de convites por token, reaproveitando `/auth` e adicionando `/convite/$token`.

## Fase 1 — Schema base (migration 1)

**Novas tabelas**
- `organizations` — nome, `created_by`, timestamps
- `organization_members` — `organization_id`, `user_id`, `role` (`owner`/`admin`/`agent`), `joined_at`, unique(`org_id`,`user_id`)
- `organization_invites` — `organization_id`, `email` (opcional), `token` (uuid único), `role`, `status` (`pending`/`accepted`/`revoked`), `expires_at`, `created_by`, `accepted_by`, `accepted_at`

**Helpers (SECURITY DEFINER)**
- `current_org_id()` — retorna a org do `auth.uid()` (primeira membership, se houver várias)
- `is_org_member(_org uuid)` — bool
- `is_org_admin(_org uuid)` — bool (`owner` ou `admin`)
- `accept_organization_invite(_token uuid)` — valida token, cria `organization_members`, marca convite como `accepted`, retorna `organization_id`. Faz tudo numa transação, dedupe por unique constraint.

**Grants + RLS** em todas as 3 tabelas (sem `anon`):
- `organizations`: SELECT para membros; INSERT/UPDATE só admin da própria org
- `organization_members`: SELECT só de orgs onde o user é membro; INSERT só via `accept_organization_invite` (deny direto); DELETE só admin
- `organization_invites`: SELECT/INSERT/UPDATE só admin da org; **SELECT por token** liberado em RPC `get_invite_by_token(_token)` SECURITY DEFINER (não expor a tabela pra anon)

**Default org + backfill**
- Cria uma organização "Fortal" e adiciona todos os usuários atuais de `brokers` como `organization_members` com role `agent`; o primeiro admin (`has_role('admin')`) vira `owner`.

## Fase 2 — Acoplar dados existentes (migration 2)

Adicionar `organization_id uuid` (com FK e índice) nas tabelas operacionais:
- `brokers`, `contacts_queue`, `calls`, `contact_attempts`, `dialer_sessions`, `broker_sessions`, `broker_pauses`, `call_reminders`, `active_calls`, `dialer_error_log`, `queue_reconciliation_log`

**Backfill**: preencher tudo com o id da org default.
Depois: `NOT NULL` + default via trigger (`current_org_id()` no INSERT).

**Atualizar RLS** de cada tabela: trocar regras atuais por `is_org_member(organization_id)` + manter regras por broker quando fizer sentido (ex.: corretor só vê seus contatos dentro da org).

**Atualizar funções existentes** (`record_call_outcome`, `next_contact_for_broker`, `dialer_prefetch_queue`, `reconcile_contact_queue`, `admin_clear_contacts`, etc.) para filtrar por `current_org_id()`.

> ⚠️ Risco: essa fase mexe em quase todas as policies. Vou rodar uma migration **idempotente e reversível** e pedir aprovação separadamente da Fase 1.

## Fase 3 — Frontend

**`src/routes/convite.$token.tsx`** (público)
1. `supabase.rpc('get_invite_by_token', { _token })` — se inválido/expirado, mostra `InviteErrorPage` (`invalid_or_expired`).
2. Se `!user` → guarda token em `sessionStorage('pending_invite')` e `navigate({ to: '/auth', search: { invite: token } })`.
3. Se logado → `supabase.rpc('accept_organization_invite', { _token })`. Erro → `InviteErrorPage` (`failed_to_join`). Sucesso → `navigate({ to: '/', replace: true })`.

**`src/routes/auth.tsx`**
- Lê `?invite=` (ou `sessionStorage`).
- Após signup/login bem-sucedido, se houver token pendente, redireciona para `/convite/$token` em vez de `/`.

**`InviteErrorPage`** — componente compartilhado com as duas mensagens do snippet.

**`AppErrorBoundary`** — classe React em `src/components/AppErrorBoundary.tsx`, envolvendo `<Outlet/>` em `src/routes/__root.tsx` (dentro do `QueryClientProvider`).

## Fora de escopo (confirmar se quer depois)
- UI para **criar/listar/revogar convites** (admin)
- Suporte a usuário pertencer a **múltiplas orgs** + seletor de org ativa
- Envio de e-mail do convite (por enquanto o admin copia o link `/convite/$token`)

## Ordem de execução
1. Migration Fase 1 (aprovação) → tipos regenerados
2. Migration Fase 2 (aprovação separada) → tipos regenerados
3. Código frontend (rota, auth, ErrorBoundary, InviteErrorPage)
4. Smoke test no preview com um convite manual via `psql`

Confirma esse plano (ou ajusta o que estiver fora) que eu começo pela migration da Fase 1.