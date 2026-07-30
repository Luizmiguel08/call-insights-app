## Varredura do discador — o que encontrei

Rodei auditorias no banco. As correções da rodada anterior estão firmes:

| Verificação | Resultado |
|---|---|
| Ligações creditadas ao corretor errado | 0 ✅ |
| Ligações sem corretor | 0 ✅ |
| Contatos travados (pendentes com 2 tentativas) | 0 ✅ |
| Corretores sem usuário / sem permissão | 0 ✅ |

Mas achei 4 instabilidades reais ainda ativas:

### 1. Números repetidos na fila (o maior problema)
Existem **7.057 linhas duplicadas** — mesmo corretor, mesmo telefone, todas pendentes (4.922 números afetados). É por isso que o corretor liga para o mesmo cliente mais de uma vez: são registros diferentes na fila, então o sistema não os reconhece como o mesmo lead. Vem de listas importadas várias vezes ou com repetição interna.

### 2. Contatos sem telefone válido (496 pendentes)
413 contatos têm o campo de telefone em branco e outros têm menos de 10 dígitos. Eles entram na fila normalmente, o corretor recebe o lead, mas o botão de ligar não funciona — obriga a pular manualmente e polui a contagem de pendentes.

### 3. Presença "fantasma" (3 corretores)
Quando o app é fechado bruscamente (celular travando, aba morta), a linha de "está ligando agora" não é apagada. A tela já esconde depois de 90s, mas o registro fica no banco para sempre e pode reaparecer em relatórios.

### 4. Sessões e lembretes antigos acumulando
19 sessões de discagem paradas há mais de 1 dia e 2 lembretes vencidos ainda como "pendentes".

---

## Plano de correção

**Banco de dados (migração)**
1. Limpeza de duplicatas: manter apenas 1 registro pendente por corretor + telefone (fica o mais antigo, ou o que já tem tentativas registradas); os demais viram `status = 'duplicado'` — não somem do banco, só saem da fila.
2. Índice único parcial impedindo que novas importações criem pendentes duplicados para o mesmo corretor + telefone, para o problema não voltar.
3. Contatos com telefone inválido passam para `status = 'invalido'` e são excluídos da fila nas funções `dialer_prefetch_queue`, `next_contact_for_broker` e `broker_contact_lists` — assim as contagens por lista passam a refletir só o que é realmente discável.
4. Nova função de limpeza automática que apaga presença sem sinal há mais de 5 minutos, sessões paradas há mais de 1 dia e marca lembretes vencidos como expirados.

**Frontend**
5. `DiscadorTab`: se algum contato inválido escapar, o cartão mostra aviso e o botão de pular fica em destaque em vez do "Ligar" quebrado.
6. Chamada da limpeza automática ao abrir o discador (barata, no máximo 1x a cada poucos minutos) para a presença entre celular e computador nunca ficar presa.

**Verificação depois de aplicar**
- Reconferir contagens: duplicatas = 0, pendentes inválidos = 0, presença fantasma = 0.
- Relatório por corretor mostrando quantos pendentes reais cada um ficou, para confirmar que ninguém perdeu lead legítimo.

### Detalhes técnicos
Nenhuma linha é deletada — a limpeza é feita por mudança de status, então tudo é reversível. O índice único será `CREATE UNIQUE INDEX ... ON contacts_queue (broker_id, phone) WHERE status = 'pending'`, com tratamento para `broker_id` nulo (fila geral). As funções RPC mantêm a assinatura atual, só ganham o filtro de telefone válido — nenhuma mudança de contrato com o app.
