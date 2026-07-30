## O que o vídeo mostra

Na gravação, o corretor está em "Marcia Ferreira — 1ª TENTATIVA", sai para discar no iPhone e, ao voltar, a tela já está em outro cliente ("Daniel Paulista — 1ª TENTATIVA"), sem ninguém ter clicado em Não atendeu / Atendeu / Agendou.

## Causas confirmadas (verificadas no código e no banco)

**1. Contato troca sozinho ao voltar da ligação**
- Ao voltar para o app (evento de "visibilidade"), o buffer local recarrega a fila e **substitui** a lista inteira pelos 10 contatos que o banco devolve.
- O "pin" (trava do contato atual) só reordena o contato **se ele vier nessa nova leva**. Como a fila é ordenada por menor número de tentativas primeiro, o contato que já tem 1 tentativa cai para o fim da fila e não volta entre os 10 — então ele simplesmente some da tela e outro cliente assume.
- O pin também vive só na memória: se o app for descarregado enquanto a ligação está no discador nativo (comum no iPhone), ele se perde por completo.

**2. Contatos importados sumindo**
- Existe um índice único que impede dois contatos "pendentes" com o mesmo corretor + mesmo telefone.
- A importação envia os contatos em **lotes de 500 de uma vez**. Se **um único** número do lote já existir pendente na fila daquele corretor, o Postgres rejeita o **lote inteiro** — os 200/500 contatos não entram, e a mensagem de erro não deixa isso claro.
- Confirmado no banco: hoje há listas em que a maioria das linhas ficou marcada como `duplicado` (ex.: lista "recentes" com 1.874 duplicadas para 876 pendentes; "lista nova" com 829 duplicadas). Isso é o mesmo telefone repetido em listas diferentes do mesmo corretor.

## Plano de correção

### A. Trava do contato durante a ligação (frontend)
1. Em `useContactBuffer`: o contato "travado" passa a ser **soberano** — se ele não vier no recarregamento, é buscado individualmente pelo id e recolocado na frente da fila, em vez de desaparecer.
2. Persistir o id travado no aparelho (localStorage) e reidratá-lo ao abrir o app, para sobreviver ao app ser descarregado enquanto o iPhone está no discador.
3. Bloquear qualquer remoção/avanço automático do contato travado: só sai da tela quando o corretor clicar em Não atendeu / Atendeu / Agendou, ou em Pular.
4. Isso vale igualmente para a 2ª tentativa (hoje o problema é pior nela, por causa da ordenação).

### B. Ordenação da fila (banco)
5. Ajustar `dialer_prefetch_queue` e `next_contact_for_broker` para que um contato do próprio corretor que já tem 1 tentativa **em andamento hoje** não seja jogado para o fim da fila, e continue disponível no buffer — sem alterar a assinatura das funções.

### C. Importação de listas (frontend)
6. Antes de importar, consultar os telefones já pendentes daquele corretor e separar os repetidos: eles não são enviados, e o resultado mostra "X importados, Y já estavam na fila".
7. Enviar em lotes menores e, se um lote falhar por telefone repetido, reprocessar **linha a linha** — assim uma colisão nunca derruba os outros 199 contatos.
8. Mensagem de resultado detalhada (importados / já existiam / com erro) em vez do erro genérico atual.

### D. Verificação após aplicar
- Simular importação com números repetidos e confirmar que os novos entram e só os repetidos são ignorados.
- Percorrer 1ª e 2ª tentativa saindo do app durante a ligação e confirmar que o contato permanece na tela até o clique.
- Relatório por corretor com pendentes reais por lista, para confirmar que nada legítimo ficou fora.

### Detalhes técnicos
Nenhum dado é apagado. O índice `uniq_contacts_queue_pending_broker_phone` é mantido (ele é o que evita ligar duas vezes para o mesmo lead) — o que muda é o cliente tratar a colisão de forma graciosa. As mudanças de banco são apenas nas funções de leitura da fila (`dialer_prefetch_queue`, `next_contact_for_broker`), sem mudança de contrato com o app.
