# Operação Área — Etapa 2a: relatório

**Escopo cumprido:** migrações SQL locais, funções RPC, RLS e o `SupabaseRepository`, testados contra uma stack Supabase **local** (Docker). **Nada foi implantado em nuvem, nenhuma conta externa foi criada, nenhum serviço pago foi usado.** Parei antes da Etapa 2b.

## 1. Suas decisões e como foram atendidas

| # | Decisão | Situação |
|---|---|---|
| 1 | Manter a arquitetura Supabase | Mantida: Postgres + Auth + Realtime; estudantes só chamam funções do servidor |
| 2 | Etapa **hipótese inicial** separada | `submissions.kind`: `diagnostico → hipotese → tentativa (revisões) → saida`. Existe no banco, no `DemoRepository`, na interface, no painel, na exportação e na projeção |
| 3 | Retenção de 30 dias; exportação anônima | `sessions.retention_until` = criação + 30 dias; `purge_expired_data()` apaga em cascata. Exportação (`export_anonymous` e JSON/CSV do painel) sem apelidos, textos livres, horários ou identificadores — testada |
| 4 | Sem keep-alive artificial | Nenhum código de keep-alive existe (busca feita). A pausa por inatividade do plano gratuito fica como risco operacional (seção 8) |
| 5 | DEMONSTRAÇÃO integralmente funcional | Sim. É o padrão do build; o código do Supabase nem entra nele (o build conectado é outro) |
| 6 | Missão ≠ Etapa na interface | Ex.: **"Missão 1 — Jardim Geométrico · Etapa 2/4 · Hipótese inicial"** (cabeçalho de todas as telas do estudante) |
| 7 | Dicas progressivas, só após solicitação | Mantido e testado: a dica N+1 só existe depois da N; nada aparece sem clique |
| 8 | Testes de 35 entradas atrás de um único IP | Feitos, em dois cenários do Auth (seção 6). **Limitação confirmada do Auth: com o limite padrão entram 30 de 35** |
| 9 | Preservar acessibilidade, segurança, idempotência e retomada | Todos os testes anteriores continuam; foram ampliados (seção 5) |
| 10 | Nada de nuvem, conta paga ou implantação | Cumprido |

## 2. Resumo das alterações

**Banco (`supabase/migrations/`, 4 arquivos):** esquema; funções RPC `SECURITY DEFINER` com validação e correção no servidor; RLS e privilégios mínimos; visões de análise (`v_trajetoria`, `v_apos_intervencao`); `export_anonymous`; `purge_expired_data`; publicação Realtime.

**Aplicativo:**
- `SupabaseRepository` (`src/data/supabase/`): três clientes separados (estudante com login anônimo em `sessionStorage`; professor em `localStorage`; TV sem login), reenvio idempotente em falha de rede, indicador de conexão em texto, tempo real com **consulta periódica de reserva**, **vigia** que recria o canal/socket com espera crescente e **reconciliação** a cada 15 s.
- Interface `SessionRepository` ampliada: `submitHypothesis`, `deleteSession`, `getProjectionView`, `dispose`, `teacherAuth`, `connection`, `requestId` (idempotência), `sessionClosed`.
- Projeção: a TV recebe só uma **visão agregada** (`ProjectionView`), calculada no servidor no modo conectado.
- Painel do professor: colunas Diagnóstico / Hipótese inicial / Revisões / Dicas / Saída; botão "Apagar esta sessão e seus dados"; login docente (modo conectado).
- Estudante: aviso persistente quando o professor encerra a sessão; mensagem clara para o limite de entradas por rede.
- Servidor e DEMONSTRAÇÃO passaram a recusar e-mail, endereço da internet e números de 4+ algarismos nos textos livres (mesma regra nos dois).
- Infraestrutura local: `infra/local/` (compose, gateway nginx, geração de `.env` com segredos aleatórios, migração, esquema), `scripts/verificar-segredos.mjs`.

## 3. Esquema final do banco

Gerado do próprio banco: **`docs/ETAPA2A_ESQUEMA.md`** (colunas, restrições, índices, políticas RLS, funções e quem pode executá-las). Resumo:

```
teachers(user_id)                                         lista de professores autorizados (só o dono do projeto insere)
sessions(id, teacher_id, code, mission, created_at, expires_at, closed_at, retention_until)
teams(id, session_id, user_id, alias, alias_key, phase, major, minor, exploring_since, phase_started_at, joined_at, ...)
submissions(id, team_id, session_id, kind[diagnostico|hipotese|tentativa|saida], seq, major, minor,
            calculation, raw_answer, answer, unit, justification, correct*, pattern_id*, hint_level,
            ms_since_phase_start, client_request_id, created_at)        * calculados no servidor
hint_events(team_id, level 1..3, created_at)              uma vez por nível
team_events(team_id, type, created_at)                    linha do tempo (tempo aproximado)
interventions(session_id, team_id?, team_alias, difficulty, intervention, response_after, created_by, created_at)
projection(session_id, payload)                           escolha do professor
join_attempts(user_id, tried_code, ok, at)                limite contra adivinhar códigos
Visões: v_trajetoria, v_apos_intervencao (somente professor)
```

Restrições que garantem o percurso: `unique(team_id, kind, seq)` (1 diagnóstico, 1 hipótese inicial, 1 saída, tentativas numeradas) e `unique(team_id, client_request_id)` (idempotência).

## 4. Segurança (o que foi provado em teste)

- **Estudante (login anônimo)** não lê nenhuma tabela nem visão (RLS devolve 0 linhas), não escreve direto (`42501`), não executa função docente, não lê a equipe de outro, não forja `correct` (a função nem aceita o parâmetro) e não vira professor — nem se alguém o inserir por engano na lista (a claim `is_anonymous` bloqueia).
- **Sem login (chave pública)** só executa `get_projection`, que devolve conteúdo agregado, sem apelidos.
- **Professor** só enxerga as próprias sessões; outro professor recebe vazio; ninguém escreve em tabelas direto; só `service_role` executa a retenção.
- **Conta de e-mail fora da lista** não entra no painel nem usa funções docentes.
- **Privilégios no catálogo do banco** (independente da API): nenhuma escrita para `anon`/`authenticated`; `SELECT` só nas tabelas do professor; RLS em todas as tabelas; as funções executáveis por `anon` são exatamente `[get_projection]`.
- **Realtime respeita RLS:** estudante que assina o canal não recebe nenhum evento; professor B não é avisado de eventos do professor A.
- **Texto malicioso** (aspas, SQL, HTML) fica gravado como dado; apelidos com marcação são recusados. Limite de 10 códigos errados por 10 min.
- **Segredos:** `npm run check:secrets` (versionado + `dist/`) não achou chave `service_role` nem chave privada; o build conectado contém só a chave pública (verificado). `infra/local/.env` é ignorado pelo git.

## 5. Resultados de todos os testes

Comando único: `npm run test:all` (exige Docker). **Resultado final: tudo passou (exit 0).**

| Conjunto | Comando | Resultado |
|---|---|---|
| Domínio, interface, acessibilidade (axe), contrato **DemoRepository**, vetores | `npm test` | **184 / 184** (9 arquivos) |
| Stack local: segurança, contrato **SupabaseRepository**, robustez, tempo real, queda do Realtime, 35 entradas, paridade | `npm run test:supabase` | **135 / 135** (7 arquivos) |
| 35 entradas com o **limite padrão** do Auth (30/h por IP) | `npm run test:supabase:limite-padrao` | **6 / 6** (documenta a limitação) |
| Verificação de tipos e build | `npm run typecheck`, `npm run build` | sem erros |
| Segredos | `npm run check:secrets` | nenhum segredo |

Por arquivo (stack local): contrato 19 · segurança 76 · robustez 13 · tempo real 8 · queda do Realtime 1 · 35 entradas 6 · paridade SQL×TypeScript 12.
Por arquivo (sem Docker): contrato Demo 19 · interface/a11y 20 · repositório 20 · área 26 · padrões 16 · agregação 8 · dicas 7 · ocultação 6 · vetores 62.

**O mesmo contrato (19 casos) passa nas duas implementações.** Paridade SQL×TypeScript por vetores compartilhados (`tests/vectors/evaluate.json`: acerto/padrão, formatação de números, dados pessoais, apelidos) e a exportação anônima do servidor é **idêntica** à do aplicativo (linhas e resumo).

Medições locais (indicativas; rede local, sem a latência de internet real): entrada de equipe → painel avisado ≈ **150 ms**; envio + aviso ≈ **470–620 ms**; 35 equipes × 5 envios simultâneos ≈ **0,4 s**; queda do Realtime → painel segue por consulta periódica e volta ao tempo real em ≈ **10 s**; primeiro evento após a volta 1,5–3 s.

## 6. Limitação do Auth: 35 equipes atrás de um único IP

Reproduzida localmente com o Auth real (GoTrue v2.197, `GOTRUE_RATE_LIMIT_ANONYMOUS_USERS`):

| Limite configurado | Resultado das 35 entradas simultâneas |
|---|---|
| **30/h por IP (padrão do Supabase)** | **entram 30; 5 recebem `RATE_LIMITED`** (HTTP 429 `over_request_rate_limit`, sem `Retry-After`). As 30 que entraram trabalham normalmente (diagnóstico → saída, concorrente, sem perda) |
| ≥ 35 | entram as 35 em ≈ 0,35 s |

- **Recuperação medida:** o limite funciona como balde de fichas: uma entrada nova a cada ~2 minutos (30/h). Ex.: 3 min depois de esgotar, 1 login voltou a passar.
- O aplicativo mostra: *"Muitas equipes entraram ao mesmo tempo pela mesma rede. Aguardem alguns minutos e tentem de novo, ou chamem o professor."* (testado com axe; o formulário permanece preenchido).
- **Descoberta importante:** o GoTrue só aplica esse limite quando conhece o IP do cliente (`GOTRUE_RATE_LIMIT_HEADER`). Minha primeira configuração local **não aplicava limite nenhum** e o teste de 35 "passava" sem medir nada; foi corrigida (seção 7). O Supabase hospedado define isso por conta própria.
- **Não verificado:** se o plano gratuito permite *alterar* esse limite no painel do Supabase. Isso só se confirma na Etapa 2b.

## 7. Problemas encontrados (e o que foi feito)

1. **Limite do Auth não era aplicado na minha stack local** → configurado o cabeçalho de IP; o teste de 35 passou a medir de verdade (seção 6).
2. **Bug no SQL** (`text[] || literal`) no cálculo de padrão de erro → corrigido; os vetores compartilhados agora cobrem os 28 casos.
3. **Canal de tempo real não se recuperava sozinho** depois de reiniciar o servidor (socket preso em "conectando") → vigia que recria canal e socket com espera crescente. O teste de queda passou 3/3 depois da correção.
4. **Canal "saudável" sem entregar eventos** (uma execução) → reconciliação periódica de 15 s: o painel nunca fica velho por mais que isso, mesmo numa falha silenciosa.
5. **Risco real de deadlock** ao apagar a sessão enquanto equipes gravam (travas em ordens opostas). Reproduzido de forma determinística com duas conexões (`40P01`) e **corrigido** no `delete_session` e na retenção (travar equipes antes da sessão). O teste falha sem a correção e passa com ela. Um teste de estresse anterior, sem a correção, **não** reproduzia o problema (5 de 5 passavam); por isso o teste decisivo é o determinístico.
6. **Teste instável** (deadlock no auxiliar de reset dos testes; apareceu em 1 de 2 execuções seguidas) → reset em transação com ordem fixa e nova tentativa.
7. **Cadastro por e-mail não pode ser desligado:** com o cadastro global desativado, o login **anônimo também é bloqueado** (HTTP 422 `signup_disabled`). Logo, qualquer pessoa pode criar uma conta de e-mail sem poderes; a proteção é a lista de professores (testada). No hospedado, "Confirm email" impede que essas contas sequer abram sessão.
8. **Gateway local** guardava o IP do serviço na partida e dava 502 depois de reiniciar → passou a resolver o nome a cada chamada.
9. **Realtime após recriar as tabelas** demora cerca de 1 s para enxergar as novas (artefato do reset de teste; em produção as tabelas nascem uma vez).

## 8. Decisões que precisam da sua autorização

1. **Limite de entradas por IP (30/h).** Opções para a Etapa 2b: **(a)** conferir no painel do Supabase se o limite é ajustável no plano gratuito e elevá-lo; **(b)** um dispositivo por **equipe** (turma de 35 em ~12 equipes não chega a 30); **(c)** se ainda assim faltar: avaliar o plano Pro (US$ 25/mês, pago só com sua aprovação) ou uma função de entrada própria. Recomendo **(a) + (b)**, validados no teste de campo. Posso, desde já, acrescentar uma contagem regressiva automática na tela "tentem de novo em 2 min"?
2. **Dicas antes da hipótese inicial?** Hoje a dica pode ser pedida durante a exploração, antes de a equipe registrar a hipótese; o nível de dica fica gravado na hipótese inicial (`hipotese_dica_nivel`). Se você quiser que a hipótese inicial seja sempre **sem dicas** (linha de base mais limpa), bloqueio as dicas até esse registro.
3. **Retenção automática de 30 dias:** a função existe e foi testada, mas o **agendamento** (pg_cron) depende de estar disponível no plano gratuito, algo que só verifico na 2b. Alternativa sem agendador: você aperta "Apagar esta sessão" ao final da análise e/ou executo a rotina manualmente. Aprova o plano?
4. **Logins anônimos antigos:** a rotina apaga os com mais de 30 dias; no hospedado isso depende de permissão no schema `auth` (a função trata a falta de permissão e avisa). Confirmo na 2b.
5. **Criação das contas de professor (2b):** conta criada no painel do Supabase + um `INSERT` em `teachers` feito por você. Aprova esse procedimento manual (ele é intencional: o app não consegue se promover a professor)?
6. **Pausa do projeto gratuito (sem keep-alive, como você decidiu):** proponho apenas um procedimento de aula — abrir o painel docente 1 dia antes; se o projeto estiver pausado, restaurar. O painel mostra o estado da conexão em texto (como um projeto pausado se comporta na prática: a verificar na 2b). Quer que eu acrescente uma mensagem específica para esse caso ("o servidor pode estar pausado: avise o professor")?
7. **Backups:** não verifiquei se o plano gratuito os inclui. A exportação anônima é o registro da pesquisa; os dados brutos têm retenção curta por desenho.

## 9. O que não foi feito / não foi verificado

- Nada em nuvem: o comportamento no **Supabase hospedado** (limites reais, pausa, e-mails do Auth, permissões do schema `auth`, `pg_cron`) é a Etapa 2b.
- `supabase/config.toml` e a CLI do Supabase **não foram usadas** (as imagens da CLI não baixam neste ambiente); usei as imagens oficiais do Docker Hub. As migrações são as mesmas que a CLI aplicará.
- Testes em tablets reais, rede escolar real e leitor de tela real: não feitos (ficam para o teste de campo).
- A interface conectada (`VITE_BACKEND=supabase`) foi coberta por testes de repositório e de componentes com repositório simulado; **não** foi feita uma sessão de ponta a ponta no navegador com a stack conectada.

## 10. Como reproduzir

```bash
npm install
npm test                                 # sem Docker
npm run db:up                            # sobe a stack local (precisa de Docker)
npm run test:all                         # tudo, incluindo o limite padrão do Auth
node infra/local/dump-schema.mjs         # regenera docs/ETAPA2A_ESQUEMA.md
npm run check:secrets
VIEWPORT=1024x768 OUT=CAPTURAS_ETAPA2A node scripts/capturar-etapa2a.cjs   # capturas (com `npm run dev` rodando)
```

Capturas das telas atualizadas (nomenclatura Missão/Etapa, hipótese inicial, D = d, painel): `CAPTURAS_ETAPA2A/`.
