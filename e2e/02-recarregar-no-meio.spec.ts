import { expect, test } from '@playwright/test';
import { closeActors, dbCount, expectNoUnexpectedErrors, newActor, openSession, resetData, studentJoin, submitDiagnostic, teacherLogin, teamRow } from './helpers';

test('atualizar a página no meio da missão: a equipe e o professor retomam exatamente de onde pararam, sem duplicar registros', async ({ browser }) => {
  await resetData();
  const prof = await newActor(browser, 'professor');
  const a = await newActor(browser, 'equipe A');
  await teacherLogin(prof.page);
  const code = await openSession(prof.page);
  await studentJoin(a.page, code, 'Equipe A');

  await test.step('no diagnóstico', async () => {
    await a.page.reload();
    await expect(a.page.getByRole('heading', { name: 'Questão diagnóstica' })).toBeVisible();
    await expect(a.page.getByText('Equipe: Equipe A')).toBeVisible();
    await expect(a.page.getByText(/Etapa 1\/4 · Diagnóstico/)).toBeVisible();
  });

  await test.step('na exploração: as medidas escolhidas voltam', async () => {
    await submitDiagnostic(a.page, { calc: '8 x 5 : 2', answer: '20', why: 'Metade do produto.' });
    await a.page.getByRole('button', { name: /Aumentar diagonal maior/ }).click();
    await expect(teamRow(prof.page, 'Equipe A')).toContainText('Explorando'); // salvo no servidor
    await a.page.reload();
    await expect(a.page.getByRole('heading', { name: /Hipótese inicial: explorem o jardim/ })).toBeVisible();
    await expect(a.page.getByLabel('Diagonal maior (D)', { exact: true })).toHaveValue('10,5');
    await expect(a.page.getByRole('button', { name: /Registrar hipótese inicial com D = 10,5 m e d = 6 m/ })).toBeVisible();
  });

  await test.step('no formulário da hipótese inicial', async () => {
    await a.page.getByRole('button', { name: /Registrar hipótese inicial/ }).click();
    await expect(a.page.getByRole('heading', { name: 'Hipótese inicial da equipe' })).toBeVisible();
    await a.page.reload();
    await expect(a.page.getByRole('heading', { name: 'Hipótese inicial da equipe' })).toBeVisible();
    await expect(a.page.getByText(/D = 10,5 m e diagonal menor d = 6 m/)).toBeVisible();
    await expect(a.page.getByRole('button', { name: /Pedir a dica/ })).toHaveCount(0); // dicas continuam bloqueadas
  });

  await test.step('na devolutiva, com uma dica aberta', async () => {
    await a.page.getByLabel('Cálculo da equipe').fill('10,5 x 6');
    await a.page.getByLabel('Área encontrada (número)').fill('63');
    await a.page.getByRole('radio', { name: /m² \(metro quadrado\)/ }).check();
    await a.page.getByLabel(/Justificativa/).fill('Multiplicamos.');
    await a.page.getByRole('button', { name: 'Enviar hipótese inicial' }).click();
    await expect(a.page.getByRole('heading', { name: 'Devolutiva da hipótese inicial' })).toBeVisible();
    await a.page.getByRole('button', { name: 'Pedir a dica 1 de 3' }).click();
    await expect(a.page.getByText('Dica 1: identifiquem as diagonais')).toBeVisible();
    await a.page.reload();
    await expect(a.page.getByRole('heading', { name: 'Devolutiva da hipótese inicial' })).toBeVisible();
    await expect(a.page.getByText('Dica 1: identifiquem as diagonais')).toBeVisible();
    await expect(a.page.getByText('Dica 2:')).toHaveCount(0);
    await expect(a.page.getByText(/Vocês multiplicaram as duas diagonais/)).toBeVisible();
  });

  await test.step('na revisão e no problema final', async () => {
    await a.page.getByRole('button', { name: 'Nova tentativa' }).click();
    await expect(a.page.getByRole('heading', { name: /Revisão: explorem o jardim de novo/ })).toBeVisible();
    await a.page.reload();
    await expect(a.page.getByRole('heading', { name: /Revisão: explorem o jardim de novo/ })).toBeVisible();
    await expect(a.page.getByText(/Etapa 3\/4 · Tentativas e revisões/)).toBeVisible();
    await a.page.getByRole('button', { name: /Registrar nova tentativa/ }).click();
    await a.page.getByLabel('Cálculo da equipe').fill('10,5 x 6 : 2');
    await a.page.getByLabel('Área encontrada (número)').fill('31,5');
    await a.page.getByRole('radio', { name: /m² \(metro quadrado\)/ }).check();
    await a.page.getByLabel(/Justificativa/).fill('Metade.');
    await a.page.getByRole('button', { name: 'Enviar tentativa' }).click();
    await expect(a.page.getByText(/a área do jardim é 31,5 m²/)).toBeVisible();
    await a.page.getByRole('button', { name: 'Ir ao problema final' }).click();
    await expect(a.page.getByRole('heading', { name: 'Problema final' })).toBeVisible();
    await a.page.reload();
    await expect(a.page.getByRole('heading', { name: 'Problema final' })).toBeVisible();
    await expect(a.page.getByRole('button', { name: /Pedir a dica/ })).toHaveCount(0);
  });

  await test.step('o painel do professor também sobrevive a atualizar a página (login e dados voltam)', async () => {
    await prof.page.reload();
    await expect(prof.page.getByRole('button', { name: /Abrir nova sessão/ })).toBeVisible(); // continua logado
    await expect(prof.page.locator('.session-code')).toHaveText(code);
    await expect(teamRow(prof.page, 'Equipe A')).toContainText('63 m² ✎');
    await expect(teamRow(prof.page, 'Equipe A')).toContainText('1 (última: 31,5 m² ✔)');
  });

  await test.step('atualizar não duplicou nada no banco', async () => {
    expect(await dbCount(`select count(*)::int as n from public.teams`)).toBe(1);
    expect(await dbCount(`select count(*)::int as n from public.submissions where kind = 'diagnostico'`)).toBe(1);
    expect(await dbCount(`select count(*)::int as n from public.submissions where kind = 'hipotese'`)).toBe(1);
    expect(await dbCount(`select count(*)::int as n from public.submissions where kind = 'tentativa'`)).toBe(1);
    expect(await dbCount(`select count(*)::int as n from public.hint_events`)).toBe(1);
    expectNoUnexpectedErrors([prof, a]);
  });
  await closeActors(prof, a);
});
