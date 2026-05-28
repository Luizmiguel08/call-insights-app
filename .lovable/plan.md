## Estrutura Base do Discador (antes do VoIP)

### Objetivo
Construir a estrutura completa de um discador estilo call-center (como o 3C Plus), mas usando discagem via `tel:` (celular/computador) por enquanto. Quando tudo estiver funcionando, substituímos pela discagem VoIP.

### O que será construído

#### 1. Banco de dados — novas tabelas
- **contacts_queue** — fila de contatos para discar
  - nome, telefone, corretor atribuído, status (pendente/discado/pulado), observação, prioridade
- **calls** — expandir com campo `outcome` (tabulação)
  - attended, no_answer, voicemail, wrong_number, callback_requested, not_interested
- **broker_sessions** — controle de login/presença do corretor
  - corretor, início, fim, tempo total pausado
- **broker_pauses** — registro de cada pausa
  - sessão, motivo (almoço, banheiro, reunião, outro), início, fim

#### 2. Tela de importação de contatos (/fila)
- Colar lista (nome + telefone) ou upload CSV
- Atribuir a um corretor ou deixar como fila geral
- Visualizar contatos pendentes
- Priorizar contatos

#### 3. Discador com fila (atualizar /)
- Ao invés de digitar nome/telefone, o sistema mostra o **próximo contato da fila**
- Botão "Discar" usa `tel:` (como hoje)
- Durante a ligação: timer + botão "Finalizar"
- Após finalizar: **tabulação rápida** com botões (não mais switches)
  - Atendeu / Não atendeu / Caixa postal / Número errado / Retornar / Agendou
- Após tabular: próximo contato carrega automaticamente (discagem progressiva)

#### 4. Pausas no discador
- Botão "Pausar" com motivos: Almoço, Banheiro, Reunião, Outro
- Timer de pausa visível
- Status do corretor: Disponível / Em ligação / Pausado

#### 5. Dashboard aprimorado (/dashboard)
- Métricas por corretor:
  - Total de ligações
  - Ligações atendidas / não atendidas / caixa postal / número errado
  - Tempo médio de atendimento (TMA)
  - Ligações por hora
  - Tempo em pausa
- Ranking ao vivo
- Filtro por período (hoje / 7 dias / mês)

#### 6. Tela de controle de presença
- Corretor "entra" (inicia sessão) ao começar
- Corretor "sai" (encerra sessão) ao terminar
- Histórico de sessões por corretor

### O que NÃO será feito agora (futuro VoIP)
- Discagem direta pelo navegador (WebRTC/Twilio)
- Gravação de chamadas
- URA / transferência / conferência
- Discagem preditiva (múltiplas linhas)

### Fluxo do corretor
```
Entrar no sistema → Selecionar corretor → Iniciar sessão
→ Próximo contato da fila aparece → Discar (tel:)
→ Finalizar → Tabular resultado → Próximo contato (automático)
→ Pausar (se precisar) → Encerrar sessão ao terminar
```

### Tecnologia
- TanStack Start + React + Tailwind
- Supabase (Lovable Cloud) para dados
- TanStack Query para cache
- Sem custo adicional de telefonia até o VoIP

---

Quando aprovar, começo pela migração do banco e depois as telas.