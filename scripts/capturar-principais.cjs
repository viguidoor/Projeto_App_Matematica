/**
 * Capturas das principais telas atuais em um viewport.
 *   VIEWPORT=1024x768 OUT=CAPTURAS_PRE_ETAPA2/tablet node scripts/capturar-principais.cjs
 *   VIEWPORT=1440x900 OUT=CAPTURAS_PRE_ETAPA2/desktop node scripts/capturar-principais.cjs
 * Requer `npm run dev` em http://localhost:5173 e Playwright. Dados 100% fictícios.
 */
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const [w, h] = (process.env.VIEWPORT || '1024x768').split('x').map(Number);
const OUT = path.resolve(process.env.OUT || 'CAPTURAS_PRE_ETAPA2/tablet');

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
  await shot(S, '01-entrada-do-estudante');
  await S.getByRole('button', { name: 'Entrar' }).click();
  await S.getByRole('heading', { name: 'Questão diagnóstica' }).waitFor();
  await shot(S, '02-diagnostico');
  await fill(S, { calc: '8 x 5', answer: '40', why: 'Multipliquei as duas diagonais.' });
  await S.getByRole('button', { name: /Enviar diagnóstico/ }).click();
  await S.getByRole('heading', { name: /Missão 1/ }).waitFor();
  await shot(S, '03-exploracao-do-losango');
  await S.getByRole('button', { name: /Pedir a dica 1/ }).click();
  await S.getByRole('button', { name: /Pedir a dica 2/ }).click();
  await S.getByRole('button', { name: /Pedir a dica 3/ }).click();
  await shot(S, '05-dicas');
  await S.getByRole('button', { name: /Registrar hipótese/ }).click();
  await S.getByRole('heading', { name: 'Hipótese da equipe' }).waitFor();
  await shot(S, '04-hipotese');
  await fill(S, { calc: '10 x 6 : 2', answer: '30', why: 'O losango é metade do retângulo.' });
  await S.getByRole('button', { name: /Enviar hipótese/ }).click();
  await S.getByRole('button', { name: 'Ir ao problema final' }).click();
  await S.getByRole('heading', { name: 'Problema final' }).waitFor();
  await shot(S, '06-atividade-final');

  await T.bringToFront();
  await shot(T, '07-painel-do-professor');
  await T.getByRole('button', { name: /Distribuição: Diagnóstico/ }).click();
  await P.goto(BASE + '/#/projecao');
  await shot(P, '08-modo-projecao');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
