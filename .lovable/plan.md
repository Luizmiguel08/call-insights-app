## Diagnóstico confirmado

Essa URL não é uma única requisição presa: ela é uma **página de uma varredura sequencial**. O frontend busca `contacts_queue` em lotes de 1.000 até baixar todos os pendentes. Hoje existem **22.502 contatos pendentes**, então uma carga completa gera aproximadamente 23 chamadas como essa.

O loop contínuo **não é necessário nem é a arquitetura mais robusta** para o discador. Ele acontece porque:

- `loadAllContacts()` baixa toda a fila pendente para montar `state.contacts` no navegador.
- O discador ainda calcula `myQueue` e as listas a partir desse dataset completo.
- Uma carga completa é acionada no primeiro acesso sem cache, após mais de 5 minutos com a aba oculta e periodicamente como reconciliação.
- Se qualquer delta falhar, o código cai automaticamente em `loadAll()`, zera os cursores e pode iniciar outra varredura completa.
- Além disso, o discador mantém uma reconciliação a cada 30 segundos; normalmente ela é incremental, mas falhas de cursor podem transformá-la novamente em carga completa.
- Já existe no backend a RPC `dialer_prefetch_queue`, que retorna apenas os próximos 10 contatos, mas o hook de buffer não está sendo usado pelo discador atual.

Os índices necessários para a ordenação principal já existem; o maior problema agora é **volume e estratégia de carregamento**, não falta de índice nessa URL.

## Plano de correção

1. **Trocar o discador para buffer pequeno do backend**
   - Integrar `useContactBuffer` ao fluxo real do discador.
   - Carregar somente os próximos 10 contatos pela `dialer_prefetch_queue`.
   - Reabastecer silenciosamente quando restarem 3, sem bloquear o clique nem baixar os 22 mil pendentes.
   - Manter o próximo contato definido pelo banco para preservar prioridade, tentativas e sincronização entre dispositivos.

2. **Remover a fila completa do bootstrap do discador**
   - Parar de chamar `loadAllContacts()` para operar a tela principal.
   - Separar estado operacional do discador de dados administrativos/históricos.
   - Buscar nomes de listas por uma consulta agregada pequena, em vez de derivá-los de todos os contatos.

3. **Paginar a aba Fila sob demanda**
   - A aba de gerenciamento continuará mostrando contatos, mas por páginas/filtros no servidor.
   - Não manter dezenas de milhares de registros em memória ou no `localStorage`.
   - Buscar a próxima página apenas quando o usuário navegar/rolar.

4. **Tornar a sincronização Realtime-first sem fallback explosivo**
   - Usar eventos em tempo real para invalidar/recarregar somente o buffer afetado.
   - Manter um watchdog espaçado apenas para conferir o head da fila.
   - Em erro de delta, não executar imediatamente uma varredura total; preservar o cursor, aplicar retry com backoff e mostrar estado degradado.
   - Substituir a reconciliação completa periódica por uma consulta pequena de versão/contagem ou por reload do buffer.

5. **Unificar as duas fontes de “próximo contato”**
   - Evitar concorrência entre `next_contact_for_broker`, `state.contacts` e o buffer.
   - Tornar `dialer_prefetch_queue` a fonte única da sequência exibida.
   - Atualizar/remover um contato do buffer de forma otimista após o resultado e confirmar em segundo plano.

6. **Validar comportamento e carga**
   - Confirmar que abrir o discador gera uma consulta pequena, não dezenas de páginas de 1.000.
   - Testar troca de corretor/lista, primeira e segunda tentativas, dois dispositivos, retorno de aba oculta e falha temporária de conexão.
   - Verificar que a aba Fila permanece funcional com paginação e que os eventos em tempo real atualizam o contato atual sem loops.

## Resultado esperado

- A rota mostrada deixa de aparecer em sequência no uso normal do discador.
- A abertura passa de dezenas de milhares de linhas para cerca de 10 contatos.
- O consumo de rede e memória cai drasticamente.
- Realtime melhora a velocidade, enquanto retry com backoff garante robustez sem provocar uma nova carga completa a cada falha.