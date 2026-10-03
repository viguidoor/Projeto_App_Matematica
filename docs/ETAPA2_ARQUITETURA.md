# Operação Área: arquitetura proposta para a Etapa 2

**Estado:** proposta para aprovação. **Nada disto foi implementado.** O app continua em modo DEMONSTRAÇÃO. Esta versão **substitui** `ETAPA2_PROPOSTA.md` (que considerava só o Firebase) e **muda minha recomendação**, pelos motivos da seção 2.

> **Nome do projeto:** `operacao-area`. Não há referência ao nome antigo em nenhum arquivo do projeto. Restam dois lugares que dependem de você: o repositório do GitHub (*Settings → General → Repository name*; o GitHub redireciona o endereço antigo) e a pasta local. Depois: `git remote set-url origin https://github.com/viguidoor/operacao-area`.

Os números externos têm link para a fonte. Eu **não consegui abrir os sites oficiais** (Firebase e Supabase estão bloqueados no meu ambiente); os valores vêm de resultados de busca e de páginas de terceiros. **Confira nas páginas oficiais antes de decidir qualquer coisa que envolva dinheiro.**

---

## 1. Proposta técnica: vários tablets → painel do professor, em tempo real

```
Tablets (Chrome/Safari/Firefox, qualquer aparelho)     Notebook do professor       TV / projetor
 app React estático (HTTPS)                             mesmo app, #/professor      mesmo app, #/projecao
 login ANÔNIMO + código da sessão                       login com conta docente     sem login; lê só a
        │                                                      │                    projeção publicada
        │ chamadas a funções do banco (RPC)                    │ leitura + escuta Realtime        │
        ▼                                                      ▼                                  ▼
 ┌──────────────────────────── Backend gerenciado (Postgres + Auth + Realtime) ──────────────────────┐
 │ Estudante NÃO lê nem escreve tabelas direto: só chama funções validadas no servidor                │
 │ (entrar na sessão, enviar diagnóstico/tentativa/saída, abrir dica). O servidor confere código,     │
 │ fase e ordem das dicas e CALCULA se a resposta está certa.                                         │
 │ Linhas novas → Realtime → painel do professor atualiza sem recarregar.                             │
 └────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Entrada de dados:** cada ação do estudante vira uma chamada a uma função do servidor. O cliente nunca grava um `correct` por conta própria.
- **Tempo real:** o painel assina as mudanças das tabelas da sessão (Realtime). Se a rede da escola bloquear o WebSocket, o app cai sozinho para **consulta a cada 5 s** e mostra o estado em texto: "Conectado", "Reconectando" ou "Sem conexão".
- **Tolerância a falhas:** o tablet guarda o envio pendente localmente e repete até confirmar. Cada envio leva um identificador único (`client_request_id`), então repetir não duplica a tentativa.
- **Latência esperada:** da ordem de 1 a 2 s em rede normal. É estimativa; será **medida** no teste com os tablets.
- **Etapa 1 preservada:** a interface (componentes, acessibilidade, textos, revisão de dados pessoais, caso D = d) **não muda**. Só se troca o repositório de dados: uma nova classe implementa a **mesma** interface `SessionRepository` do `DemoRepository`. A variável `VITE_BACKEND=demo|supabase` escolhe qual usar. O modo DEMONSTRAÇÃO continua existindo (ensaio e plano B offline). O banner mostra CONECTADO **somente** com o backend real ativo e autenticado.

## 2. Firebase/Firestore × Supabase

| Critério | Firebase (Firestore) | Supabase (Postgres) |
|---|---|---|
| **Plano gratuito** | Plano Spark. Firestore: 1 GiB, 50 mil leituras/dia, 20 mil gravações/dia, 20 mil exclusões/dia ([fonte](https://supertokens.com/blog/firebase-pricing)) | 500 MB de banco, 200 conexões Realtime simultâneas, 2 milhões de mensagens Realtime/mês, 50 mil usuários ativos/mês, 500 mil invocações de Edge Functions ([fonte](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/)) |
| **Cabe numa turma?** | Sim, com folga (estimativa na seção 12) | Sim, com folga |
| **Custo se crescer** | Pago por uso (plano Blaze, exige cartão) | Pro: US$ 25/mês por organização; o limite de gasto vem ligado por padrão e **bloqueia** em vez de cobrar ([fonte](https://toolradar.com/blog/supabase-pricing-2026)) |
| **Pegadinha do gratuito** | Validação no servidor pede Cloud Functions, e as fontes que achei **se contradizem** sobre exigir plano pago | Projeto gratuito **pausa após 1 semana sem uso** e fica fora do ar até alguém restaurar no painel ([fonte](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/)) |
| **Validação no servidor (correção, limite de tentativas)** | As regras do Firestore validam campos, mas não limitam tentativas. Correção "de verdade" pede Functions | **Funções SQL (RPC) no plano gratuito**: o servidor confere código e fase e calcula o acerto; o estudante não tem acesso direto às tabelas |
| **Autenticação** | Anônima, e-mail, Google. Simples | Anônima ([doc](https://supabase.com/docs/guides/auth/auth-anonymous.md)), e-mail, Google. As políticas RLS diferenciam anônimo × docente pela claim `is_anonymous` |
| **Tempo real** | Nativo e muito maduro (`onSnapshot`), com **cache offline** embutido | Realtime sobre Postgres, respeitando RLS. **Sem cache offline embutido**: nós implementamos a fila de reenvio |
| **Autorização** | Linguagem própria de regras (verbosa para uma máquina de estados) | RLS em SQL + funções; testável com SQL (pgTAP) |
| **Análise antes/depois e exportação** | Consultas agregadas limitadas; costuma exigir processar no cliente | **SQL**: visões de antes/depois e exportação anônima ficam naturais |
| **Implantação** | Muito fácil (console + CLI) | Fácil (painel + CLI; migrações em SQL versionadas no repositório) |
| **Teste local sem dados reais** | Emulator Suite (precisa de Java) | Supabase CLI sobre Docker (Docker existe neste ambiente; **ainda não testei** se as imagens baixam daqui) |
| **Manutenção** | Menos peças; atualizações do SDK | Migrações SQL + funções: mais engenharia, mais controle |
| **Dependência do fornecedor** | Alta (NoSQL proprietário) | Menor (Postgres padrão, dá para migrar) |

### Recomendação: **Supabase**

**Estou mudando minha recomendação anterior (Firebase, Opção A).** Ao comparar de perto, o Supabase entrega no **plano gratuito** o que o Firebase só entregaria com serviço pago e incerto: **validação e correção no servidor**. Isso atende o critério da especificação de que a resposta correta não possa ser obtida antes do envio, sem cartão de crédito. O SQL também facilita o desempenho antes/depois e a exportação anônima.

**Riscos do Supabase e como lidar:**
1. **Pausa por inatividade (1 semana).** Mitigação: restaurar o projeto no dia anterior à aula e/ou usar uma rotina agendada gratuita (GitHub Actions) com uma consulta leve por dia. Se isso incomodar, o Pro (US$ 25/mês) elimina o risco.
2. **Sem cache offline.** Mitigação: fila local de reenvio com idempotência. O modo DEMONSTRAÇÃO local é o plano B.
3. **Limite de logins anônimos por IP.** A escola provavelmente usa **um único IP** para todos os tablets, e o Auth limita cadastros anônimos por IP por hora (configurável; **não verifiquei o valor padrão**). Será ajustado e testado antes da aula.
4. **Backups.** Não confirmei se o plano gratuito inclui backups automáticos. Os dados são pequenos e a exportação CSV/JSON é o registro; a retenção (seção 4) leva isso em conta.

**Quando eu mudaria de ideia:** se a rede da escola bloquear o domínio do Supabase e liberar o do Google (a testar), ou se o cache offline for mais importante para você do que a validação no servidor.

## 3. Arquitetura de sessões

1. **Professor cria a sessão.** Faz login e chama `create_session()`. O servidor gera um **código de 6 caracteres** (alfabeto sem 0/O/1/I), único entre as sessões abertas, válido por 90 min por padrão.
2. **Recebe o código.** O painel mostra o código grande e um **QR code** (gerado no navegador) com o endereço de entrada.
3. **Estudantes entram.** Abrem a URL ou leem o QR, fazem login anônimo, digitam o código e o **apelido de equipe** e chamam `join_session(código, apelido)`. O servidor valida código, validade, sessão aberta e apelido (único na sessão, sem dado pessoal evidente) e cria a equipe.
4. **Respostas aparecem em tempo real.** Cada envio passa por uma função (`submit_diagnostic`, `submit_attempt`, `save_progress`, `record_hint`, `submit_exit`). O servidor grava e o Realtime avisa o painel.
5. **Projeção.** O professor revisa o exemplo (pré-visualização atual) e o app grava só o conteúdo **já anonimizado** em `projection`. A TV abre `#/projecao?codigo=XXXXXX`, sem login, e lê apenas isso via `get_projection(código)`.
6. **Encerramento.** `close_session()` marca `closed_at`. Daí em diante todas as funções recusam novos envios ("A sessão foi encerrada pelo professor"). O tablet percebe na próxima chamada ou na próxima consulta periódica.
7. **Apagar.** Botão "Apagar esta sessão" (exclusão em cascata) e exclusão automática após o prazo de retenção (seção 4).

**Recuperação de página:** a identidade anônima persiste no navegador. Ao atualizar, `get_my_state()` devolve a equipe e a fase, e o estudante retoma de onde parou (isso já funciona hoje em DEMONSTRAÇÃO). Se o navegador apagar os dados do site, a equipe precisa entrar de novo com **outro** apelido. É uma limitação do login anônimo, aceitável e documentada.

## 4. Quais dados são armazenados

**Regra geral:** nenhum nome completo, e-mail, telefone ou foto de estudante. A identidade do estudante é **um UUID aleatório (login anônimo) + apelido de equipe**.

| Dado | Onde | Para quê | Observação |
|---|---|---|---|
| E-mail do professor | Auth | Login docente | Só contas autorizadas |
| UUID anônimo do estudante | Auth, `teams` | Distinguir equipes | Aleatório, sem ligação a pessoa |
| Apelido da equipe (2 a 24 caracteres) | `teams` | Mostrar no painel | Validado: rejeita e-mail, telefone e números longos |
| Código da sessão e datas | `sessions` | Controle da aula | Temporário |
| Medidas, cálculo, resposta, unidade | `submissions` | Registro pedagógico | |
| **Justificativa (texto livre)** | `submissions` | Raciocínio da equipe | **Maior risco de dado pessoal.** O servidor rejeita e-mail, telefone e números longos; só o professor lê; só texto revisado vai à projeção; fica fora da exportação |
| Uso de dicas e horários de eventos | `hint_events`, `team_events` | Apoio e tempo aproximado | Horários do servidor |
| Notas e intervenções do professor | `interventions` | Registro da mediação | Só o professor; pode citar apelidos, nunca nomes |
| Exemplo para projeção | `projection` | TV | Já revisado |

**Não armazenado:** nome real, foto, voz, localização, rastreamento de cliques ou de teclas. **Transparência:** a plataforma pode manter, em logs próprios, endereço IP e dados técnicos das requisições. Isso é do provedor, não do nosso banco.

**Retenção sugerida:** 30 dias a partir da sessão, depois exclusão automática (rotina agendada; preciso confirmar se está disponível no plano gratuito, senão a exclusão é manual pelo botão). A exportação anônima (sem apelido, sem texto livre, sem horários) fica com você.

**Base institucional:** por serem estudantes menores, a escola/Núcleo precisa autorizar o uso de serviço externo. **Isso não é decisão técnica e fica com você**, antes do uso com a turma.

## 5. Como impedir que estudantes acessem o painel do professor

Esconder a rota não protege nada; a segurança real está no banco. Camadas:

1. **Tipos de conta separados.** Estudantes só existem como usuários **anônimos**. O cadastro por e-mail fica **desativado** no projeto; as contas docentes são criadas por você (convite/painel).
2. **Tabela `teachers`.** Só quem estiver nela (inserida por você, direto no SQL) é professor. A função `is_teacher()` exige estar na tabela **e** `is_anonymous = false`. Nenhuma política permite inserir nela pelo app.
3. **RLS em todas as tabelas.** Estudante: sem `SELECT` em `sessions`, `interventions`, `projection` nem em linhas de outras equipes; nas demais tabelas, nenhum `INSERT/UPDATE/DELETE` direto (só via funções). Professor: lê e escreve **apenas as sessões que criou**.
4. **Funções `security definer` com checagem explícita** (`auth.uid()`, fase, sessão aberta), `search_path` fixo e execução revogada para `anon`/`public` nas funções só docentes.
5. **Chave secreta nunca no navegador.** O app usa só a chave pública (anon/publishable). A chave de serviço (service_role/secret) não entra no código, no repositório nem no build.
6. **Testes automáticos** com o token de um estudante tentando: listar equipes, ler notas, ler outra equipe, chamar funções docentes, inserir em `teachers`. Todos devem falhar. Um professor de outra sessão também não pode ler esta.
7. **Opcional:** autenticação em dois fatores para a conta docente.

## 6. Modelo de dados (esboço; ainda não é migração)

```sql
teachers      (user_id uuid pk -> auth.users, created_at)
sessions      (id uuid pk, teacher_id uuid, code text, mission text default 'jardim',
               created_at, expires_at, closed_at, retention_until)      -- code único entre sessões abertas
teams         (id uuid pk, session_id fk, user_id uuid, alias text, alias_key text,
               phase text, major numeric, minor numeric, phase_started_at,
               joined_at, last_seen_at, fictitious boolean default false,
               unique(session_id, user_id), unique(session_id, alias_key))
submissions   (id uuid pk, team_id fk, session_id fk,
               kind text check (kind in ('diagnostico','tentativa','saida')),
               seq int,                          -- 1..n nas tentativas; 1 no diagnóstico e na saída
               major numeric, minor numeric,
               calculation text, raw_answer text, answer numeric, unit text check (unit in ('m','m²')),
               justification text,
               correct boolean,                  -- calculado NO SERVIDOR
               pattern_id text null,             -- hipótese pedagógica, calculada no servidor
               hint_level smallint,              -- maior dica vista ao enviar (0 a 3)
               ms_since_phase_start int,         -- tempo aproximado desde o início da fase
               client_request_id uuid unique,    -- idempotência
               created_at timestamptz default now())
               -- índices únicos parciais: 1 diagnóstico e 1 saída por equipe
hint_events   (id, team_id, session_id, level smallint check (level in (1,2,3)), created_at, unique(team_id, level))
team_events   (id, team_id, session_id, type text, created_at)          -- linha do tempo (tempo aproximado e estado)
interventions (id, session_id, team_id null,                            -- null = turma toda
               difficulty text, intervention text, response_after text,
               created_by uuid, created_at, updated_at)
projection    (session_id pk, payload jsonb, updated_at)
join_attempts (user_id, tried_code, ok boolean, at)                     -- limite de tentativas do código
```

**Como cada item pedido é registrado:**

| Item | Registro |
|---|---|
| **Diagnóstico inicial** | `submissions` com `kind='diagnostico'`, sem dicas (`hint_level=0`), **uma única vez** |
| **Hipóteses** | Na experiência atual, a hipótese da equipe (cálculo + resposta registrados **antes** de qualquer devolutiva) já é a própria tentativa, então fica na linha de `kind='tentativa'`. Se você quiser distinguir "hipótese prévia" de "tentativa corrigida", acrescento uma coluna `stage` (decisão 6 da seção 14) |
| **Tentativas** | `kind='tentativa'`, `seq` crescente, cada uma com suas medidas |
| **Uso de dicas** | `hint_events` (nível e horário; ordem 1→2→3 garantida pelo servidor) e `hint_level` em cada envio, o que separa "tentativas com dicas" de "sem dicas" |
| **Respostas finais** | `kind='saida'`, sem dicas, **uma única vez**; o resultado só é devolvido após o envio |
| **Tempo aproximado** | Diferença entre horários de `team_events` e `ms_since_phase_start`. É **aproximado**: não mede atenção (aba aberta não é o mesmo que estudante pensando). Sem cronômetro na tela do estudante |
| **Padrões de erro** | `pattern_id`, calculado no servidor e **rotulado como hipótese pedagógica**; nulo quando mais de um padrão coincide |
| **Intervenções do professor** | `interventions`: dificuldade → pergunta/intervenção → resposta após a mediação. A "nova evidência" também pode ser vista cruzando com a primeira submissão da equipe **depois** da intervenção (visão `v_apos_intervencao`) |
| **Desempenho antes/depois** | Visão `v_pre_pos`: por equipe, `diagnostico` × `saida` (acertou? padrão? dicas usadas?) e agregados da turma. A exportação sai sem apelido nem texto livre, **com o aviso de limites** já existente: não atribui a diferença ao jogo |

**Fonte única do cálculo:** a classificação de acerto e de padrão existirá em TypeScript (DEMONSTRAÇÃO) e em SQL (servidor). Para não divergirem, as duas serão testadas com **os mesmos casos de teste** (arquivo de vetores compartilhado).

## 7. Preservação da Etapa 1 (funcionalidades, acessibilidade, testes)

- Componentes, textos, acessibilidade, revisão de dados pessoais, caso D = d, painel, projeção e exportação permanecem. Só se acrescentam um indicador textual de conexão e o QR code.
- Os **94 testes atuais continuam** a rodar contra o `DemoRepository`. A suíte de repositório é parametrizada ("teste de contrato") para rodar **também** contra o novo repositório quando o banco local estiver ativo, garantindo o mesmo comportamento.
- Novos testes: segurança (seção 5), regras de sessão, idempotência, vetores compartilhados de correção e simulação de vários dispositivos.
- Qualquer regressão de acessibilidade (axe, teclado, rótulos) quebra a suíte, como hoje.

## 8. Publicação online com URL simples

**Recomendado: Cloudflare Pages** (gratuito). O app é estático, então não precisa de servidor próprio.

- Endereço padrão do tipo `https://operacao-area.pages.dev` (se o nome estiver livre). No plano gratuito: 500 builds/mês e **largura de banda ilimitada** para arquivos estáticos ([fonte](https://developers.cloudflare.com/pages/platform/limits)).
- **Fluxo:** você conecta o repositório do GitHub ao Cloudflare Pages. Cada envio à branch principal publica sozinho, e cada branch ganha uma **prévia** em endereço próprio (bom para testar antes da aula).
- **Para os tablets:** o professor projeta o **QR code** do painel. Quem preferir digita `operacao-area.pages.dev` e o código de 6 letras. O app usa rotas por `#`, que funcionam em hospedagem estática sem configuração extra.
- **Domínio próprio** (por exemplo, `.com.br`) é opcional e tem custo anual no registrador (ordem de dezenas de reais; **confira no Registro.br**). Não é necessário para o piloto.
- **Alternativas:** GitHub Pages (grátis, mas o endereço depende do nome do repositório e, se ele for privado, do plano da conta); Netlify e Vercel (têm plano gratuito, com condições que mudam; não verifiquei).

## 9. Variáveis de ambiente e contas externas

**Contas:**

| Conta | Para quê | Custo |
|---|---|---|
| GitHub (já existe) | Código e publicação automática | Gratuito |
| Supabase | Banco, login e tempo real | Gratuito no piloto (seção 12) |
| Cloudflare | Hospedagem do app | Gratuito |
| Conta docente (e-mail ou Google) | Login do professor | Gratuito |
| Registrador de domínio | Só se quiser domínio próprio | Pago, opcional |

**Variáveis** (um `.env.example` entra no repositório; o `.env` real **nunca**):

| Variável | Onde | Segredo? |
|---|---|---|
| `VITE_BACKEND` = `demo` ou `supabase` | build do app | Não |
| `VITE_SUPABASE_URL` | build do app | Não (endereço público) |
| `VITE_SUPABASE_ANON_KEY` (ou "publishable key") | build do app | **Pública por projeto**; a proteção vem do RLS |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` | só nos *secrets* do GitHub, para aplicar migrações | **Sim** |
| Chave `service_role` / secret | **não é usada pelo app**; fica só no painel do Supabase | **Sim, jamais no código** |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | só se publicar por GitHub Actions (com a integração direta do Cloudflare com o GitHub não são necessárias) | Sim |

## 10. Plano de implantação (cada passo termina com parada para a sua aprovação)

1. **2a, local, sem custo:** migrações SQL, funções, RLS e `SupabaseRepository` sobre Supabase local (Docker). Testes de segurança e de contrato. Nada em nuvem.
2. **2b, nuvem:** você cria a conta Supabase e o projeto (região de São Paulo, se disponível); aplicamos as migrações; publicação no Cloudflare Pages; teste de fumaça com 1 tablet.
3. **2c, campo:** teste com 2 tablets + notebook na rede da escola (WebSocket, limite de logins anônimos por IP, latência) e plano B documentado.

## 11. Testes de aceitação (da especificação, seção 8)

O painel atualiza sem recarregar; uma equipe não vê outra nem o painel; a resposta correta não é obtida antes do envio; toque, teclado e controle numérico funcionam; a saída fica separada das tentativas com dicas. Além disso: recarregar o tablet no meio da missão; queda e volta do Wi-Fi; sessão encerrada; código errado ou expirado; TV sem login lendo só conteúdo anonimizado.

## 12. O que pode gerar custo e em que condições

| Parte | Custo no piloto | Quando passa a cobrar |
|---|---|---|
| Supabase, plano gratuito | **R$ 0** | Não cobra sozinho: ao exceder as cotas, o serviço é limitado. Só custa se você **escolher** o Pro (US$ 25/mês), por exemplo para evitar a pausa por inatividade |
| Cloudflare Pages | **R$ 0** | Só em recursos avançados ou volume muito acima do previsto; para este uso, improvável |
| GitHub | **R$ 0** | Se usar recursos pagos em repositório privado |
| Domínio próprio | Opcional | Anualmente, se você quiser |
| E-mails do login docente | Evitável | O envio de e-mail padrão tem limites baixos; para o professor recomendo **senha ou Google** e não configurar serviço de e-mail |
| Firebase (se você preferir) | R$ 0 no Spark | Plano pago (Blaze, com cartão) se usar Cloud Functions; alertas de orçamento **avisam, mas não bloqueiam** |

**Estimativa de uso por aula** (12 equipes, cerca de 100 ações por equipe): da ordem de **1.200 gravações** e **alguns milhares** de mensagens Realtime, **muito abaixo** dos limites gratuitos citados (2 milhões de mensagens/mês; 500 MB). É uma estimativa minha, a ser medida no teste. **Nenhum serviço pago será ativado sem a sua aprovação.**

## 13. Riscos

Pausa do projeto gratuito por inatividade · bloqueio pela rede da escola · limite de logins anônimos por IP · texto livre com dado pessoal (mitigado, não eliminado) · autorização institucional pendente · divergência entre o cálculo em TypeScript e em SQL (mitigada com vetores compartilhados).

## 14. Decisões que preciso de você

1. Aprovar **Supabase** (ou prefere manter o Firebase)?
2. Quem cria as contas Supabase e Cloudflare? Eu não tenho acesso às suas contas; guio passo a passo.
3. Quais e-mails serão docentes?
4. Retenção dos dados: 30 dias?
5. Aceita o risco da **pausa por inatividade** com a mitigação proposta, ou prefere avaliar o Pro?
6. Quer distinguir "hipótese prévia" de "tentativa corrigida" no banco?
7. Renomear o repositório no GitHub para `operacao-area`?
8. A escola/Núcleo autoriza o uso de serviço externo com os estudantes?

**Fora do escopo desta etapa:** missões Sala, Piscina e Projeto Final (Etapa 3); piloto com a turma (Etapa 4); IA generativa; ranking.
