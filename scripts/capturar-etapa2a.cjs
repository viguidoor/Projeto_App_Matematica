/**
 * Capturas da interface após a Etapa 2a (hipótese inicial + nomenclatura Missão/Etapa), modo DEMONSTRAÇÃO.
 *   VIEWPORT=1024x768 OUT=CAPTURAS_ETAPA2A node scripts/capturar-etapa2a.cjs   (requer `npm run dev` e Playwright)
 */
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const [w, h] = (process.env.VIEWPORT || '1024x768').split('x').map(Number);
const OUT = path.resolve(process.env.OUT || 'CAPTURAS_ETAPA2A');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const T = await ctx.newPage(), S = await ctx.newPage(), P = await ctx.newPage();
  const shot = async (page, name) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
    console.log('ok', name);
  };
  const fill = async (page, o) => {
    await page.getByLabel('Cálculo da equipe').fill(o.calc);
    await page.getByLabel('Área encontrada (número)').fill(o.answer);
    await page.getByRole('radio', { name: /m² \(metro quadrado\)/ }).check();
    await page.getByLabel(/Justificativa/).fill(o.why);
  };

  await T.goto(BASE + '/#/professor');
  await T.getByRole('button', { name: 'Entrar na demonstração' }).click();
  await T.getByRole('button', { name: 'Abrir sessão' }).click();
  const code = (await T.locator('.session-code').textContent()).trim();
  await T.getByRole('button', { name: /Carregar equipes FICTÍCIAS/ }).click();

  await S.goto(BASE + '/#/');
  await S.getByRole('button', { name: 'Começar' }).click();
  await S.getByLabel('Código da sessão').fill(code);
  await S.getByLabel('Apelido da equipe').fill('Equipe Ipê');
  await S.getByRole('button', { name: 'Entrar' }).click();
  await S.getByRole('heading', { name: 'Questão diagnóstica' }).waitFor();
  await shot(S, '01-etapa-1-diagnostico');
  await fill(S, { calc: '8 x 5', answer: '40', why: 'Multipliquei as duas diagonais.' });
  await S.getByRole('button', { name: /Enviar diagnóstico/ }).click();
  await S.getByRole('heading', { name: /Hipótese inicial: explorem/ }).waitFor();
  await shot(S, '02-etapa-2-exploracao-para-a-hipotese-inicial');
  await S.getByLabel('Diagonal menor (d)', { exact: true }).fill('10');
  await S.getByRole('complementary', { name: /Diagonais iguais/ }).waitFor();
  await shot(S, '03-etapa-2-diagonais-iguais-quadrado');
  await S.getByLabel('Diagonal menor (d)', { exact: true }).fill('6');
  await S.getByRole('button', { name: /Registrar hipótese inicial/ }).click();
  await S.getByRole('heading', { name: 'Hipótese inicial da equipe' }).waitFor();
  await shot(S, '04-etapa-2-hipotese-inicial');
  await fill(S, { calc: '10 x 6', answer: '60', why: 'Área é base vezes altura das diagonais.' });
  await S.getByRole('button', { name: /Enviar hipótese inicial/ }).click();
  await S.getByRole('heading', { name: 'Devolutiva da hipótese inicial' }).waitFor();
  await shot(S, '05-etapa-2-devolutiva-da-hipotese-inicial');
  await S.getByRole('button', { name: /Pedir a dica 1/ }).click();
  await shot(S, '06-dica-1-so-aparece-apos-solicitar');
  await S.getByRole('button', { name: 'Nova tentativa' }).click();
  await S.getByRole('heading', { name: /Revisão: explorem/ }).waitFor();
  await shot(S, '07-etapa-3-revisao');
  await S.getByRole('button', { name: /Registrar nova tentativa/ }).click();
  await S.getByRole('heading', { name: 'Tentativa 1 da equipe' }).waitFor();
  await fill(S, { calc: '10 x 6 : 2', answer: '30', why: 'O losango é metade do retângulo.' });
  await S.getByRole('button', { name: /Enviar tentativa/ }).click();
  await S.getByRole('heading', { name: 'Devolutiva da tentativa 1' }).waitFor();
  await shot(S, '08-etapa-3-devolutiva-da-tentativa');
  await S.getByRole('button', { name: 'Ir ao problema final' }).click();
  await S.getByRole('heading', { name: 'Problema final' }).waitFor();
  await shot(S, '09-etapa-4-problema-final');
  await fill(S, { calc: '12 x 4 : 2', answer: '24', why: 'Metade do produto das diagonais.' });
  await S.getByRole('button', { name: /Enviar resolução final/ }).click();
  await S.getByRole('heading', { name: 'Missão concluída' }).waitFor();
  await shot(S, '10-etapa-4-concluido');

  await T.bringToFront();
  await T.getByRole('button', { name: /Ver.*detalhes de Equipe Ipê/ }).click();
  await shot(T, '11-painel-professor-trajetoria-por-etapa');
  await T.getByRole('button', { name: /Distribuição: Hipótese inicial/ }).click();
  await P.goto(BASE + '/#/projecao');
  await shot(P, '12-projecao-distribuicao-da-hipotese-inicial');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
