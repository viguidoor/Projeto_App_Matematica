import { expect, test } from '@playwright/test';
import { closeActors, dbCount, expectNoUnexpectedErrors, fillAnswer, newActor, openSession, resetData, studentJoin, submitDiagnostic, teacherLogin, teamRow } from './helpers';

const MENSAGEM = 'Não foi possível conectar ao servidor. Verifique a conexão e avise o professor.';
const ONLINE_ERRORS = [/Failed to load resource/, /ERR_INTERNET_DISCONNECTED/, /Failed to fetch/, /net::/];

test('queda breve da conexão do estudante: o envio espera, é repetido sozinho e grava UMA vez', async ({ browser }) => {
  await resetData();
  const prof = await newActor(browser, 'professor');
  const a = await newActor(browser, 'equipe A');
  await teacherLogin(prof.page);
  const code = await openSession(prof.page);
  await studentJoin(a.page, code, 'Equipe A');

  await fillAnswer(a.page, { calc: '8 x 5 : 2', answer: '20', why: 'Metade do produto.' });
  await a.context.setOffline(true);
  await a.page.getByRole('button', { name: 'Enviar diagnóstico' }).click();
  await expect(a.page.getByText('Conexão: Reconectando…')).toBeVisible();
  await expect(a.page.getByRole('button', { name: 'Enviando…' })).toBeVisible(); // aguardando, sem perder o que foi digitado
  await a.page.waitForTimeout(1_500);
  await a.context.setOffline(false);

  await expect(a.page.getByRole('heading', { name: /Hipótese inicial: explorem o jardim/ })).toBeVisible({ timeout: 30_000 });
  await expect(a.page.getByText('Conexão: Conectado')).toBeVisible();
  await expect(teamRow(prof.page, 'Equipe A')).toContainText('20 m² ✔');
  expect(await dbCount(`select count(*)::int as n from public.submissions where kind = 'diagnostico'`)).toBe(1);
  expectNoUnexpectedErrors([prof]);
  expectNoUnexpectedErrors([a], ONLINE_ERRORS);
  await closeActors(prof, a);
});

test('queda longa: mensagem clara ao estudante, nada se perde, e ao voltar o mesmo envio grava UMA vez', async ({ browser }) => {
  await resetData();
  const prof = await newActor(browser, 'professor');
  const a = await newActor(browser, 'equipe A');
  await teacherLogin(prof.page);
  const code = await openSession(prof.page);
  await studentJoin(a.page, code, 'Equipe A');
  await submitDiagnostic(a.page, { calc: '8 x 5 : 2', answer: '20', why: 'Metade do produto.' });
  await a.page.getByRole('button', { name: /Registrar hipótese inicial/ }).click();
  await fillAnswer(a.page, { calc: '10 x 6 : 2', answer: '30', why: 'Metade.' });

  await a.context.setOffline(true);
  await a.page.getByRole('button', { name: 'Enviar hipótese inicial' }).click();
  await expect(a.page.getByRole('alert').filter({ hasText: MENSAGEM })).toBeVisible({ timeout: 40_000 }); // depois das tentativas automáticas
  await expect(a.page.getByText(`Conexão: ${MENSAGEM}`)).toBeVisible();
  await expect(a.page.getByLabel('Cálculo da equipe')).toHaveValue('10 x 6 : 2'); // o texto continua lá
  await expect(a.page.getByRole('button', { name: 'Enviar hipótese inicial' })).toBeEnabled();
  expect(await dbCount(`select count(*)::int as n from public.submissions where kind = 'hipotese'`)).toBe(0);

  await a.context.setOffline(false);
  await a.page.getByRole('button', { name: 'Enviar hipótese inicial' }).click(); // mesmo envio, mesmo identificador
  await expect(a.page.getByRole('heading', { name: 'Devolutiva da hipótese inicial' })).toBeVisible({ timeout: 30_000 });
  await expect(a.page.getByText('Conexão: Conectado')).toBeVisible();
  await expect(teamRow(prof.page, 'Equipe A')).toContainText('30 m² ✔');
  expect(await dbCount(`select count(*)::int as n from public.submissions where kind = 'hipotese'`)).toBe(1);
  expectNoUnexpectedErrors([prof]);
  expectNoUnexpectedErrors([a], ONLINE_ERRORS);
  await closeActors(prof, a);
});

test('queda de conexão do PROFESSOR: o painel avisa e orienta; ao voltar, recupera o que perdeu sem recarregar', async ({ browser }) => {
  await resetData();
  const prof = await newActor(browser, 'professor');
  const b = await newActor(browser, 'equipe B');
  await teacherLogin(prof.page);
  const code = await openSession(prof.page);
  await prof.page.evaluate(() => ((window as unknown as { __vivo: string }).__vivo = 'mesma-pagina'));

  await prof.context.setOffline(true);
  await expect(prof.page.getByText(/Conexão: (Reconectando…|Não foi possível conectar)/)).toBeVisible({ timeout: 45_000 });
  await expect(prof.page.getByText(/projeto do Supabase está ativo/)).toBeVisible();
  await studentJoin(b.page, code, 'Equipe B'); // enquanto isso, uma equipe entra (outro navegador, com rede)
  await prof.context.setOffline(false);

  await expect(prof.page.getByText('Conexão: Conectado')).toBeVisible({ timeout: 60_000 });
  await expect(teamRow(prof.page, 'Equipe B')).toContainText('Entrou', { timeout: 30_000 });
  expect(await prof.page.evaluate(() => (window as unknown as { __vivo?: string }).__vivo)).toBe('mesma-pagina');
  expectNoUnexpectedErrors([b]);
  expectNoUnexpectedErrors([prof], ONLINE_ERRORS);
  await closeActors(prof, b);
});
