# Etapa 2a.1 — Validação ponta a ponta local (relatório)

**Nada foi criado na nuvem.** Sem projeto Supabase hospedado, sem Cloudflare Pages, sem serviço externo. Tudo roda no Docker local (`infra/local/`).

## 1. Decisões aplicadas
As 11 decisões estão em `docs/ETAPA2B_PREPARACAO.md` (tabela da seção 1), com o local de cada uma no código: dicas só depois da hipótese inicial (servidor, Demonstração e interface); sem contagem exata do limite; mensagem de falha de servidor; orientação ao professor sobre o Supabase pausado; aviso de retenção/exportação; justificativa mínima de 2 caracteres (máximo 500 e proteção de dados pessoais mantidos); nenhuma função promove professor (teste automático).

## 2. Testes E2E em navegador real (Playwright, Chromium, tablet 1024×768)
Contextos independentes (professor, estudante A, estudante B, projeção sem login), aplicativo real (Vite com `VITE_BACKEND=supabase`) contra o Supabase local real (Auth, REST, Realtime). **Sem mocks de Supabase.** Comando: `npm run test:e2e`.

| Arquivo | Cenário | Resultado |
|---|---|---|
| 01 | Percurso completo: sessão → equipes → diagnóstico → exploração → hipótese sem dicas → dicas → revisão → saída → intervenção → projeção aprovada → encerramento; sem recarregar; exportação anônima; projeção sem dados pessoais | passou |
| 02 | Recarregar no meio da missão (estudante e professor), sem duplicar | passou |
| 03 | Queda e recuperação do Realtime (container parado/religado, evidência nos frames WebSocket) | passou |
| 04 | Queda breve, queda longa (mensagem exata) e queda do professor; envio repetido grava uma vez | passou (3 testes) |
| 05 | Dica antes da hipótese: interface não oferece e a API recusa (`INVALID_STATE`) | passou |
| 06 | Estudante acessando rota/painel do professor; projeção sem login | passou |
| 07 | Encerrar sessão com estudante ativo | passou |

**Total E2E: 9/9.** Verificação de poder dos testes (mutação): servidor aceitando dica cedo foi pego pelo 05; política RLS vazando `teams` foi pega pelo 06; arquivos restaurados.

## 3. Suíte completa (`npm run test:all`, exit 0)
- Unitários/UI/contrato (Demonstração): 187/187
- Stack local (Supabase): 140/140
- Limite padrão de Auth (35 entradas atrás de um IP; 30 passam, 5 recebem `RATE_LIMITED`): 6/6
- E2E: 9/9
- `tsc --noEmit`, `npm run build` e `npm run check:secrets`: ok

## 4. Problemas encontrados e corrigidos
- Cabeçalho CORS duplicado (nginx + GoTrue) bloqueava o login no navegador real → só o gateway define CORS.
- Janela de ~2 s após reconexão do Realtime sem eventos → evento `system` + atualização de recuperação em 4 s; reconciliação a cada 15 s.
- Rejeições não tratadas ao voltar/avançar no feedback e na hipótese → tratamento com mensagem na tela.
- Teste vacuoso: `\b` em regex do PostgreSQL é backspace; trocado por `\y` e validado com positivos/negativos.
- Risco real de deadlock entre apagar sessão e enviar resposta → ordem de travas (equipes antes de sessões) com teste determinístico (falha com `40P01` sem a correção).

## 5. O que não foi verificado
Comportamento do projeto hospedado (limites reais, `pg_cron`, pausa por inatividade, backups): só na 2b (roteiro em `docs/ETAPA2B_PREPARACAO.md`). Rede escolar e tablets reais: 2c.

## 6. Decisão pendente
Autorização expressa para iniciar a Etapa 2b (criar projeto Supabase hospedado gratuito e Cloudflare Pages). **Parado aqui.**
