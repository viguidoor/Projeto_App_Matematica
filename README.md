# Operação Área: Reconstruindo Nossa Escola

Protótipo (**Etapa 1**) da missão **O Jardim Geométrico** (área do losango) para o 8º ano A do Colégio Estadual Júlia Wanderley – EFM-ETI. Habilidade EF08MA19 (RCO+Aulas, Desafio 14).

> **Modo DEMONSTRAÇÃO.** Não há Firebase, login, servidor nem sincronização entre dispositivos. Os dados ficam no `localStorage` do navegador. Toda tela exibe esse aviso. A Etapa 2 (Firebase, sincronização real, permissões) **não foi iniciada**.

## Instalação e execução

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # testes (Vitest): domínio, interface, acessibilidade e contrato do modo DEMONSTRAÇÃO
npm run typecheck
npm run build
```

## Como abrir as telas

| Tela | Endereço |
|---|---|
| Estudante (tablet) | `http://localhost:5173/#/` |
| Professor (demonstração) | `http://localhost:5173/#/professor` |
| Projeção (TV) | `http://localhost:5173/#/projecao` |

Roteiro de ensaio:
1. Abra `#/professor`, clique em **Entrar na demonstração** e **Abrir sessão**. Anote o código de 6 caracteres.
2. Em **outra aba ou janela do MESMO navegador**, abra `#/` e entre com o código e um apelido de equipe. O painel mostra a equipe sem recarregar (evento `storage` do navegador).
3. Cada aba do estudante é uma equipe (a identidade fica em `sessionStorage`; atualizar a página retoma de onde parou).
4. Para ensaiar o painel com a turma cheia, use **Carregar equipes FICTÍCIAS** (marcadas como fictícias).
5. Em **Modo projeção**, escolha uma distribuição (mín. 3 equipes) e abra `#/projecao` em outra janela.

**Limite importante:** dois navegadores *diferentes* (ou dois dispositivos) **não** compartilham dados em DEMONSTRAÇÃO, pois cada um tem seu próprio `localStorage`. Tablet + notebook só funcionam juntos na Etapa 2.

## Revisão da Etapa 1 (v1.1)

- **Prévia de projeção com revisão de dados pessoais:** ao projetar um exemplo, o professor vê o texto como a turma verá. O detector já oculta e-mail, telefone, números longos, palavras dos apelidos das equipes e possíveis nomes; o professor clica nas palavras para ocultar ou mostrar, pode retirar a justificativa e precisa confirmar a revisão. O detector é uma sugestão e **não garante** que tudo foi encontrado (um nome no início da frase, por exemplo, pode passar).
- **Diagonais iguais (D = d):** permitido. A tela explica que o losango vira um quadrado (caso particular), sem revelar a área; D nunca fica menor que d. Quando mais de um padrão de erro coincide com a resposta (ex.: 2 m × 2 m), o painel não rotula nenhum.
- **Capturas de tablet (1024×768)** em `REVISAO_VISUAL/`. Para regerar: `npm run dev` e, em outro terminal, `node scripts/capturar-telas.cjs` (requer Playwright).
- **Proposta da Etapa 2** em `docs/ETAPA2_ARQUITETURA.md` (nada implementado). Capturas atuais em `CAPTURAS_PRE_ETAPA2/` (tablet e desktop).

## Etapa 2a: backend Supabase LOCAL (sem nuvem, sem serviços pagos)

O aplicativo tem **dois repositórios de dados com o mesmo comportamento** (verificado por testes de contrato):

| | Quando | Onde ficam os dados |
|---|---|---|
| `DemoRepository` (**DEMONSTRAÇÃO**, padrão) | ensaio e plano B da aula, sem rede | `localStorage` do navegador |
| `SupabaseRepository` (**CONECTADO**) | vários tablets + painel em tempo real | Postgres + Auth + Realtime do Supabase |

Nesta etapa o modo CONECTADO só roda contra uma stack **local** em Docker (Postgres, Auth/GoTrue, PostgREST, Realtime e um gateway nginx). **Nada foi implantado em nuvem.**

```bash
npm run db:up                      # sobe a stack local (gera infra/local/.env com segredos aleatórios, ignorado pelo git)
npm run db:reset                   # aplica supabase/migrations/*.sql (apaga os dados locais)
npm run test:supabase              # testes de segurança, contrato, robustez, tempo real, 35 entradas, paridade
npm run db:down
```

Para usar o aplicativo contra a stack local, crie `.env.local` com `VITE_BACKEND=supabase`, `VITE_SUPABASE_URL=http://127.0.0.1:54321` e `VITE_SUPABASE_ANON_KEY=<ANON_KEY de infra/local/.env>` (chave **pública**); depois `npm run dev`. Contas de professor são criadas pelo dono do projeto (veja `docs/ETAPA2A_RELATORIO.md`). Sem essas variáveis o app abre em DEMONSTRAÇÃO.

- `supabase/migrations/`: esquema, funções RPC, RLS/permissões e visões de análise (as mesmas para o local e para a Etapa 2b).
- `docs/ETAPA2A_ESQUEMA.md`: esquema final (gerado do banco por `node infra/local/dump-schema.mjs`).
- `docs/ETAPA2A_RELATORIO.md`: resultados, problemas encontrados e decisões pendentes.
- Requisitos: Docker. Os testes `test:supabase` exigem a stack no ar; `npm test` (sem Docker) continua rodando a interface, o domínio e o contrato do modo DEMONSTRAÇÃO.

### Percurso de dados (Etapa 2a)

Missão 1 — Jardim Geométrico, em quatro etapas: **1 Diagnóstico → 2 Hipótese inicial → 3 Tentativas e revisões → 4 Problema final**. Cada uma é registrada separadamente (`submissions.kind`: `diagnostico`, `hipotese`, `tentativa`, `saida`), junto com o uso de dicas, o tempo aproximado (horários do servidor) e as intervenções do professor.

## Arquitetura

```
src/domain/      lógica pura: área, validação, padrões de erro, dicas, status, agregação/exportação
src/data/        SessionRepository (interface) · DemoRepository · KeyValueStore (memória / localStorage)
src/components/  student/ (missão), teacher/ (painel), Projection, figura SVG, formulários
tests/           Vitest + Testing Library + axe
```

A interface `SessionRepository` é o ponto de troca: a Etapa 2 implementará a mesma interface sobre Firebase.

## Decisões pedagógicas

- Diagnóstico (8 m × 5 m) sem dicas e **sem devolutiva de acerto** (preserva a linha de base). Saída (12 m × 4 m) sem dicas; o resultado só aparece após o envio.
- A área nunca aparece antes da hipótese. Em tentativa errada, a devolutiva descreve o que a equipe fez e **não revela o valor correto**.
- Dicas (3, progressivas, sem algarismos nem fórmula) são registradas; as dicas 2 e 3 acrescentam retângulo e triângulos à figura.
- Padrões de erro aparecem ao professor como **hipóteses pedagógicas**, com pergunta de mediação sugerida.
- Projeção: só distribuição agregada (mín. 3 equipes; respostas únicas em "outras") ou exemplo anônimo escolhido pelo professor.
- Projeção de exemplo exige revisão e confirmação do professor (ver acima).
- Exportação (JSON/CSV): sem apelidos, textos livres, horários; equipes como E01, E02…
- Não incluído nesta etapa: fórmulas de apoio, ranking, cronômetro, IA, outras missões.

## Limitações conhecidas (Etapa 1)

- O gabarito está no código do app; não há proteção contra inspeção. A correção no servidor é da Etapa 2.
- O painel do professor não tem autenticação; o código de sessão só é validado no navegador.
- Os testes automatizados usam jsdom: não medem contraste de cores nem leitores de tela reais. Faça uma revisão manual no tablet.
