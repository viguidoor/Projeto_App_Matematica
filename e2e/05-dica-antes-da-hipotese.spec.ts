import { expect, test } from '@playwright/test';
import { closeActors, expectNoUnexpectedErrors, fillAnswer, newActor, openSession, resetData, studentApi, studentJoin, submitDiagnostic, teacherLogin, teamRow, withDb } from './helpers';

const teamId = (alias: string) => withDb(async (db) => (await db.query('select id from public.teams where alias = $1', [alias])).rows[0].id as string);

test('tentativa de abrir dica antes da hipótese inicial: a interface não oferece e o servidor recusa, mesmo chamado diretamente', async ({ browser }) => {
  await resetData();
  const prof = await newActor(browser, 'professor');
  const a = await newActor(browser, 'equipe A');
  await teacherLogin(prof.page);
  const code = await openSession(prof.page);
  await studentJoin(a.page, code, 'Equipe A');
  const id = await teamId('Equipe A');
  const hint = (level: number) => studentApi(a.page, '/rest/v1/rpc/record_hint', { method: 'POST', body: { p_team: id, p_level: level } });

  await test.step('antes do diagnóstico e na exploração: sem botão e com explicação; o servidor recusa o pedido direto', async () => {
    expect((await hint(1)).status).toBe(400);
    await submitDiagnostic(a.page, { calc: '8 x 5 : 2', answer: '20', why: 'Metade do produto.' });
    await expect(a.page.getByRole('button', { name: /Pedir a dica/ })).toHaveCount(0);
    await expect(a.page.getByText(/As dicas ficam disponíveis depois que a equipe registrar a hipótese inicial/)).toBeVisible();
    const r = await hint(1);
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ hint: 'INVALID_STATE', message: expect.stringMatching(/depois que a equipe registrar a hipótese inicial/) });
  });

  await test.step('no formulário da hipótese inicial: continua sem dicas e o servidor continua recusando', async () => {
    await a.page.getByRole('button', { name: /Registrar hipótese inicial/ }).click();
    await expect(a.page.getByRole('heading', { name: 'Hipótese inicial da equipe' })).toBeVisible();
    await expect(a.page.getByRole('button', { name: /Pedir a dica/ })).toHaveCount(0);
    expect((await hint(2)).status).toBe(400);
    expect((await hint(1)).status).toBe(400);
    await expect(teamRow(prof.page, 'Equipe A')).not.toContainText('Pediu dica');
    expect(await withDb(async (db) => Number((await db.query('select count(*) as n from public.hint_events')).rows[0].n))).toBe(0);
  });

  await test.step('depois da hipótese inicial: a dica 1 é liberada, mas não se pode pular para a 3', async () => {
    await fillAnswer(a.page, { calc: '10 x 6', answer: '60', why: 'Multiplicamos.' });
    await a.page.getByRole('button', { name: 'Enviar hipótese inicial' }).click();
    await expect(a.page.getByRole('heading', { name: 'Devolutiva da hipótese inicial' })).toBeVisible();
    const skip = await hint(3);
    expect(skip.status).toBe(400);
    expect(skip.json).toMatchObject({ hint: 'INVALID_STATE', message: expect.stringMatching(/em ordem/) });
    await a.page.getByRole('button', { name: 'Pedir a dica 1 de 3' }).click();
    await expect(a.page.getByText('Dica 1: identifiquem as diagonais')).toBeVisible();
    await expect(teamRow(prof.page, 'Equipe A')).toContainText('Pediu dica');
    // o registro da hipótese inicial continua sem dicas
    const nivel = await withDb(async (db) => (await db.query(`select hint_level from public.submissions where kind = 'hipotese'`)).rows[0].hint_level);
    expect(nivel).toBe(0);
  });

  await test.step('no problema final não existem dicas, nem pedindo direto ao servidor', async () => {
    await a.page.getByRole('button', { name: 'Ir ao problema final' }).first().click();
    await a.page.getByRole('button', { name: 'Sim, ir ao problema final' }).click();
    await expect(a.page.getByRole('heading', { name: 'Problema final' })).toBeVisible();
    await expect(a.page.getByRole('button', { name: /Pedir a dica/ })).toHaveCount(0);
    expect((await hint(2)).status).toBe(400);
  });

  expectNoUnexpectedErrors([prof]);
  expectNoUnexpectedErrors([a], [/Failed to load resource: the server responded with a status of 400/]); // as recusas provocadas
  await closeActors(prof, a);
});
