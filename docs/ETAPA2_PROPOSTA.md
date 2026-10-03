# Operação Área: proposta da Etapa 2 (para aprovação)

**Situação:** nada desta proposta foi implementado. Este documento existe para você decidir. A Etapa 1 continua em modo DEMONSTRAÇÃO (dados só no navegador).

## 1. O que a Etapa 2 entrega

Conectar o app para que **tablets e notebook compartilhem a mesma sessão**, com professor autenticado e dados protegidos. Critérios de aceite (da especificação, seção 8):

1. Ao responder em um tablet, os indicadores do painel se atualizam **sem recarregar**.
2. Uma equipe **não lê** dados de outra equipe e **não acessa** o painel docente.
3. Não é possível obter a resposta correta inspecionando mensagens do servidor antes de enviar a hipótese.
4. A missão funciona por toque e teclado, e o controle numérico é testado.
5. A saída fica registrada separadamente das tentativas com dicas.
6. Todas as regras de acesso passam em testes no **Firebase Emulator** antes de qualquer dado real.

## 2. Decisões que preciso de você

| # | Decisão | Minha recomendação |
|---|---|---|
| 1 | Opção A (sem Cloud Functions, plano gratuito) ou B (com Cloud Functions, exige faturamento)? Ver seção 7 | **A** para o piloto; B só se o item 3 de segurança (abaixo) for exigência |
| 2 | Quem cria o projeto Firebase? Eu não tenho acesso à sua conta Google. Você cria o projeto e me passa só a configuração web (não é segredo) | Você cria; eu guio o passo a passo |
| 3 | Quais contas de e-mail serão docentes? | Só a sua (e a de quem você autorizar) |
| 4 | Região do Firestore | `southamerica-east1` (São Paulo). **Não pode ser trocada depois** |
| 5 | Hospedagem do app: Firebase Hosting ou GitHub Pages | Firebase Hosting (mesmo projeto, HTTPS pronto) |
| 6 | Por quanto tempo guardar dados de sessão | 30 dias, depois exclusão automática (TTL) |
| 7 | A escola/Núcleo exige autorização para usar serviços externos e contas Google com estudantes menores? | Confirmar **antes** de usar com a turma. Não é decisão técnica |

## 3. Arquitetura proposta

```
 Tablets (estudante)         Notebook (professor)            TV / projetor
 React + Firebase SDK        React + Firebase SDK            React (somente leitura)
   Auth anônima                Auth e-mail/Google              sem login
        │                            │                              │
        └──────────────┬─────────────┘                              │
                       ▼                                            │
              Firestore (rules = servidor)  ◄───── sessions/{code}/public/projecao
                       ▲                         (só conteúdo já anonimizado pelo professor)
                       │
              Firebase Emulator Suite (testes das regras, sem dados reais)
```

- **Código do app:** nova classe `FirebaseRepository` implementando a **mesma** interface `SessionRepository` da Etapa 1. A interface muda pouco: `subscribe` passa a poder observar documentos específicos. O modo DEMONSTRAÇÃO continua existindo para ensaio e plano B offline.
- **Alternância:** variável de ambiente escolhe `DemoRepository` ou `FirebaseRepository`. O banner **CONECTADO** só aparece quando o repositório Firebase está de fato ativo e autenticado.
- **Segredos:** a configuração web do Firebase não é segredo, mas as **regras** protegem os dados. Nenhuma chave de conta de serviço entra no repositório (`.gitignore` e verificação antes do ZIP).

### Modelo de dados (Firestore)

```
teachers/{uid}                              lista de professores autorizados (criada por você no console)
sessions/{code}                             teacherUid, openedAt, expiresAt, closedAt
sessions/{code}/teams/{uid}                 apelido, fase, medidas, dicas[], diagnóstico, tentativas[], saída
sessions/{code}/notes/{id}                  notas do professor (só professor)
sessions/{code}/public/projecao             exemplo/distribuição já revisados (leitura aberta a quem tem o código)
```

Cada equipe tem um único documento escrito só por ela (`uid` da equipe = ID do documento). Isso evita conflito de escrita.

## 4. Segurança

**Autenticação**
- Estudantes: login **anônimo** (sem e-mail, sem nome). O apelido de equipe é o único dado informado.
- Professor: e-mail/senha ou Google, **e** presença em `teachers/{uid}`. Esconder rota não protege nada: quem protege são as regras.

**O que as regras do Firestore fazem (verificado no servidor, testado no emulador)**
- Estudante só entra em uma sessão aberta, não expirada, com código correto, criando `sessions/{code}/teams/{seuUid}`.
- Estudante lê e escreve **apenas** o próprio documento de equipe. Não lista equipes, não lê notas.
- Professor lê todas as equipes **da sua sessão** e escreve notas e projeção.
- Campos e transições validados: diagnóstico uma única vez; dicas em ordem (1, 2, 3); sem dicas na saída; saída uma única vez; unidade só `m` ou `m²`; tamanho máximo dos textos.
- O campo `correct` é **calculado pela própria regra** a partir de medidas e resposta, então o cliente não consegue forjar um acerto.

**Limites honestos da Opção A (sem Cloud Functions)**
1. O gabarito (a fórmula) continua no código do app, como na Etapa 1. Ele **não trafega** do servidor antes do envio, o que atende o critério 3 da especificação, mas um estudante que leia o código-fonte saberia a fórmula. A fórmula também está nas dicas. Se isso for relevante, só a Opção B muda.
2. Não existe limite de tentativas de adivinhar o código de sessão (6 caracteres, ~1 bilhão de combinações, sessão curta). Mitigação: **App Check** (gratuito) e expiração do código. Limite real de taxa exige Opção B.
3. As regras validam bastante, mas expressar toda a máquina de estados é verboso. Cada regra terá teste no emulador.

**Privacidade (LGPD, estudantes menores)**
- Sem nomes, e-mails ou imagens de estudantes. Apelido validado contra dados pessoais evidentes (já existe).
- Justificativas são texto livre e podem conter dado pessoal. Por isso: só o professor as lê; na projeção só vai texto **revisado** (pré-visualização da revisão atual); a exportação não inclui textos livres.
- Retenção de 30 dias com exclusão automática (TTL do Firestore), conforme decisão 6.
- Autorização institucional para divulgar capturas e gravação continua sendo etapa sua (Seção 11 da especificação).

## 5. Sincronização entre dispositivos

- Cada tela usa **`onSnapshot`** (escuta em tempo real do Firestore). O painel docente escuta a coleção `teams` da sessão; o tablet escuta só o próprio documento.
- **Persistência offline** do SDK: se o Wi-Fi da escola cair por alguns segundos, o tablet segue funcionando e envia o que ficou na fila ao reconectar. O app mostrará **"Conectado / Reconectando / Sem conexão"** de forma textual, sem depender de cor.
- **Projeção:** o professor, já logado, grava em `public/projecao` apenas o conteúdo anonimizado e revisado. A TV abre `#/projecao?codigo=XXXXXX` **sem login** e só lê esse documento. Assim a TV nunca tem acesso a respostas identificáveis, por construção.
- **Rede da escola:** o Firestore usa WebSocket/HTTPS para `*.googleapis.com`. Precisa ser testado na rede real (bloqueios são comuns). O app tem opção de forçar *long polling* se necessário.

## 6. Serviços e ferramentas

| Item | Para quê | Custo |
|---|---|---|
| Projeto Firebase | Auth, Firestore e Hosting | ver seção 7 |
| Firebase Authentication | login anônimo (estudantes) e e-mail/Google (professor) | gratuito nos volumes previstos |
| Cloud Firestore | dados da sessão | cota gratuita (seção 7) |
| Firebase Hosting (opcional) | servir o app com HTTPS | cota gratuita |
| App Check (opcional) | dificultar uso do backend fora do app | gratuito |
| Firebase Emulator Suite | testar regras sem dados reais | gratuito, local. Precisa de Java (já disponível aqui) e `firebase-tools` |
| `@firebase/rules-unit-testing` | testes automáticos das regras | gratuito |

## 7. Custos: alternativas (peço aprovação antes de ativar qualquer serviço pago)

**Opção A, recomendada: plano gratuito (Spark), sem Cloud Functions, sem cartão.**
- Autenticação anônima e e-mail/Google, Firestore e Hosting dentro da cota gratuita.
- Cota gratuita do Firestore que encontrei: **1 GiB armazenados, 50.000 leituras/dia, 20.000 gravações/dia, 20.000 exclusões/dia** ([resumo em fonte secundária](https://supertokens.com/blog/firebase-pricing); a página oficial de [planos de preço do Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) deve ser conferida por você, porque o acesso a `firebase.google.com` estava bloqueado no meu ambiente e **não consegui confirmar os números na fonte oficial**).
- **Estimativa de uma aula** (12 equipes): cerca de 100 gravações por equipe (medidas salvas com espera, dicas, tentativas) ≈ **1.200 gravações**; leituras do painel e da projeção na ordem de **alguns milhares**. Isso é **uma pequena fração** da cota diária, mesmo com várias turmas no mesmo dia. É uma estimativa minha, a ser medida no teste com os tablets.
- Risco financeiro: **nenhum**, pois sem faturamento o serviço apenas bloqueia ao estourar a cota.

**Opção B: plano pago por uso (Blaze) com Cloud Functions.**
- Permite: validação do código e correção **no servidor**, limite de taxa na entrada, claims de professor, exclusões e exportações agendadas.
- Exige **conta de faturamento com cartão**. Existe cota gratuita mensal de Functions, mas ela depende do plano; as informações que encontrei se contradizem sobre exigir ou não Blaze para Functions, então **confirme no console antes de decidir**.
- Atenção: **alertas de orçamento avisam, mas não bloqueiam** o gasto. Para uma turma, o custo esperado é próximo de zero, mas o risco existe se algo for configurado errado ou atacado.
- Só recomendo se você exigir correção estritamente no servidor ou limite de tentativas no código da sessão.

**Alternativa C, sem Firebase:** manter a Etapa 1 (DEMONSTRAÇÃO) para a aula, com tablet e professor no **mesmo navegador/dispositivo compartilhado**, e coletar o restante em papel. Custo zero e nenhuma dependência de rede, mas não atende o objetivo de tablets sincronizados.

## 8. Plano de testes

**Automáticos no Emulator (obrigatórios antes de dados reais):**
1. Estudante A não lê nem escreve o documento da equipe B.
2. Estudante não lê `teams` por lista, `notes`, nem `teachers`.
3. Conta sem registro em `teachers` não abre painel nem grava `public/projecao`.
4. Código errado, sessão encerrada ou expirada: entrada negada.
5. `correct` forjado é rejeitado; unidade inválida e textos acima do limite são rejeitados.
6. Dica 2 sem dica 1, dica na saída, segundo diagnóstico, segunda saída: negados.
7. Professor de outra sessão não lê esta sessão.
8. A projeção pública não contém apelidos.

**Manuais (2 tablets + notebook, na rede da escola):** o painel atualiza sem recarregar; queda e retorno do Wi-Fi; recarregar o tablet no meio da missão; teclado e controle numérico; recuperação de sessão; leitura da TV sem login.

## 9. Entregas em passos, com parada para sua aprovação

1. **2a, local:** `FirebaseRepository`, regras e testes no Emulator. Nenhum serviço real, nenhum custo.
2. **2b, projeto real:** você cria o projeto Firebase (plano gratuito); eu configuro e publico as regras; teste de fumaça com 1 tablet.
3. **2c, campo:** teste com 2 tablets + notebook, ajustes, plano B documentado.

## 10. Riscos

- Rede da escola bloqueando o Firebase → plano B: versão DEMONSTRAÇÃO local + folha de papel equivalente.
- Cota gratuita insuficiente (improvável) → o serviço bloqueia sem custo; migrar para B só com sua aprovação.
- Limites da Opção A listados na seção 4.
- Autorização institucional pendente (decisão 7).

## 11. Fora do escopo da Etapa 2

Missões Sala, Piscina e Projeto Final (Etapa 3); piloto com a turma (Etapa 4); IA generativa; ranking.
