# Operação Área — preparação da Etapa 2b (nuvem)

> **Estado: nada foi criado.** Não existe projeto Supabase hospedado, Cloudflare Pages ou qualquer serviço externo. Este documento só registra as decisões e o roteiro de verificação. **A Etapa 2b só começa com uma nova autorização expressa.**

## 1. Decisões registradas (Etapa 2a.1)

| # | Decisão | Onde está no projeto |
|---|---|---|
| 1 | Dicas bloqueadas até o envio da hipótese inicial. Percurso: diagnóstico → exploração → hipótese inicial **sem dicas** → dicas/revisões → saída | Servidor (`record_hint`), `DemoRepository`, interface; testes unitários, de contrato, da stack local e E2E |
| 2 | Sem contagem regressiva exata do limite de entradas; só mensagem orientando aguardar e tentar de novo | Mensagem `RATE_LIMITED` mantida |
| 3 | Piloto: um dispositivo por equipe; não alterar o limite de 30 logins anônimos/h/IP agora | Nada a alterar |
| 4 | Na 2b, verificar se `rate_limit_anonymous_users` é configurável no plano gratuito; **não alterar sem documentar** | Roteiro 2.1 |
| 5 | Retenção de 30 dias; testar `pg_cron` para `purge_expired_data()`; exclusão manual como alternativa | Roteiro 2.3; botão "Apagar esta sessão e seus dados" já existe |
| 6 | Conta docente criada e adicionada à tabela `teachers` **manualmente**; nenhuma função do app promove usuários | Teste automático: nenhuma função escreve em `teachers` |
| 7 | Verificar/restaurar o projeto gratuito no dia anterior à aula; **sem keep-alive** | Procedimento de aula (seção 3) |
| 8 | Mensagem do estudante em falha de servidor: "Não foi possível conectar ao servidor. Verifique a conexão e avise o professor." | `SERVER_UNREACHABLE`; testada no E2E |
| 9 | Orientação extra ao professor para verificar se o Supabase está ativo | Painel docente (aparece quando a conexão cai) |
| 10 | Sem backup automático adequado: a **exportação pedagógica anônima** é a evidência preservada antes da exclusão dos dados brutos | Painel avisa a data de exclusão e lembra de baixar a exportação |
| 11 | Justificativa: mínimo reduzido de 8 para **2 caracteres**; máximo (500) e proteção contra dados pessoais mantidos | `LIMITS.justificationMin = 2`, SQL e restrição do banco |

## 2. Roteiro de verificação no projeto hospedado (2b) — registrar o resultado de cada item

Para cada item: anotar **o que foi encontrado, a data e quem alterou**. Nada de configuração é alterado sem registro.

### 2.1 Limite de logins anônimos (`rate_limit_anonymous_users`)
- Onde: *Authentication → Rate Limits*.
- Registrar o valor atual (esperado: 30 por hora por IP) e **se o campo é editável no plano gratuito**.
- Se for editável: **não alterar** neste momento (decisão 3); apenas documentar. Se não for: documentar a limitação e manter "um dispositivo por equipe".
- Teste de campo (2c) com todos os tablets na rede da escola: contar quantas entradas passam.

### 2.2 Autenticação
- *Sign In / Providers*: **Anonymous sign-ins ligado**; e-mail/senha ligado (professor).
- **"Allow new users to sign up" deve ficar LIGADO**: no teste local, desligá-lo bloqueia também o login anônimo dos estudantes (HTTP 422 `signup_disabled`). A proteção contra contas intrusas é a tabela `teachers` (testada), não o bloqueio de cadastro.
- Conferir "Confirm email" (contas de e-mail criadas por terceiros não abrem sessão sem confirmar).
- Usar no aplicativo **só a chave pública** (anon/publishable). A chave secreta/`service_role` nunca vai ao navegador nem ao repositório (`npm run check:secrets` verifica o build).

### 2.3 Retenção de 30 dias com `pg_cron`
1. Verificar se `pg_cron` pode ser habilitado no plano gratuito (*Database → Extensions*).
2. Se sim, agendar (exemplo; ajustar o horário): `select cron.schedule('operacao-area-retencao', '15 3 * * *', $$select public.purge_expired_data()$$);`
3. **Provar que funciona** antes de confiar: criar uma sessão de teste, ajustar `retention_until` para o passado, executar `select public.purge_expired_data();` à mão e conferir o resultado (`sessoes_apagadas`); depois conferir a execução agendada em `cron.job_run_details`.
4. Conferir o campo `logins_anonimos_apagados`: valor **-1** significa que a função não tem permissão no schema `auth` do projeto hospedado (documentar; a exclusão de equipes/respostas não depende disso).
5. **Se `pg_cron` não estiver disponível:** manter a exclusão manual (botão "Apagar esta sessão e seus dados") ou executar `purge_expired_data()` com a chave de serviço, sempre **depois** de baixar a exportação anônima.

### 2.4 Conta docente (manual, uma vez)
1. *Authentication → Users → Add user*: e-mail institucional e senha forte (confirmar automaticamente).
2. No *SQL Editor*: `insert into public.teachers (user_id) values ('<uuid do usuário>');`
3. Entrar no painel pelo aplicativo e conferir que as funções docentes funcionam.
4. Nenhuma função do aplicativo promove usuários (verificado por teste automático): este passo é, de propósito, manual.

### 2.5 Pausa por inatividade (sem keep-alive)
- Descobrir e anotar **como um projeto pausado se comporta** para o aplicativo (código HTTP, tempo, mensagem) e se o painel docente mostra a orientação correta.
- Procedimento de aula (seção 3). Nenhuma rotina agendada faz consultas só para manter o projeto ativo.

### 2.6 Tempo real e permissões
- *Database → Publications*: `supabase_realtime` contém `sessions, teams, submissions, hint_events, interventions, projection` (a migração já inclui).
- Conferir que o papel `postgres` consegue aplicar as migrações; conferir as funções em *Database → Functions* e as políticas em *Authentication → Policies*.

### 2.7 Backups
- Confirmar o que o plano gratuito oferece. **Premissa aprovada:** não contar com backup; a **exportação anônima** (JSON e CSV) é a evidência pedagógica preservada.

## 3. Procedimento de aula (a ser repetido a cada uso)

1. **Dia anterior:** abrir o painel docente (aplicativo hospedado) e entrar. Se aparecer a orientação de conexão, verificar no painel do Supabase se o projeto está **pausado** e restaurá-lo; esperar alguns minutos.
2. **No dia, antes dos estudantes:** entrar, abrir a sessão, conferir "Conexão: Conectado", projetar o código/QR.
3. **Durante:** painel e projeção; mediação e notas.
4. **Depois:** encerrar a sessão → **baixar a exportação anônima (JSON e CSV)** e guardar fora do Supabase (com a autorização institucional aplicável) → apagar a sessão (botão) **ou** deixar a exclusão automática de 30 dias.
5. Plano B se o servidor não responder: modo DEMONSTRAÇÃO local + folha de papel equivalente.

## 4. Variáveis de ambiente (build do aplicativo; nada secreto)

| Variável | Valor | Segredo? |
|---|---|---|
| `VITE_BACKEND` | `supabase` | Não |
| `VITE_SUPABASE_URL` | URL do projeto | Não |
| `VITE_SUPABASE_ANON_KEY` | chave **pública** (anon/publishable) | Não (protegida pela RLS) |

Chaves secretas, senha do banco e tokens de CI ficam só em cofre/secrets do serviço, nunca no repositório.

## 5. O que NÃO será feito sem nova autorização

Criar projeto Supabase hospedado ou Cloudflare Pages; publicar o aplicativo; alterar limites de Auth; ativar plano pago; criar rotina de keep-alive; guardar dados reais de estudantes.
