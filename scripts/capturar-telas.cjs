/**
 * Gera as capturas de tela da revisão visual (tablet 1024x768) em REVISAO_VISUAL/.
 * Pré-requisitos: `npm run dev` rodando em http://localhost:5173 e Playwright disponível
 * (npm i -D playwright, ou global). Todos os dados digitados aqui são FICTÍCIOS.
 *   node scripts/capturar-telas.cjs
 */
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OUT = path.join(__dirname, '..', 'REVISAO_VISUAL');
const TABLET = { width: 1024, height: 768 };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: TABLET });
  const T = await ctx.newPage();
  const S = await ctx.newPage();
  const P = await ctx.newPage();
  const shot = async (page, dir, name, opts = {}) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, dir, name + '.png'), fullPage: true, ...opts });
    console.log('ok', dir + '/' + name);
  };
  const fill = async (page, { calc, answer, unit, why }) => {
    await page.getByLabel('Cálculo da equipe').fill(calc);
    await page.getByLabel('Área encontrada (número)').fill(answer);
    await page.getByRole('radio', { name: unit === 'm' ? /^m \(metro\)/ : /m² \(metro quadrado\)/ }).check();
    await page.getByLabel(/Justificativa/).fill(why);
  };

  // ---- Professor: entrada e sessão
  await T.goto(BASE + '/#/professor');
  await shot(T, 'professor', '01-entrada-demonstracao');
  await T.getByRole('button', { name: 'Entrar na demonstração' }).click();
  await T.getByRole('button', { name: 'Abrir sessão' }).click();
  const code = (await T.locator('.session-code').textContent()).trim();
  await shot(T, 'professor', '02-sessao-aberta-sem-equipes');

  // ---- Projeção: aguardando
  await P.goto(BASE + '/#/projecao');
  await shot(P, 'projecao', '01-aguardando-professor');

  // ---- Estudante: abertura e entrada
  await S.goto(BASE + '/#/');
  await shot(S, 'estudante', '01-abertura');
  await S.getByRole('button', { name: 'Começar' }).click();
  await shot(S, 'estudante', '02-entrada');
  await S.getByLabel('Código da sessão').fill('AAAAAA');
  await S.getByLabel('Apelido da equipe').fill('Equipe Ipê');
  await S.getByRole('button', { name: 'Entrar' }).click();
  await S.getByText(/Código não encontrado/).waitFor();
  await shot(S, 'estudante', '03-entrada-codigo-invalido');
  await S.getByLabel('Código da sessão').fill(code);
  await S.getByRole('button', { name: 'Entrar' }).click();
  await S.getByRole('heading', { name: 'Questão diagnóstica' }).waitFor();

  // ---- Diagnóstico
  await shot(S, 'estudante', '04-diagnostico');
  await S.getByRole('button', { name: /Enviar diagnóstico/ }).click();
  await shot(S, 'estudante', '05-diagnostico-campos-obrigatorios');
  await fill(S, { calc: '8 x 5', answer: '40', unit: 'm²', why: 'Multipliquei as duas diagonais.' });
  await S.getByRole('button', { name: /Enviar diagnóstico/ }).click();
  await S.getByRole('heading', { name: /Missão 1/ }).waitFor();

  // ---- Exploração
  await shot(S, 'estudante', '06-exploracao-inicial');
  const minor = S.getByLabel('Diagonal menor (d)', { exact: true });
  await minor.fill('10');
  await S.getByRole('complementary', { name: /Diagonais iguais/ }).waitFor();
  await shot(S, 'estudante', '07-exploracao-diagonais-iguais-quadrado');
  await minor.fill('6');
  await S.getByRole('button', { name: /Pedir a dica 1/ }).click();
  await shot(S, 'estudante', '08-exploracao-dica-1');
  await S.getByRole('button', { name: /Pedir a dica 2/ }).click();
  await S.getByRole('button', { name: /Pedir a dica 3/ }).click();
  await shot(S, 'estudante', '09-exploracao-dicas-1-2-3-com-figura');

  // ---- Hipótese e devolutiva
  await S.getByRole('button', { name: /Registrar hipótese/ }).click();
  await S.getByRole('heading', { name: 'Hipótese da equipe' }).waitFor();
  await shot(S, 'estudante', '10-hipotese');
  await fill(S, { calc: '10 x 6', answer: '60', unit: 'm²', why: 'Eu, Maria Souza, multipliquei as diagonais e a equipe Ipê chamou 99999-1234.' });
  await S.getByRole('button', { name: /Enviar hipótese/ }).click();
  await S.getByRole('heading', { name: /Devolutiva da tentativa 1/ }).waitFor();
  await shot(S, 'estudante', '11-devolutiva-nao-confere');
  await S.getByRole('button', { name: 'Nova tentativa' }).click();
  await S.getByRole('button', { name: /Registrar hipótese/ }).click();
  await fill(S, { calc: '10 x 6 : 2', answer: '30', unit: 'm²', why: 'O losango é metade do retângulo que o envolve.' });
  await S.getByRole('button', { name: /Enviar hipótese/ }).click();
  await S.getByRole('heading', { name: /Devolutiva da tentativa 2/ }).waitFor();
  await shot(S, 'estudante', '12-devolutiva-confere');

  // ---- Problema final
  await S.getByRole('button', { name: 'Ir ao problema final' }).click();
  await S.getByRole('heading', { name: 'Problema final' }).waitFor();
  await shot(S, 'estudante', '13-problema-final');
  await fill(S, { calc: '12 x 4 : 2', answer: '24', unit: 'm²', why: 'Metade do produto das diagonais.' });
  await S.getByRole('button', { name: /Enviar resolução final/ }).click();
  await S.getByRole('heading', { name: 'Missão concluída' }).waitFor();
  await shot(S, 'estudante', '14-concluido');

  // ---- Professor / projeção com poucos dados
  await T.bringToFront();
  await T.getByRole('button', { name: /Distribuição: Diagnóstico/ }).click();
  await shot(P, 'projecao', '02-poucas-respostas-distribuicao-oculta');
  await T.getByRole('button', { name: /Carregar equipes FICTÍCIAS/ }).click();
  await T.getByRole('table').waitFor();
  await shot(T, 'professor', '03-painel-equipes-ficticias-e-real');

  await T.getByRole('button', { name: /Ver.*detalhes de Equipe Ipê/ }).click();
  await shot(T, 'professor', '04-detalhe-da-equipe');

  // ---- Prévia com ocultação de dados pessoais
  await T.getByRole('button', { name: /Revisar e projetar como exemplo.*Tentativa 1/ }).click();
  await T.locator('.preview').waitFor();
  await shot(T, 'professor', '05-previa-ocultacao-dados-pessoais');
  await T.locator('.preview').screenshot({ path: path.join(OUT, 'professor', '05b-previa-ocultacao-detalhe.png') });
  await T.getByRole('checkbox', { name: /Revisei o texto/ }).check();
  await T.getByRole('button', { name: 'Projetar este exemplo' }).click();
  await shot(P, 'projecao', '03-exemplo-revisado-sem-dados-pessoais');

  // ---- Distribuições
  await T.getByRole('button', { name: /Distribuição: Diagnóstico/ }).click();
  await shot(P, 'projecao', '04-distribuicao-diagnostico');
  await T.getByRole('button', { name: /Distribuição: 1ª tentativa/ }).click();
  await shot(P, 'projecao', '05-distribuicao-primeira-tentativa');
  await T.getByRole('button', { name: /Distribuição: Saída/ }).click();
  await T.getByRole('checkbox', { name: /Mostrar na projeção qual resposta confere/ }).check();
  await shot(P, 'projecao', '06-distribuicao-saida-com-resposta-correta');
  await P.setViewportSize({ width: 1920, height: 1080 });
  await shot(P, 'projecao', '07-distribuicao-saida-tela-tv-1920x1080');
  await P.setViewportSize(TABLET);

  // ---- Notas, padrões e exportação (painel)
  await T.bringToFront();
  await T.getByRole('textbox', { name: 'Dificuldade observada' }).fill('Equipes multiplicaram as diagonais e esqueceram a divisão por 2.');
  await T.getByRole('textbox', { name: 'Pergunta ou intervenção' }).fill('Como o losango se relaciona ao retângulo que o envolve?');
  await T.getByRole('textbox', { name: 'Resposta após a mediação' }).fill('Reescreveram o cálculo com ÷ 2 e explicaram pelo retângulo.');
  await T.getByRole('button', { name: 'Salvar nota' }).click();
  await T.getByText(/Reescreveram o cálculo/).waitFor();
  await shot(T, 'professor', '06-painel-completo-padroes-notas-exportacao');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
